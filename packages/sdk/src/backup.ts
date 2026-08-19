import { createHash } from "node:crypto";
import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { Config } from "@smartclaws/core/types";
import { listAgents } from "./agent.js";
import {
    assertHomeWallet,
    CURRENT_CONFIG_VERSION,
    ensureConfigDir,
    getConfigDir,
    loadConfig,
} from "./config.js";
import { listDevices } from "./device.js";
import { SmartClawsError } from "./errors.js";
import {
    backupFingerprint,
    candidateSetFingerprint,
    homeFingerprint,
    requireHomeFingerprint,
} from "./fingerprint.js";
import { listGroups } from "./group.js";
import { loadWallet } from "./wallet.js";

/** Top-level entries under the HOME that are never copied into a backup. */
const EXCLUDED_DIRS = new Set(["backups", "cache"]);
const BACKUP_PREFIX = "backup-";

/**
 * Copy every top-level entry of `from` into `to`, skipping {@link EXCLUDED_DIRS}.
 * Copying entry-by-entry (rather than the directory itself) avoids cpSync's
 * "cannot copy to a subdirectory of self" guard, since backups live under the
 * HOME being copied.
 */
function copyHomeEntries(from: string, to: string): void {
    if (!existsSync(to)) mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        cpSync(join(from, entry.name), join(to, entry.name), { recursive: true });
    }
}

/** Remove every top-level entry of the HOME except `backups/`. */
function clearHomeExceptBackups(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
        if (entry === "backups") continue;
        rmSync(join(dir, entry), { recursive: true, force: true });
    }
}

/**
 * Validate `name` as a plain backup directory name and return its absolute path.
 * Rejects anything that is not a bare basename (no path separators, no `..`) or
 * does not start with the backup prefix, so a crafted name cannot escape the
 * backups directory. Throws `ENTITY_NOT_FOUND` when the backup is missing.
 */
function resolveBackupPath(name: string, homeDir?: string): string {
    if (!name.startsWith(BACKUP_PREFIX) || basename(name) !== name) {
        throw new SmartClawsError("ENTITY_NOT_FOUND", `Backup '${name}' was not found.`, { name });
    }
    const path = join(getBackupsDir(homeDir), name);
    if (!existsSync(path)) {
        throw new SmartClawsError("ENTITY_NOT_FOUND", `Backup '${name}' was not found.`, { name });
    }
    return path;
}

export function getBackupsDir(homeDir?: string): string {
    return join(getConfigDir(homeDir), "backups");
}

/** True when the HOME holds real state (a config or a wallet), not just dirs. */
export function homeExists(homeDir?: string): boolean {
    const dir = getConfigDir(homeDir);
    return existsSync(join(dir, "config.json")) || existsSync(join(dir, "wallets", "default.json"));
}

export interface HomeSummary {
    /** Raw on-disk config version (null when no config file exists, or it is unparseable). */
    configVersion: number | null;
    /**
     * True when a config file exists but is not the current version, so the HOME cannot
     * be loaded and must be reset. Covers every superseded version, not just v1.
     */
    staleConfig: boolean;
    /** Wallet address only — never the private key. */
    walletAddress: string | null;
    network: string;
    mode: string;
    chainId: number;
    contractAddress: string;
    attachedGroupAddress: string;
    attachedAgentAddress: string;
    deviceCount: number;
    groupCount: number;
    agentCount: number;
}

/**
 * Describe an existing HOME without mutating it or reading any secret. Reads the
 * config file raw to report its on-disk version, then uses a loaded v3 config
 * for the rest when one is present.
 */
export function summarizeHome(homeDir?: string): HomeSummary {
    const dir = getConfigDir(homeDir);
    const configPath = join(dir, "config.json");

    const configExists = existsSync(configPath);
    let configVersion: number | null = null;
    if (configExists) {
        try {
            const raw = JSON.parse(readFileSync(configPath, "utf-8")) as { version?: number };
            configVersion = typeof raw.version === "number" ? raw.version : null;
        } catch {
            configVersion = null;
        }
    }

    // An unloadable config still describes a real HOME worth summarizing: the wallet and
    // the on-disk records are read independently, so the caller can report what is there
    // before resetting it.
    const config: Config | null = (() => {
        try {
            return loadConfig(homeDir);
        } catch {
            return null;
        }
    })();
    const wallet = loadWallet(homeDir);

    return {
        configVersion,
        staleConfig: configExists && configVersion !== CURRENT_CONFIG_VERSION,
        walletAddress: wallet?.address ?? config?.walletAddress ?? null,
        network: config?.network ?? "",
        mode: config?.mode ?? "",
        chainId: config?.chainId ?? 0,
        contractAddress: config?.contractAddress ?? "",
        attachedGroupAddress: config?.attachedGroupAddress ?? config?.deviceGroupAddress ?? "",
        attachedAgentAddress: config?.attachedAgentAddress ?? "",
        deviceCount: listDevices(homeDir).length,
        groupCount: listGroups(homeDir).length,
        agentCount: listAgents(homeDir).length,
    };
}

export interface BackupInfo {
    name: string;
    path: string;
    /** Backup creation time (epoch ms), from the directory mtime. */
    createdAt: number;
    sizeBytes: number;
    /** Digest of relative paths, file modes, and file contents. */
    contentDigest: string;
}

export interface BackupResult {
    name: string;
    path: string;
    fileCount: number;
}

function timestampName(date = new Date()): string {
    // backup-YYYYMMDD-HHMMSSZ (UTC, lexicographically sortable).
    const iso = date.toISOString(); // 2026-06-29T14:30:00.000Z
    const compact = iso.slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    return `${BACKUP_PREFIX}${compact}Z`;
}

function dirSize(dir: string): { bytes: number; files: number } {
    let bytes = 0;
    let files = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            const sub = dirSize(full);
            bytes += sub.bytes;
            files += sub.files;
        } else if (entry.isFile()) {
            bytes += statSync(full).size;
            files += 1;
        }
    }
    return { bytes, files };
}

function directoryContentDigest(dir: string): string {
    const hash = createHash("sha256");
    const walk = (current: string, relative: string): void => {
        const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) =>
            left.name.localeCompare(right.name),
        );
        for (const entry of entries) {
            const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
            const full = join(current, entry.name);
            if (entry.isDirectory()) {
                hash.update(`directory\0${entryRelative}\0`);
                walk(full, entryRelative);
            } else if (entry.isFile()) {
                const stat = statSync(full);
                hash.update(`file\0${entryRelative}\0${stat.mode & 0o777}\0${stat.size}\0`);
                hash.update(readFileSync(full));
                hash.update("\0");
            }
        }
    };
    walk(dir, "");
    return hash.digest("hex");
}

export interface HomeResetResult {
    /** The snapshot taken before clearing. The only surviving copy of the old records. */
    backup: BackupResult;
    /** True when a wallet was carried across; false when the HOME had none to begin with. */
    walletPreserved: boolean;
}

/**
 * Back up the HOME, then clear it apart from `backups/` and the wallet.
 *
 * Used when the config predates {@link CURRENT_CONFIG_VERSION}. A config-only reset is
 * not enough: `groups/`, `devices/` and `agents/` name contracts registered under the
 * superseded registry, so keeping them would leave a current config resolving device
 * names to entities in the abandoned deployment — which fails silently, by publishing
 * to the wrong channel rather than erroring.
 *
 * The wallet is the one thing that stays: it is a chain-independent keypair, it holds
 * the account balance, and it lives in its own file, so nothing about the reset needs
 * to touch it. Callers must warn before calling — the backup becomes the only copy of
 * everything else.
 */
export function resetHomePreservingWallet(homeDir?: string): HomeResetResult {
    const dir = getConfigDir(homeDir);
    const backup = createBackup(homeDir);

    clearHomeExceptBackups(dir);
    ensureConfigDir(homeDir);

    const savedWallet = join(backup.path, "wallets", "default.json");
    const walletPreserved = existsSync(savedWallet);
    if (walletPreserved) {
        const restored = join(dir, "wallets", "default.json");
        cpSync(savedWallet, restored);
        chmodSync(restored, 0o600);
    }

    return { backup, walletPreserved };
}

/**
 * Snapshot the HOME into `backups/<name>/`, excluding `backups/` (never nest)
 * and `cache/` (regenerable). The copied wallet keeps `0600` perms. The backup
 * contains the wallet file, which holds a private key — keep it local.
 */
export function createBackup(homeDir?: string): BackupResult {
    const dir = getConfigDir(homeDir);
    if (!homeExists(homeDir)) {
        throw new SmartClawsError("NOT_INITIALIZED", "No SmartClaws HOME to back up.", { dir });
    }

    const backupsDir = getBackupsDir(homeDir);
    if (!existsSync(backupsDir)) mkdirSync(backupsDir, { recursive: true });

    let name = timestampName();
    // Guard against two backups within the same second.
    if (existsSync(join(backupsDir, name))) {
        name = `${name}-${Date.now() % 1000}`;
    }
    const dest = join(backupsDir, name);

    copyHomeEntries(dir, dest);

    const copiedWallet = join(dest, "wallets", "default.json");
    if (existsSync(copiedWallet)) chmodSync(copiedWallet, 0o600);

    const { files } = dirSize(dest);
    return { name, path: dest, fileCount: files };
}

export function listBackups(homeDir?: string): BackupInfo[] {
    const backupsDir = getBackupsDir(homeDir);
    if (!existsSync(backupsDir)) return [];
    return readdirSync(backupsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name.startsWith(BACKUP_PREFIX))
        .map((e) => {
            const path = join(backupsDir, e.name);
            return {
                name: e.name,
                path,
                createdAt: statSync(path).mtimeMs,
                sizeBytes: dirSize(path).bytes,
                contentDigest: directoryContentDigest(path),
            };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
}

export interface PresentedBackup {
    name: string;
    createdAt: string;
    sizeBytes: number;
    fingerprint: string;
}

export function presentBackup(info: BackupInfo): PresentedBackup {
    return {
        name: info.name,
        createdAt: new Date(info.createdAt).toISOString(),
        sizeBytes: info.sizeBytes,
        fingerprint: backupFingerprint(info),
    };
}

export function listPresentedBackups(homeDir?: string): PresentedBackup[] {
    return listBackups(homeDir).map(presentBackup);
}

export function presentCreatedBackup(
    result: BackupResult,
    homeDir?: string,
): {
    name: string;
    fileCount: number;
    fingerprint: string;
    containsSigningKey: true;
} {
    const listed = listBackups(homeDir).find((item) => item.name === result.name);
    return {
        name: result.name,
        fileCount: result.fileCount,
        fingerprint: listed
            ? backupFingerprint(listed)
            : backupFingerprint({
                  name: result.name,
                  createdAt: 0,
                  sizeBytes: 0,
                  contentDigest: "",
              }),
        containsSigningKey: true,
    };
}

export function previewBackupCleanup(
    homeDir: string | undefined,
    opts: CleanOptions,
): { candidates: PresentedBackup[]; candidateFingerprint: string } {
    const candidates = cleanBackups(homeDir, { ...opts, dryRun: true });
    return {
        candidates: candidates.map(presentBackup),
        candidateFingerprint: candidateSetFingerprint(candidates),
    };
}

export function executeBackupCleanup(
    homeDir: string | undefined,
    params: { candidateFingerprint: string; names: string[] },
): { removed: string[] } {
    const uniqueNames = [...new Set(params.names)];
    const backups = listBackups(homeDir);
    const selected = uniqueNames.map((name) => {
        const match = backups.find((item) => item.name === name);
        if (!match) {
            throw new SmartClawsError(
                "STATE_CHANGED",
                `Backup '${name}' is no longer present. Re-run preview.`,
                { name },
            );
        }
        return match;
    });
    const actual = candidateSetFingerprint(selected);
    if (actual !== params.candidateFingerprint) {
        throw new SmartClawsError(
            "STATE_CHANGED",
            "Backup candidate set changed since preview. Re-run preview.",
            { expected: params.candidateFingerprint, actual },
        );
    }
    for (const item of selected) deleteBackup(item.name, homeDir);
    return { removed: selected.map((item) => item.name) };
}

export function restoreBackupChecked(params: {
    homeDir: string;
    name: string;
    expectedHomeFingerprint: string;
    expectedBackupFingerprint: string;
}): {
    restored: string;
    safetyBackup: string | null;
    walletAddress: string | null;
    fingerprint: string;
} {
    requireHomeFingerprint(params.homeDir, params.expectedHomeFingerprint);
    const listed = listBackups(params.homeDir).find((item) => item.name === params.name);
    if (!listed) {
        throw new SmartClawsError("ENTITY_NOT_FOUND", `Backup '${params.name}' was not found.`, {
            name: params.name,
        });
    }
    if (backupFingerprint(listed) !== params.expectedBackupFingerprint) {
        throw new SmartClawsError(
            "STATE_CHANGED",
            "Backup contents changed since the expected fingerprint was taken.",
            { name: params.name },
        );
    }
    const { safetyBackup } = restoreBackup(params.name, params.homeDir);
    const config = (() => {
        try {
            return loadConfig(params.homeDir);
        } catch {
            return null;
        }
    })();
    const wallet = loadWallet(params.homeDir);
    if (config && wallet) assertHomeWallet(config, wallet);
    return {
        restored: params.name,
        safetyBackup,
        walletAddress: wallet?.address ?? config?.walletAddress ?? null,
        fingerprint: homeFingerprint(params.homeDir),
    };
}

export function deleteBackup(name: string, homeDir?: string): void {
    const path = resolveBackupPath(name, homeDir);
    rmSync(path, { recursive: true, force: true });
}

export interface CleanOptions {
    /** Remove every backup. */
    all?: boolean;
    /** Keep the newest N backups, remove the rest. */
    keep?: number;
    /** Remove backups older than this many days. */
    olderThanDays?: number;
    /** Compute the set that would be removed without deleting anything. */
    dryRun?: boolean;
}

/**
 * Remove backups according to `opts` and return the entries that were deleted
 * (or, with `dryRun`, that would be deleted). No selector is implied — the
 * caller must pass `all`, `keep`, or `olderThanDays`. Retention is manual:
 * nothing here runs automatically.
 */
export function cleanBackups(homeDir: string | undefined, opts: CleanOptions): BackupInfo[] {
    if (!opts.all && opts.keep === undefined && opts.olderThanDays === undefined) {
        throw new SmartClawsError(
            "INVALID_RANGE",
            "Specify what to clean: --all, --keep <n>, or --older-than <days>.",
        );
    }

    const backups = listBackups(homeDir); // newest first
    let toRemove: BackupInfo[];

    if (opts.all) {
        toRemove = backups;
    } else {
        const removeSet = new Set<string>();
        if (opts.keep !== undefined) {
            if (!Number.isSafeInteger(opts.keep) || opts.keep < 0) {
                throw new SmartClawsError(
                    "INVALID_RANGE",
                    "`--keep` must be a non-negative integer.",
                    {
                        keep: opts.keep,
                    },
                );
            }
            for (const b of backups.slice(opts.keep)) removeSet.add(b.name);
        }
        if (opts.olderThanDays !== undefined) {
            if (!Number.isFinite(opts.olderThanDays) || opts.olderThanDays < 0) {
                throw new SmartClawsError(
                    "INVALID_RANGE",
                    "`--older-than` must be a non-negative number of days.",
                    { olderThanDays: opts.olderThanDays },
                );
            }
            const cutoff = Date.now() - opts.olderThanDays * 24 * 60 * 60 * 1000;
            for (const b of backups) if (b.createdAt < cutoff) removeSet.add(b.name);
        }
        toRemove = backups.filter((b) => removeSet.has(b.name));
    }

    if (!opts.dryRun) {
        for (const b of toRemove) rmSync(b.path, { recursive: true, force: true });
    }
    return toRemove;
}

/**
 * Restore the HOME from a named backup — a true rollback. A safety backup of the
 * current HOME is taken first (when the HOME has state), then all managed HOME
 * entries are cleared (everything except `backups/`) so files created after the
 * snapshot do not linger, and finally the snapshot is copied back over the HOME.
 */
export function restoreBackup(name: string, homeDir?: string): { safetyBackup: string | null } {
    const dir = getConfigDir(homeDir);
    const source = resolveBackupPath(name, homeDir);

    const safetyBackup = homeExists(homeDir) ? createBackup(homeDir).name : null;

    // Clear first so the result matches the snapshot exactly (preserving the
    // backups/ dir, which holds the safety backup and the snapshot itself).
    clearHomeExceptBackups(dir);
    copyHomeEntries(source, dir);

    const restoredWallet = join(dir, "wallets", "default.json");
    if (existsSync(restoredWallet)) chmodSync(restoredWallet, 0o600);

    return { safetyBackup };
}
