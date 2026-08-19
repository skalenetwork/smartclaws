import {
    createBackup,
    executeBackupCleanup,
    listPresentedBackups,
    presentCreatedBackup,
    previewBackupCleanup,
    restoreBackupChecked,
    SmartClawsError,
} from "@smartclaws/sdk";
import { Type } from "typebox";
import { resolvedHome } from "../plugin-config.js";
import { requireConfirm, throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import type { SmartClawsToolFactory } from "./types.js";

export function backupListTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_backup_list",
        label: "SmartClaws Backup List",
        description:
            "List local SmartClaws HOME backups by name, creation time, size, and fingerprint. Never returns filesystem paths. Backup files contain the signing key — treat names as sensitive operational data, not as something to print into logs with paths.",
        parameters: Type.Object({}),
        execute: async (_params, config, context) => {
            throwIfAborted(context.signal);
            const backups = listPresentedBackups(resolvedHome(config));
            return jsonCompatible({ backups });
        },
    });
}

export function backupCreateTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_backup_create",
        label: "SmartClaws Backup Create",
        description:
            "Create a local HOME backup. Returns the backup name and file count, never the absolute path. The backup contains the signing key. No automatic retries.",
        optional: true,
        parameters: Type.Object({}),
        execute: async (_params, config, context) => {
            throwIfAborted(context.signal);
            const home = resolvedHome(config);
            const created = createBackup(home);
            const presented = presentCreatedBackup(created, home);
            return jsonCompatible({
                status: "created",
                ...presented,
            });
        },
    });
}

export function backupCleanTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_backup_clean",
        label: "SmartClaws Backup Clean",
        description:
            "Preview or execute backup deletion. Preview returns candidate names and a candidate-set fingerprint. Execute recomputes that set, refuses if it changed, and deletes only the named backups. Never apply a retention selector during execute. No automatic retries.",
        optional: true,
        parameters: Type.Object({
            mode: Type.Union([Type.Literal("preview"), Type.Literal("execute")]),
            all: Type.Optional(Type.Boolean({ description: "Preview: include every backup." })),
            keep: Type.Optional(
                Type.Number({ description: "Preview: keep the newest N backups." }),
            ),
            olderThanDays: Type.Optional(
                Type.Number({ description: "Preview: select backups older than this many days." }),
            ),
            candidateFingerprint: Type.Optional(
                Type.String({ description: "Execute: fingerprint from preview." }),
            ),
            names: Type.Optional(
                Type.Array(Type.String(), {
                    description: "Execute: exact backup names to delete.",
                }),
            ),
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            const home = resolvedHome(config);
            if (params.mode === "preview") {
                const preview = previewBackupCleanup(home, {
                    all: params.all,
                    keep: params.keep,
                    olderThanDays: params.olderThanDays,
                });
                return jsonCompatible({
                    status: "preview",
                    candidates: preview.candidates,
                    candidateFingerprint: preview.candidateFingerprint,
                });
            }
            if (!params.candidateFingerprint || !params.names) {
                throw new SmartClawsError(
                    "INVALID_TARGET",
                    "Execute mode requires candidateFingerprint and names from preview.",
                );
            }
            const result = executeBackupCleanup(home, {
                candidateFingerprint: params.candidateFingerprint,
                names: params.names,
            });
            return jsonCompatible({
                status: "removed",
                removed: result.removed,
            });
        },
    });
}

export function backupRestoreTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_backup_restore",
        label: "SmartClaws Backup Restore",
        description:
            "Restore a named HOME backup after creating a safety backup of the current HOME. Requires expected fingerprints and confirm: true. Returns backup names, never paths or key material. No automatic retries.",
        optional: true,
        parameters: Type.Object({
            name: Type.String({ description: "Backup directory name (not a path)." }),
            expectedHomeFingerprint: Type.String({
                description: "Current HOME fingerprint from smartclaws_setup_status.",
            }),
            expectedBackupFingerprint: Type.String({
                description: "Fingerprint of the backup to restore.",
            }),
            confirm: Type.Boolean({ description: "Must be true to proceed." }),
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            requireConfirm(params.confirm, "smartclaws_backup_restore");
            const result = restoreBackupChecked({
                homeDir: resolvedHome(config),
                name: params.name,
                expectedHomeFingerprint: params.expectedHomeFingerprint,
                expectedBackupFingerprint: params.expectedBackupFingerprint,
            });
            return jsonCompatible({
                status: "restored",
                restored: result.restored,
                safetyBackup: result.safetyBackup,
                walletAddress: result.walletAddress,
                fingerprint: result.fingerprint,
            });
        },
    });
}
