#!/usr/bin/env python3
"""
Tariff Simulator — SmartClaws dev tool

Writes an OMIE-shaped Iberian day-ahead tariff to a JSON file every TICK_SECONDS.
The smart controller reads this file directly (no on-chain publish).

The 24h shape:
  00-06  valley       (cheap)
  07-10  morning ramp (mid -> expensive)
  11-15  solar dip    (mid -> cheap)
  17-22  evening peak (expensive)
  23-24  taper        (mid)

Modes:
  realtime     — one tick = one second, wraps every 24h
  accelerated  — 24h compressed into ACCEL_SECONDS (default 600s = 10 min)

Output file schema:
  {
    "now": {
      "price_eur_mwh": 87.4,
      "tier": "expensive",
      "tier_started_s_ago": 45,
      "tier_ends_in_s": 124
    },
    "lookahead": [
      {"offset_s": 0,   "price_eur_mwh": 87.4, "tier": "expensive"},
      {"offset_s": 30,  "price_eur_mwh": 92.1, "tier": "expensive"},
      ...
    ],
    "config": {
      "mode": "accelerated",
      "day_seconds": 600,
      "started_at_iso": "2026-05-19T12:00:00Z",
      "tier_thresholds": {"cheap_max": 45.0, "expensive_min": 95.0},
      "lookahead_horizon_s": 300,
      "lookahead_step_s": 30
    }
  }

Required env vars:
  (none — sensible defaults are provided)

Optional env vars:
  TARIFF_FILE         output JSON path (default: ~/.sc-controller/tariff.json)
  TARIFF_MODE         "accelerated" or "realtime" (default: accelerated)
  ACCEL_SECONDS       compressed-day length when accelerated (default: 600)
  TICK_SECONDS        how often to rewrite the file (default: 1)
  LOOKAHEAD_HORIZON   future horizon in seconds (default: 300)
  LOOKAHEAD_STEP      step between lookahead samples (default: 30)
  PRICE_NOISE_EUR     gaussian noise stddev added per tick (default: 1.5)
  PRINT_STATUS        "1" to print one status line per tick (default: 1)
"""

import json
import math
import os
import random
import sys
import time
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

TARIFF_FILE = os.path.expanduser(
    os.environ.get("TARIFF_FILE", "~/.sc-controller/tariff.json")
)
MODE = os.environ.get("TARIFF_MODE", "accelerated")
ACCEL_SECONDS = float(os.environ.get("ACCEL_SECONDS", "600"))
TICK_SECONDS = float(os.environ.get("TICK_SECONDS", "1"))
LOOKAHEAD_HORIZON = float(os.environ.get("LOOKAHEAD_HORIZON", "300"))
LOOKAHEAD_STEP = float(os.environ.get("LOOKAHEAD_STEP", "30"))
PRICE_NOISE = float(os.environ.get("PRICE_NOISE_EUR", "1.5"))
PRINT_STATUS = os.environ.get("PRINT_STATUS", "1") == "1"

# ---------------------------------------------------------------------------
# 24-hour OMIE-shaped curve
# ---------------------------------------------------------------------------
# Base sinusoid + two gaussian bumps (morning, evening), minus a midday dip.
# Range tuned to ~20-130 EUR/MWh.

def _gauss_bump(hour: float, center: float, width: float, amp: float) -> float:
    return amp * math.exp(-0.5 * ((hour - center) / width) ** 2)


def day_price(seconds_into_day: float, day_length_s: float) -> float:
    """Return the (noiseless) price in EUR/MWh for a moment in the simulated day."""
    hour = (seconds_into_day / day_length_s) * 24.0
    # Base diurnal sinusoid (mild)
    base = 55.0 + 10.0 * math.sin((hour - 8) / 24 * 2 * math.pi)
    # Morning peak around 09:00
    morning = _gauss_bump(hour, center=9.0, width=1.4, amp=35.0)
    # Evening peak around 20:00 (the big one)
    evening = _gauss_bump(hour, center=20.0, width=1.8, amp=65.0)
    # Midday solar dip around 13:30
    dip = _gauss_bump(hour, center=13.5, width=1.8, amp=22.0)
    # Overnight valley around 04:00
    valley = _gauss_bump(hour, center=4.0, width=2.5, amp=18.0)
    price = base + morning + evening - dip - valley
    return max(8.0, price)


# Tier thresholds computed once from the noiseless curve at sample resolution.
def compute_tier_thresholds(day_length_s: float) -> tuple[float, float]:
    samples = [day_price(t, day_length_s) for t in range(int(day_length_s))]
    samples.sort()
    n = len(samples)
    # Tertiles: bottom third = cheap, middle third = mid, top third = expensive
    cheap_max = samples[n // 3]
    expensive_min = samples[(2 * n) // 3]
    return cheap_max, expensive_min


def classify(price: float, cheap_max: float, expensive_min: float) -> str:
    if price <= cheap_max:
        return "cheap"
    if price >= expensive_min:
        return "expensive"
    return "mid"


# ---------------------------------------------------------------------------
# Tier boundary search (used for tier_ends_in_s / tier_started_s_ago)
# ---------------------------------------------------------------------------

def find_tier_boundary(
    start_s: float,
    direction: int,
    current_tier: str,
    cheap_max: float,
    expensive_min: float,
    day_length_s: float,
    max_search_s: float,
) -> float | None:
    """Walk forward (+1) or backward (-1) in 1-second steps until the tier changes."""
    step = direction
    horizon = int(max_search_s)
    for delta in range(1, horizon + 1):
        t = start_s + delta * step
        # Wrap into [0, day_length)
        t_mod = t % day_length_s
        if classify(day_price(t_mod, day_length_s), cheap_max, expensive_min) != current_tier:
            return float(delta)
    return None


# ---------------------------------------------------------------------------
# State & I/O
# ---------------------------------------------------------------------------

def write_tariff_file(payload: dict) -> None:
    os.makedirs(os.path.dirname(TARIFF_FILE), exist_ok=True)
    tmp = TARIFF_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    os.replace(tmp, TARIFF_FILE)


def banner(day_length_s: float, cheap_max: float, expensive_min: float) -> None:
    print("=" * 60)
    print("  SmartClaws Tariff Simulator")
    print("=" * 60)
    print(f"  Mode:           {MODE}")
    print(f"  Day length:     {day_length_s:.0f} s")
    print(f"  Tick interval:  {TICK_SECONDS} s")
    print(f"  Output file:    {TARIFF_FILE}")
    print(f"  Tier (cheap):   <= {cheap_max:.1f} EUR/MWh")
    print(f"  Tier (expens.): >= {expensive_min:.1f} EUR/MWh")
    print("=" * 60)
    print()


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main() -> None:
    if MODE not in ("accelerated", "realtime"):
        print(f"ERROR: unknown TARIFF_MODE={MODE!r}", file=sys.stderr)
        sys.exit(2)

    day_length_s = ACCEL_SECONDS if MODE == "accelerated" else 86400.0
    cheap_max, expensive_min = compute_tier_thresholds(day_length_s)
    started_at = datetime.now(timezone.utc)
    started_wall = time.time()

    banner(day_length_s, cheap_max, expensive_min)

    tick = 0
    while True:
        tick += 1
        elapsed_wall = time.time() - started_wall
        sim_seconds_into_day = elapsed_wall % day_length_s

        spot = day_price(sim_seconds_into_day, day_length_s)
        spot_noisy = spot + random.gauss(0.0, PRICE_NOISE)
        tier = classify(spot, cheap_max, expensive_min)

        # Tier window boundaries
        # Look at most 1 full simulated day in either direction so we always
        # find a boundary.
        ends_in = find_tier_boundary(
            sim_seconds_into_day, +1, tier, cheap_max, expensive_min,
            day_length_s, day_length_s,
        )
        started_ago = find_tier_boundary(
            sim_seconds_into_day, -1, tier, cheap_max, expensive_min,
            day_length_s, day_length_s,
        )

        # Lookahead samples (deterministic — no noise on lookahead so the
        # controller can reason about future cleanly).
        lookahead = []
        steps = int(LOOKAHEAD_HORIZON // LOOKAHEAD_STEP) + 1
        for i in range(steps):
            offs = i * LOOKAHEAD_STEP
            t = (sim_seconds_into_day + offs) % day_length_s
            p = day_price(t, day_length_s)
            lookahead.append({
                "offset_s": int(offs),
                "price_eur_mwh": round(p, 2),
                "tier": classify(p, cheap_max, expensive_min),
            })

        payload = {
            "now": {
                "price_eur_mwh": round(spot_noisy, 2),
                "tier": tier,
                "tier_started_s_ago": int(started_ago) if started_ago else None,
                "tier_ends_in_s": int(ends_in) if ends_in else None,
            },
            "lookahead": lookahead,
            "config": {
                "mode": MODE,
                "day_seconds": int(day_length_s),
                "started_at_iso": started_at.isoformat().replace("+00:00", "Z"),
                "tier_thresholds": {
                    "cheap_max": round(cheap_max, 2),
                    "expensive_min": round(expensive_min, 2),
                },
                "lookahead_horizon_s": int(LOOKAHEAD_HORIZON),
                "lookahead_step_s": int(LOOKAHEAD_STEP),
            },
            "tick": tick,
            "updated_at_iso": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }

        write_tariff_file(payload)

        if PRINT_STATUS:
            ts = time.strftime("%H:%M:%S")
            print(
                f"[{ts}] #{tick:05d} | sim {sim_seconds_into_day:6.1f}s | "
                f"{spot_noisy:6.2f} EUR/MWh | tier={tier:9s} | "
                f"ends in {ends_in if ends_in else '?'}s"
            )

        time.sleep(TICK_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nstopped.")
