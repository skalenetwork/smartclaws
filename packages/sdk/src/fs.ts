import {
    chmodSync,
    closeSync,
    fsyncSync,
    openSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";

/**
 * Write `body` to `path` by replacing a sibling temp file. Close/flush the temp
 * file before the rename so a crash cannot leave a truncated `config.json`.
 */
export function atomicWriteFile(path: string, body: string, mode?: number): void {
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, body, mode === undefined ? undefined : { mode });
    try {
        const fd = openSync(tempPath, "r");
        try {
            fsyncSync(fd);
        } finally {
            closeSync(fd);
        }
        renameSync(tempPath, path);
        if (mode !== undefined) chmodSync(path, mode);
    } catch (error) {
        try {
            unlinkSync(tempPath);
        } catch {
            // Report the original failure, not a cleanup failure.
        }
        throw error;
    }
}

export function atomicWriteJson(path: string, value: unknown, mode?: number): void {
    atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`, mode);
}
