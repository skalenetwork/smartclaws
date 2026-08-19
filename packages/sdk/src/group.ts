import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GroupFile, HydratedGroupFile } from "@smartclaws/core/types";
import { getAddress, isAddress } from "viem";
import { ensureConfigDir, getConfigDir } from "./config.js";

export type { GroupFile, HydratedGroupFile };

export function isHydratedGroup(group: GroupFile): group is HydratedGroupFile {
    return Array.isArray(group.devices);
}

function groupsDir(homeDir?: string): string {
    return join(getConfigDir(homeDir), "groups");
}

function recordFileName(value: string): string {
    return isAddress(value) ? getAddress(value) : encodeURIComponent(value);
}

function groupPath(value: string, homeDir?: string): string {
    return join(groupsDir(homeDir), `${recordFileName(value)}.json`);
}

export function saveGroup(group: GroupFile, homeDir?: string): void {
    ensureConfigDir(homeDir);
    const dir = groupsDir(homeDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = groupPath(group.groupAddress, homeDir);
    const existing = existsSync(path)
        ? (JSON.parse(readFileSync(path, "utf-8")) as GroupFile)
        : undefined;
    const record =
        existing && isHydratedGroup(existing) && !isHydratedGroup(group)
            ? {
                  ...existing,
                  ...group,
                  hydration: existing.hydration,
                  devices: existing.devices,
                  plainDevices: existing.plainDevices,
                  encryptedDevices: existing.encryptedDevices,
                  capabilities: group.capabilities ?? existing.capabilities,
              }
            : group;
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
}

export function loadGroup(addressOrName: string, homeDir?: string): GroupFile | null {
    if (isAddress(addressOrName)) {
        const direct = groupPath(addressOrName, homeDir);
        if (existsSync(direct)) return JSON.parse(readFileSync(direct, "utf-8")) as GroupFile;
    }
    return (
        listGroups(homeDir).find(
            (g) =>
                g.name === addressOrName ||
                g.groupAddress.toLowerCase() === addressOrName.toLowerCase(),
        ) ?? null
    );
}

export function listGroups(homeDir?: string): GroupFile[] {
    const dir = groupsDir(homeDir);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as GroupFile);
}
