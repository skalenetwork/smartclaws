// Bounded, observation-only verification worker. Verification runs after the
// user-visible response has finished streaming and must never delay a turn.
import type { RecordStore } from "./status.js";
import {
    combineStatus,
    deriveEvidence,
    type VerificationJobInput,
    type VerificationRecord,
} from "./types.js";
import { describeError } from "./util.js";
import { type VerifyDeps, verifyMessage } from "./verify.js";

export const MAX_CONCURRENT_JOBS = 2;
export const MAX_PENDING_JOBS = 100;
/** Hard deadline for a single verification job. */
export const JOB_DEADLINE_MS = 30_000;

interface QueuedJob {
    input: VerificationJobInput;
    controller: AbortController;
}

/**
 * Runs verification jobs off the request path. Enforces concurrency and pending
 * limits, per-job deadlines, and clean shutdown that aborts in-flight work and
 * clears queued credentials.
 */
export class VerificationWorker {
    private readonly queue: QueuedJob[] = [];
    private readonly activeControllers = new Set<AbortController>();
    private active = 0;
    private shuttingDown = false;
    private readonly deadlineMs: number;

    constructor(
        private readonly store: RecordStore,
        private readonly deps: VerifyDeps,
        options?: { deadlineMs?: number },
    ) {
        this.deadlineMs = options?.deadlineMs ?? JOB_DEADLINE_MS;
    }

    /**
     * Enqueue a captured message for verification. Returns false and records a
     * SKIP when the queue is saturated; the API key is released immediately in
     * that case.
     */
    enqueue(input: VerificationJobInput): boolean {
        if (this.shuttingDown || this.queue.length >= MAX_PENDING_JOBS) {
            this.store.add(overflowRecord(input, this.deps.now?.() ?? Date.now()));
            scrub(input);
            return false;
        }
        this.queue.push({ input, controller: new AbortController() });
        this.pump();
        return true;
    }

    private pump(): void {
        while (this.active < MAX_CONCURRENT_JOBS && this.queue.length > 0) {
            const job = this.queue.shift();
            if (!job) break;
            this.active += 1;
            void this.run(job).finally(() => {
                this.active -= 1;
                this.pump();
            });
        }
    }

    private async run(job: QueuedJob): Promise<void> {
        this.activeControllers.add(job.controller);
        const timeout = setTimeout(() => job.controller.abort(), this.deadlineMs);
        try {
            const record = await verifyMessage(job.input, this.deps, job.controller.signal);
            // Do not repopulate the store after shutdown cleared it.
            if (!this.shuttingDown) this.store.add(record);
        } catch (err) {
            if (!this.shuttingDown)
                this.store.add(failureRecord(job.input, err, this.deps.now?.() ?? Date.now()));
        } finally {
            clearTimeout(timeout);
            this.activeControllers.delete(job.controller);
            scrub(job.input);
        }
    }

    /** Abort all in-flight and queued jobs and clear their credentials. */
    shutdown(): void {
        this.shuttingDown = true;
        for (const controller of this.activeControllers) controller.abort();
        this.activeControllers.clear();
        for (const job of this.queue) scrub(job.input);
        this.queue.length = 0;
    }

    /** Number of jobs waiting to start (for diagnostics/tests). */
    get pending(): number {
        return this.queue.length;
    }
}

/** Overwrite the credential in a settled/dropped job input. */
function scrub(input: VerificationJobInput): void {
    input.apiKey = "";
}

function overflowRecord(input: VerificationJobInput, now: number): VerificationRecord {
    const checks: VerificationRecord["checks"] = [
        {
            name: "queue",
            result: "SKIP",
            detail: "verification queue saturated",
        },
    ];
    return baseRecord(input, checks, now);
}

function failureRecord(input: VerificationJobInput, err: unknown, now: number): VerificationRecord {
    const checks: VerificationRecord["checks"] = [
        {
            name: "verification",
            result: "FAIL",
            detail: describeError(err),
        },
    ];
    return baseRecord(input, checks, now);
}

function baseRecord(
    input: VerificationJobInput,
    checks: VerificationRecord["checks"],
    now: number,
): VerificationRecord {
    const status = combineStatus(checks);
    return {
        startedAt: now,
        durationMs: 0,
        sessionId: input.sessionId,
        endpoint: input.endpoint,
        model: input.model,
        chatId: input.chatId,
        requestHash: input.requestHash,
        responseHash: input.responseHash,
        checks,
        status,
        evidence: deriveEvidence(status, false),
    };
}
