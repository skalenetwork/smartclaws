import asyncio
from bleak import BleakClient, BleakScanner
from datetime import datetime

# The GATT characteristic that sends temp/humidity notifications
DATA_CHAR = "ebe0ccc1-7a0a-4b0c-8a1a-6ff2997da3a6"


async def scan():
    devices = await BleakScanner.discover(timeout=10)
    for d in devices:
        if d.name and "LYWSD03" in d.name:
            print(f"{d.name} -> {d.address}")


async def read(address: str):
    async with BleakClient(address) as client:
        data = await client.read_gatt_char(DATA_CHAR)
        temp = int.from_bytes(data[0:2], "little", signed=True) / 100
        humi = data[2]
        voltage = int.from_bytes(data[3:5], "little") / 1000
        print(f"Temperature: {temp}°C")
        print(f"Humidity: {humi}%")
        print(f"Voltage: {voltage}V")


async def read_loop(address: str, interval: float = 2.0):
    async with BleakClient(address) as client:  # connect once
        while True:
            data = await client.read_gatt_char(DATA_CHAR)
            temp = int.from_bytes(data[0:2], "little", signed=True) / 100
            humi = data[2]
            print(f"{temp}°C / {humi}%")
            print(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
            await asyncio.sleep(interval)


# Scan to find MACs (only needed once):
# asyncio.run(scan())

# Read with your known MAC:
# asyncio.run(read("229C6152-3E39-45DB-3A8B-D48CB72D171F"))
# asyncio.run(read("99C9B552-C48E-0764-B56E-916ADDD6A0EA"))
asyncio.run(read_loop("99C9B552-C48E-0764-B56E-916ADDD6A0EA", interval=0))
