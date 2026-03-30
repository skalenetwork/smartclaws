import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "./config.ts";

export interface DeviceFile {
  name: string;
  deviceContract: string;
  incomingChannel: string;
  outgoingChannel: string;
}

function devicesDir(): string {
  return join(getConfigDir(), "devices");
}

function devicePath(name: string): string {
  return join(devicesDir(), `${name}.json`);
}

export function saveDevice(device: DeviceFile): void {
  writeFileSync(devicePath(device.name), `${JSON.stringify(device, null, 2)}\n`);
}

export function loadDevice(name: string): DeviceFile | null {
  const path = devicePath(name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as DeviceFile;
}

export function listDevices(): DeviceFile[] {
  const dir = devicesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as DeviceFile);
}
