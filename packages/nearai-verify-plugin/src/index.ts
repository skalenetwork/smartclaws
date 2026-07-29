// Plugin entry: the NEAR AI direct-completions verification transport.
//
// It registers the `nearai` provider with a custom transport that captures the
// exact request/response bytes of direct completions, queues asynchronous TEE
// verification (observation only — never blocks a turn), and exposes the
// `/nearai-verify` command for reading per-session results.
import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";
import { AttestationCache } from "./cache.js";
import { formatRecords, parseCommandSelector, RecordStore } from "./status.js";
import { createVerificationTools } from "./tools.js";
import {
    createNearAiVerifiedStreamFn,
    isSupportedDirectModel,
    type RuntimeModelLike,
    type UnprovableCapture,
} from "./transport.js";
import { deriveEvidence, type VerificationRecord } from "./types.js";
import { VerificationWorker } from "./worker.js";

const PLUGIN_ID = "nearai-verify";
const PROVIDER_ID = "nearai";
const COMMAND_NAME = "nearai-verify";

// Long-lived, process-scoped verification state. Bounded internally so memory
// stays flat; cleared on plugin disable/reload.
const cache = new AttestationCache();
const store = new RecordStore();
const worker = new VerificationWorker(store, { cache });

/** Record a terminal outcome for a stream that cannot be queued for verification. */
function recordUnprovable(info: UnprovableCapture): void {
    store.add({
        startedAt: Date.now(),
        durationMs: 0,
        sessionId: info.sessionId,
        endpoint: info.endpoint,
        model: info.model,
        chatId: info.chatId,
        requestHash: info.requestHash,
        responseHash: info.responseHash,
        checks: [
            {
                name: info.status === "FAIL" ? "chat id" : "provability",
                result: info.status,
                detail: info.detail,
            },
        ],
        status: info.status,
        evidence: deriveEvidence(info.status, false),
    });
}

const verifiedStreamFn = createNearAiVerifiedStreamFn(
    (input) => {
        worker.enqueue(input);
    },
    { onUnprovable: recordUnprovable },
);

/** Record a SKIP for a nearai turn the plugin cannot prove (non-direct route). */
function recordUnsupported(model: RuntimeModelLike): void {
    const record: VerificationRecord = {
        startedAt: Date.now(),
        durationMs: 0,
        endpoint: model.baseUrl ?? "",
        model: model.id,
        checks: [{ name: "route", result: "SKIP", detail: "not a NEAR direct completions route" }],
        status: "SKIP",
        evidence: "CLAIMED",
    };
    store.add(record);
}

export default defineSingleProviderPluginEntry({
    id: PLUGIN_ID,
    name: "NEAR AI Verify",
    description:
        "Proves NEAR AI direct completions were signed inside an attested TEE by hashing exact request/response bytes and verifying the signature chain asynchronously.",
    provider: {
        id: PROVIDER_ID,
        label: "NEAR AI",
        docsPath: "/providers/nearai",
        envVars: ["NEAR_AI_API_KEY"],
        auth: [
            {
                methodId: "api-key",
                label: "NEAR AI API key",
                optionKey: "nearAiApiKey",
                flagName: "--near-ai-api-key",
                envVar: "NEAR_AI_API_KEY",
                promptMessage: "Enter your NEAR AI API key",
            },
        ],
        catalog: {
            // Preserve the operator's configured provider verbatim: its credential
            // reference and per-model direct baseUrls are authoritative. Never fall
            // back to a gateway definition.
            run: async (ctx) => {
                const configured = ctx.config?.models?.providers?.[PROVIDER_ID];
                if (!configured) {
                    throw new Error(
                        `nearai-verify requires a configured "${PROVIDER_ID}" provider under models.providers with direct .completions.near.ai base URLs.`,
                    );
                }
                return { provider: configured };
            },
        },
        // Own the transport for supported direct routes so request/response bytes
        // can be captured exactly.
        createStreamFn: (ctx) => (isSupportedDirectModel(ctx.model) ? verifiedStreamFn : undefined),
        // For nearai routes we cannot prove (e.g. gateway or non-completions),
        // record a SKIP and leave the generic transport untouched.
        wrapStreamFn: (ctx) => {
            const model = ctx.model;
            if (model && !isSupportedDirectModel(model)) recordUnsupported(model);
            return ctx.streamFn;
        },
    },
    register: (api) => {
        api.registerTool((ctx) => createVerificationTools(ctx, store));

        api.registerCommand({
            name: COMMAND_NAME,
            description:
                "Show NEAR AI TEE verification results for this session (usage: /nearai-verify [latest|<chat_id>]).",
            acceptsArgs: true,
            requireAuth: true,
            exposeSenderIsOwner: true,
            handler: (ctx) => {
                const selector = parseCommandSelector(ctx.args);
                const records = store.query({
                    sessionId: ctx.sessionId,
                    isOwner: Boolean(ctx.senderIsOwner),
                    selector,
                });
                return { text: formatRecords(records) };
            },
        });

        api.lifecycle.registerRuntimeLifecycle({
            id: "nearai-verify-runtime",
            description:
                "Stop the verification worker and clear cached attestations on disable/reload.",
            cleanup: () => {
                worker.shutdown();
                cache.clear();
                store.clear();
            },
        });
    },
});
