import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DeviceFile } from "@smartclaws/core/types";
import { getConfigDir } from "./config.js";

export type { DeviceFile };

function devicesDir(homeDir?: string): string {
  return join(getConfigDir(homeDir), "devices");
}

function devicePath(name: string, homeDir?: string): string {
  return join(devicesDir(homeDir), `${name}.json`);
}

export function saveDevice(device: DeviceFile, homeDir?: string): void {
  writeFileSync(devicePath(device.name, homeDir), `${JSON.stringify(device, null, 2)}\n`);
}

export function loadDevice(name: string, homeDir?: string): DeviceFile | null {
  const path = devicePath(name, homeDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as DeviceFile;
}

export function listDevices(homeDir?: string): DeviceFile[] {
  const dir = devicesDir(homeDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as DeviceFile);
}
