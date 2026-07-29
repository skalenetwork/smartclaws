// Verification record store and session-scoped lookup for the `/nearai-verify`
// command. Records are held in bounded rings so memory stays flat, and lookups
// are confined to the caller's session so a chat id cannot become a
// cross-session lookup oracle.
import type { VerificationRecord } from "./types.js";

export const MAX_RECORDS_PER_SESSION = 50;
export const MAX_GLOBAL_RECORDS = 200;
export const MAX_TRACKED_SESSIONS = 200;

class RingBuffer<T> {
    private readonly items: T[] = [];
    constructor(private readonly capacity: number) {}
    push(item: T): void {
        this.items.push(item);
        if (this.items.length > this.capacity) this.items.shift();
    }
    toArray(): T[] {
        return [...this.items];
    }
    clear(): void {
        this.items.length = 0;
    }
}

export class RecordStore {
    private readonly bySession = new Map<string, RingBuffer<VerificationRecord>>();
    private readonly global = new RingBuffer<VerificationRecord>(MAX_GLOBAL_RECORDS);
    private readonly maxPerSession: number;
    private readonly maxSessions: number;

    constructor(options?: { maxPerSession?: number; maxSessions?: number }) {
        this.maxPerSession = options?.maxPerSession ?? MAX_RECORDS_PER_SESSION;
        this.maxSessions = options?.maxSessions ?? MAX_TRACKED_SESSIONS;
    }

    /** Record a settled verification. Session-scoped when a session id exists. */
    add(record: VerificationRecord): void {
        if (record.sessionId) {
            let ring = this.bySession.get(record.sessionId);
            if (!ring) {
                if (this.bySession.size >= this.maxSessions) {
                    const oldestSessionId = this.bySession.keys().next().value;
                    if (oldestSessionId !== undefined) this.bySession.delete(oldestSessionId);
                }
                ring = new RingBuffer<VerificationRecord>(this.maxPerSession);
                this.bySession.set(record.sessionId, ring);
            } else {
                // Refresh insertion order so active sessions are retained preferentially.
                this.bySession.delete(record.sessionId);
                this.bySession.set(record.sessionId, ring);
            }
            ring.push(record);
        } else {
            this.global.push(record);
        }
    }

    /**
     * Look up records for a `/nearai-verify` request. Results are limited to the
     * caller's session. When there is no session id, only an owner may read the
     * global fallback ring.
     */
    query(params: {
        sessionId?: string;
        isOwner: boolean;
        selector: "latest" | { chatId: string };
    }): VerificationRecord[] {
        const scope = params.sessionId
            ? (this.bySession.get(params.sessionId)?.toArray() ?? [])
            : params.isOwner
              ? this.global.toArray()
              : [];

        const selector = params.selector;
        if (selector === "latest") {
            const last = scope.at(-1);
            return last ? [last] : [];
        }
        return scope.filter((r) => r.chatId === selector.chatId);
    }

    /** Drop all records (used on plugin disable/reload). */
    clear(): void {
        this.bySession.clear();
        this.global.clear();
    }
}

/** Parse the `/nearai-verify` argument into a selector. */
export function parseCommandSelector(arg: string | undefined): "latest" | { chatId: string } {
    const trimmed = (arg ?? "").trim();
    if (trimmed === "" || trimmed.toLowerCase() === "latest") return "latest";
    return { chatId: trimmed };
}

/** Render a compact, non-sensitive summary of records for the command reply. */
export function formatRecords(records: VerificationRecord[]): string {
    if (records.length === 0) return "No matching nearai-verify records.";
    return records
        .map((r) => {
            const checks = r.checks.map((c) => `${c.name}: ${c.result}`).join(", ");
            return [
                `chat ${r.chatId ?? "?"} — ${r.status} / ${r.evidence}`,
                `  endpoint: ${r.endpoint}`,
                `  model: ${r.model}`,
                r.signingAddress ? `  signer: ${r.signingAddress}` : undefined,
                `  checks: ${checks || "(none)"}`,
            ]
                .filter(Boolean)
                .join("\n");
        })
        .join("\n\n");
}
