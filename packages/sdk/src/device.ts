import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DeviceFile, HydratedDeviceFile } from "@smartclaws/core/types";
import { getAddress, isAddress } from "viem";
import { ensureConfigDir, getConfigDir } from "./config.js";

export type { DeviceFile, HydratedDeviceFile };

export function isHydratedDevice(device: DeviceFile): device is HydratedDeviceFile {
    return Boolean(device.incomingChannel && device.outgoingChannel);
}

function devicesDir(homeDir?: string): string {
    return join(getConfigDir(homeDir), "devices");
}

function recordFileName(value: string): string {
    return isAddress(value) ? getAddress(value) : encodeURIComponent(value);
}

function devicePath(address: string, homeDir?: string): string {
    return join(devicesDir(homeDir), `${recordFileName(address)}.json`);
}

export function saveDevice(device: DeviceFile, homeDir?: string): void {
    ensureConfigDir(homeDir);
    const dir = devicesDir(homeDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = devicePath(device.deviceContract, homeDir);
    const existing = existsSync(path)
        ? (JSON.parse(readFileSync(path, "utf-8")) as DeviceFile)
        : undefined;
    const record =
        existing && isHydratedDevice(existing) && !isHydratedDevice(device)
            ? {
                  ...existing,
                  ...device,
                  hydration: existing.hydration,
                  incomingChannel: existing.incomingChannel,
                  outgoingChannel: existing.outgoingChannel,
                  capabilities: existing.capabilities,
                  createdAt: existing.createdAt,
              }
            : device;
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
}

export function loadDevice(addressOrName: string, homeDir?: string): DeviceFile | null {
    if (isAddress(addressOrName)) {
        const path = devicePath(addressOrName, homeDir);
        if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8")) as DeviceFile;
    }
    return (
        listDevices(homeDir).find(
            (device) =>
                device.name === addressOrName ||
                device.deviceContract.toLowerCase() === addressOrName.toLowerCase(),
        ) ?? null
    );
}

export function listDevices(homeDir?: string): DeviceFile[] {
    const dir = devicesDir(homeDir);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as DeviceFile);
}
