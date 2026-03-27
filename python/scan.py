import asyncio
from bleak import BleakScanner

async def scan():
    devices = await BleakScanner.discover(timeout=10)
    for d in devices:
        if d.name and "LYWSD03" in d.name:
            print(f"{d.name} -> {d.address}")

asyncio.run(scan())