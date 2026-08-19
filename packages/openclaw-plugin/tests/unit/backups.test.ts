import { describe, expect, test } from "bun:test";
import {
    createBackup,
    executeBackupCleanup,
    presentCreatedBackup,
    previewBackupCleanup,
    restoreBackupChecked,
    type ToolSpec,
    toolFactory,
} from "./sdk-mock.ts";

const HOME = "/tmp/smartclaws-test";

describe("smartclaws_backup_create", () => {
    test("returns a name and signing-key warning without a path", async () => {
        const { backupCreateTool } = await import("../../src/tools/backups.ts");
        const spec = backupCreateTool(toolFactory as never) as ToolSpec;
        expect(spec.name).toBe("smartclaws_backup_create");
        expect(spec.optional).toBe(true);
        const result = (await spec.execute({}, { smartclawsHome: HOME }, {})) as Record<
            string,
            unknown
        >;
        expect(createBackup).toHaveBeenCalledWith(HOME);
        expect(presentCreatedBackup).toHaveBeenCalled();
        expect(result.containsSigningKey).toBe(true);
        expect(result).not.toHaveProperty("path");
        expect(JSON.stringify(result)).not.toContain("/secret/path");
    });
});

describe("smartclaws_backup_clean", () => {
    test("preview returns a candidate fingerprint; execute deletes only named backups", async () => {
        const { backupCleanTool } = await import("../../src/tools/backups.ts");
        const spec = backupCleanTool(toolFactory as never) as ToolSpec;
        expect(spec.optional).toBe(true);
        const preview = (await spec.execute(
            { mode: "preview", keep: 3 },
            { smartclawsHome: HOME },
            {},
        )) as Record<string, unknown>;
        expect(previewBackupCleanup).toHaveBeenCalledWith(HOME, {
            all: undefined,
            keep: 3,
            olderThanDays: undefined,
        });
        expect(preview.status).toBe("preview");
        expect(preview.candidateFingerprint).toBe("ff".repeat(8));

        const executed = (await spec.execute(
            {
                mode: "execute",
                candidateFingerprint: "ff".repeat(8),
                names: ["backup-old"],
            },
            { smartclawsHome: HOME },
            {},
        )) as Record<string, unknown>;
        expect(executeBackupCleanup).toHaveBeenCalledWith(HOME, {
            candidateFingerprint: "ff".repeat(8),
            names: ["backup-old"],
        });
        expect(executed.removed).toEqual(["backup-old"]);
    });
});

describe("smartclaws_backup_restore", () => {
    test("requires confirm and never returns paths", async () => {
        const { backupRestoreTool } = await import("../../src/tools/backups.ts");
        const spec = backupRestoreTool(toolFactory as never) as ToolSpec;
        await expect(
            spec.execute(
                {
                    name: "backup-20260101-000000Z",
                    expectedHomeFingerprint: "home-fp",
                    expectedBackupFingerprint: "dd".repeat(8),
                    confirm: false,
                },
                { smartclawsHome: HOME },
                {},
            ),
        ).rejects.toThrow(/confirm/);
        expect(restoreBackupChecked).not.toHaveBeenCalled();
        const result = (await spec.execute(
            {
                name: "backup-20260101-000000Z",
                expectedHomeFingerprint: "home-fp",
                expectedBackupFingerprint: "dd".repeat(8),
                confirm: true,
            },
            { smartclawsHome: HOME },
            {},
        )) as Record<string, unknown>;
        expect(result.status).toBe("restored");
        expect(result.safetyBackup).toBe("backup-safety");
        expect(JSON.stringify(result)).not.toContain("/secret/path");
        expect(JSON.stringify(result)).not.toContain("privateKey");
    });
});
