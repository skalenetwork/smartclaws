---
name: smartclaws-tariff-read
description: >
  Read the current energy price and tariff tier. Use this whenever someone asks or when you need to know
  how expensive electricity is right now, what tariff tier we're in (cheap / mid
  / expensive), how long the current price lasts, or what prices are coming up.
  Read-only — never publishes or changes anything.
license: LGPL-3.0-or-later
metadata:
  openclaw:
    emoji: "💶"
    homepage: https://github.com/skalenetwork/smartclaws
---

# SmartClaws — Read Energy Price (Tariff)

Report the current energy price and tariff tier. Unlike the device telemetry
skills, the tariff is **not on-chain** — it's a local JSON file written by the
tariff simulator. Read the file directly; do not use `smartclaws read` for this.

This skill is **read-only** and safe for anyone.

The file path is the fixed constant `TARIFF_FILE` in `AGENTS.md`.

---

## How to read

```bash
cat {{WORKSPACE_ROOT}}/controller/tariff.json
```

The file is rewritten frequently (about once per second).

### Freshness — check before trusting

The data is only current if it was written recently. Treat it as **stale if
`updated_at_iso` is more than 30 seconds old**, and say so rather than
presenting old prices as current.

```bash
python3 -c "
import json, os, datetime as dt
d = json.load(open('{{WORKSPACE_ROOT}}/controller/tariff.json'))
u = dt.datetime.fromisoformat(d['updated_at_iso'].replace('Z','+00:00'))
age = (dt.datetime.now(dt.timezone.utc) - u).total_seconds()
print('tier:', d['now']['tier'], '| price_eur_mwh:', d['now']['price_eur_mwh'],
      '| ends_in_s:', d['now']['tier_ends_in_s'], '| age_s:', round(age,1),
      '| STALE' if age > 30 else '| fresh')
"
```

If the file is missing or malformed, say the price signal is unavailable — do
not guess.

---

## File schema

```json
{
  "updated_at_iso": "2026-05-29T12:00:00Z",
  "now": {
    "price_eur_mwh": 87.4,
    "tier": "expensive",
    "tier_started_s_ago": 45,
    "tier_ends_in_s": 124
  },
  "lookahead": [
    {"offset_s": 0,  "price_eur_mwh": 87.4, "tier": "expensive"},
    {"offset_s": 30, "price_eur_mwh": 92.1, "tier": "expensive"},
    {"offset_s": 60, "price_eur_mwh": 68.0, "tier": "mid"}
  ]
}
```

| Field | Meaning |
|---|---|
| `updated_at_iso` | When the file was last written (freshness check) |
| `now.price_eur_mwh` | Current price, EUR per MWh |
| `now.tier` | Current tier: `cheap`, `mid`, or `expensive` |
| `now.tier_started_s_ago` | Seconds since the current tier began |
| `now.tier_ends_in_s` | Seconds until the current tier ends |
| `lookahead[].offset_s` | Seconds from now when that future interval starts |
| `lookahead[].price_eur_mwh` | Price for that future interval |
| `lookahead[].tier` | Tier for that future interval |

---

## Answering people

- For "how expensive is energy right now?" → report `now.tier` and
  `now.price_eur_mwh`, and how long it lasts (`now.tier_ends_in_s`).
- For "is it about to get cheaper / more expensive?" → scan `lookahead[]` for
  the next tier change and report when it happens and to what tier.
- Always respect the freshness check — if the data is stale or missing, say so
  plainly instead of reporting an old price as current.