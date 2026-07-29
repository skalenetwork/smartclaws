import { describe, expect, test } from "bun:test";
import { AttestationCache } from "../src/cache.js";
import { RecordStore } from "../src/status.js";
import type { VerificationJobInput } from "../src/types.js";
import { MAX_CONCURRENT_JOBS, MAX_PENDING_JOBS, VerificationWorker } from "../src/worker.js";

function input(overrides: Partial<VerificationJobInput> = {}): VerificationJobInput {
    return {
        endpoint: "https://n.completions.near.ai",
        model: "m",
        chatId: "c",
        requestHash: "a".repeat(64),
        responseHash: "b".repeat(64),
        apiKey: "secret-key",
        ...overrides,
    };
}

const rejectingFetch = (async () => {
    throw new Error("no network in test");
}) as unknown as typeof fetch;

const hangingFetch = ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as unknown as typeof fetch;

describe("VerificationWorker", () => {
    test("caps pending work; overflow returns false and records a SKIP", () => {
        const store = new RecordStore();
        const worker = new VerificationWorker(
            store,
            { cache: new AttestationCache(), fetchImpl: hangingFetch },
            {
                deadlineMs: 50,
            },
        );

        const results: boolean[] = [];
        for (let i = 0; i < MAX_CONCURRENT_JOBS + MAX_PENDING_JOBS + 1; i++) {
            results.push(worker.enqueue(input({ chatId: `c${i}` })));
        }
        // First (concurrent + pending) accepted, the last one overflows.
        expect(results.slice(0, MAX_CONCURRENT_JOBS + MAX_PENDING_JOBS).every(Boolean)).toBe(true);
        expect(results.at(-1)).toBe(false);

        const [latest] = store.query({ sessionId: undefined, isOwner: true, selector: "latest" });
        expect(latest?.status).toBe("SKIP");
        expect(latest?.checks[0]?.detail).toContain("saturated");

        worker.shutdown();
    });

    test("runs at most MAX_CONCURRENT_JOBS at once", () => {
        const store = new RecordStore();
        const worker = new VerificationWorker(
            store,
            { cache: new AttestationCache(), fetchImpl: hangingFetch },
            {
                deadlineMs: 50,
            },
        );
        for (let i = 0; i < 5; i++) worker.enqueue(input({ chatId: `c${i}` }));
        expect(worker.pending).toBe(5 - MAX_CONCURRENT_JOBS);
        worker.shutdown();
    });

    test("shutdown clears the queue and scrubs queued credentials", () => {
        const store = new RecordStore();
        const worker = new VerificationWorker(
            store,
            { cache: new AttestationCache(), fetchImpl: hangingFetch },
            {
                deadlineMs: 50,
            },
        );
        // Fill the two concurrent slots, then queue one more we can inspect.
        worker.enqueue(input());
        worker.enqueue(input());
        const queued = input({ apiKey: "queued-secret" });
        worker.enqueue(queued);
        expect(worker.pending).toBe(1);

        worker.shutdown();
        expect(worker.pending).toBe(0);
        expect(queued.apiKey).toBe("");
    });

    test("a settled job scrubs its credential and stores a record", async () => {
        const store = new RecordStore();
        const worker = new VerificationWorker(store, {
            cache: new AttestationCache(),
            fetchImpl: rejectingFetch,
        });
        const job = input({ sessionId: "s1", apiKey: "will-be-cleared" });
        worker.enqueue(job);
        // Let the job settle (signature fetch rejects -> SKIP record).
        await new Promise((r) => setTimeout(r, 10));
        expect(job.apiKey).toBe("");
        expect(store.query({ sessionId: "s1", isOwner: false, selector: "latest" })).toHaveLength(
            1,
        );
    });

    test("shutdown aborts an in-flight job and does not repopulate the store", async () => {
        const store = new RecordStore();
        let capturedSignal: AbortSignal | undefined;
        const capturingFetch = ((_url: unknown, init?: { signal?: AbortSignal }) => {
            capturedSignal = init?.signal;
            return new Promise((_, reject) => {
                init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
            });
        }) as unknown as typeof fetch;
        const worker = new VerificationWorker(
            store,
            { cache: new AttestationCache(), fetchImpl: capturingFetch },
            { deadlineMs: 5_000 },
        );
        const job = input({ sessionId: "s2", apiKey: "active-secret" });
        worker.enqueue(job);
        // Let the job start and reach the (hanging) signature fetch.
        await new Promise((r) => setTimeout(r, 10));

        worker.shutdown();
        expect(capturedSignal?.aborted).toBe(true);

        // Let the aborted job settle; its credential is cleared and it must not
        // write a record into the store that shutdown already cleared.
        await new Promise((r) => setTimeout(r, 10));
        expect(job.apiKey).toBe("");
        expect(store.query({ sessionId: "s2", isOwner: true, selector: "latest" })).toHaveLength(0);
    });
});
