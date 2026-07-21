#!/usr/bin/env python3
"""
dev/find-shelly.py — Discover Shelly devices on the local network.

Parallel-scans all hosts in local /24 subnets (60 workers, 1 s timeout).
Typically completes in 5-10 seconds. No pip installs required — stdlib only.
"""

import ipaddress
import json
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

PROBE_TIMEOUT = 1.0
WORKERS = 60


def probe(ip: str) -> tuple[str, dict] | None:
    try:
        with urllib.request.urlopen(
            f"http://{ip}/rpc/Shelly.GetDeviceInfo", timeout=PROBE_TIMEOUT
        ) as r:
            data = json.loads(r.read())
        if "mac" in data:
            return ip, data
    except Exception:
        pass
    return None


def subnet_hosts() -> list[str]:
    for cmd in [
        ["ip", "-o", "-4", "addr", "show", "scope", "global"],  # Linux
        ["ifconfig"],                                              # macOS
    ]:
        try:
            out = subprocess.check_output(cmd, text=True, timeout=3, stderr=subprocess.DEVNULL)
            nets: list[ipaddress.IPv4Network] = []
            for line in out.splitlines():
                for token in line.split():
                    if "/" not in token:
                        continue
                    try:
                        iface = ipaddress.IPv4Interface(token)
                        if not iface.ip.is_private:
                            continue
                        net = iface.network
                        if net.prefixlen < 24:
                            net = ipaddress.IPv4Network(f"{iface.ip}/24", strict=False)
                        nets.append(net)
                    except ValueError:
                        pass
            if nets:
                return [str(h) for net in nets for h in net.hosts()]
        except Exception:
            continue
    return []


def main() -> None:
    hosts = subnet_hosts()
    if not hosts:
        print("Could not determine local subnet. Set SHELLY_HOST manually.")
        sys.exit(1)

    print(f"Scanning {len(hosts)} hosts...")

    results: list[tuple[str, dict]] = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(probe, ip): ip for ip in hosts}
        for future in as_completed(futures):
            result = future.result()
            if result:
                results.append(result)

    if not results:
        print("No Shelly device found. Check the device is powered and on the same network.")
        sys.exit(1)

    print()
    for ip, info in results:
        gen = info.get("gen", "?")
        model = info.get("model") or info.get("app") or "?"
        name = info.get("name", "")
        mac = info.get("mac", "?")
        label = f"{model}" + (f" ({name})" if name else "")
        print(f"  {ip}  —  {label}  gen{gen}  MAC {mac}")

    if len(results) == 1:
        print(f"\nexport SHELLY_HOST={results[0][0]}")
    else:
        print("\nMultiple devices found — pick one:")
        print("  export SHELLY_HOST=<ip>")


if __name__ == "__main__":
    main()
