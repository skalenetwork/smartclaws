// Provider-owned streaming transport for NEAR AI direct completions.
//
// It serializes and sends the request itself so it can hash the exact request
// bytes, streams the response while hashing the exact decoded response bytes,
// emits the normal OpenClaw assistant events, and — only after the visible
// stream has finished — queues asynchronous TEE verification. Verification never
// blocks the turn.
import type { Context, Model, SimpleStreamOptions } from "openclaw/plugin-sdk/llm";
import {
  buildGuardedModelFetch,
  buildOpenAICompletionsParams,
  createEmptyTransportUsage,
  createWritableTransportEventStream,
  failTransportStream,
  finalizeTransportStream,
} from "openclaw/plugin-sdk/provider-transport-runtime";
import {
  CompletionEventAdapter,
  normalizeCompletionUsage,
  parseCompletionChunk,
  type TransportOutput,
} from "./events.js";
import { SSE_DONE, SseByteHasher, StableChatIdTracker } from "./sse.js";
import type { VerificationJobInput } from "./types.js";
import {
  isRecord,
  mergeRequestHeaders,
  NEAR_DIRECT_HOST_SUFFIX,
  sha256Hex,
  validateDirectOrigin,
} from "./util.js";

/** Minimal shape of the runtime model this transport understands. */
export interface RuntimeModelLike {
  id: string;
  provider: string;
  api?: string;
  baseUrl?: string;
}

/** Callback that receives a fully captured message for verification. */
export type CaptureSink = (input: VerificationJobInput) => void;

/** A terminal outcome for a stream that cannot be queued for verification. */
export interface UnprovableCapture {
  sessionId?: string;
  endpoint: string;
  model: string;
  chatId?: string;
  requestHash: string;
  responseHash: string;
  status: "SKIP" | "FAIL";
  detail: string;
}

/** Callback that records a terminal, non-verifiable outcome. */
export type UnprovableSink = (info: UnprovableCapture) => void;

type OpenAICompletionsOptions = NonNullable<Parameters<typeof buildOpenAICompletionsParams>[2]>;

function toOpenAIReasoning(reasoning: unknown): OpenAICompletionsOptions["reasoning"] {
  switch (reasoning) {
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return reasoning;
    case "max":
      return "xhigh";
    default:
      return undefined;
  }
}

/**
 * The generic stream API includes `off` and calls its top reasoning level
 * `max`. The OpenAI completions builder represents `off` by omitting the field
 * and calls the top level `xhigh`.
 */
function toOpenAICompletionsOptions(
  options: SimpleStreamOptions | undefined,
): OpenAICompletionsOptions | undefined {
  if (!options) return undefined;
  const { reasoning, ...rest } = options;
  const openAIReasoning = toOpenAIReasoning(reasoning);
  return openAIReasoning === undefined ? rest : { ...rest, reasoning: openAIReasoning };
}

/**
 * True when a model resolves to a supported NEAR direct completions route:
 * OpenAI completions API, HTTPS, host under `.completions.near.ai`.
 */
export function isSupportedDirectModel(model: RuntimeModelLike | undefined): boolean {
  if (!model) return false;
  if (model.api !== "openai-completions") return false;
  if (!model.baseUrl) return false;
  const origin = validateDirectOrigin(model.baseUrl);
  return origin?.host.endsWith(NEAR_DIRECT_HOST_SUFFIX) ?? false;
}

/**
 * Build the StreamFn that owns the transport for supported direct models.
 * `capture` is invoked once per completed stream with the captured hashes.
 */
export function createNearAiVerifiedStreamFn(
  capture: CaptureSink,
  options?: { fetchImpl?: typeof fetch; onUnprovable?: UnprovableSink },
) {
  const fetchOverride = options?.fetchImpl;
  const onUnprovable = options?.onUnprovable;
  return function nearAiVerifiedStreamFn(
    model: Model,
    context: Context,
    options?: SimpleStreamOptions,
  ) {
    const { eventStream, stream } = createWritableTransportEventStream();
    // Seed the assistant message the way the built-in transport does, so the
    // persisted `done` message carries role, model, usage, and content — not
    // just a stop reason. The adapter mutates this same object in place.
    const output: TransportOutput = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: createEmptyTransportUsage(),
      stopReason: "stop",
      timestamp: Date.now(),
    };

    void (async () => {
      try {
        // Resolve the credential up front. A direct completion cannot proceed
        // without one, and sending "Bearer " only guarantees a 401.
        const apiKey = options?.apiKey || process.env.NEAR_AI_API_KEY || "";
        if (!apiKey) throw new Error("no NEAR AI API key available for direct completions");

        // Build and serialize the request exactly once. onPayload may be async,
        // so it must be awaited before the result is spread into the body —
        // otherwise the body (and its hash) degrade to `{"stream":true}`.
        const built = buildOpenAICompletionsParams(
          model,
          context,
          toOpenAICompletionsOptions(options),
        );
        const callbackResult = options?.onPayload
          ? await options.onPayload(built, model)
          : undefined;
        if (callbackResult !== undefined && !isRecord(callbackResult)) {
          throw new TypeError("onPayload must return an object or undefined");
        }
        const requestParams = {
          ...(callbackResult ?? built),
          stream: true,
        };
        const requestJson = JSON.stringify(requestParams);
        const requestBytes = new TextEncoder().encode(requestJson);
        const requestHash = sha256Hex(requestBytes);

        const origin = validateDirectOrigin(model.baseUrl ?? "");
        if (!origin) throw new Error("model baseUrl is not a NEAR direct completions origin");
        const completionsUrl = new URL(
          "chat/completions",
          `${model.baseUrl.replace(/\/?$/, "/")}`,
        ).toString();
        if (new URL(completionsUrl).origin !== origin.origin) {
          throw new Error("completions URL escaped the validated origin");
        }

        const guardedFetch = fetchOverride ?? buildGuardedModelFetch(model, options?.timeoutMs);
        const response = await guardedFetch(completionsUrl, {
          method: "POST",
          headers: mergeRequestHeaders(options?.headers, {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            accept: "text/event-stream",
          }),
          body: requestBytes,
          signal: options?.signal,
          redirect: "error",
        });

        if (!response.ok || !response.body) {
          throw new Error(`completions request failed: HTTP ${response.status}`);
        }

        const hasher = new SseByteHasher();
        const adapter = new CompletionEventAdapter(stream, output, (usage) =>
          normalizeCompletionUsage(usage, model),
        );
        const chatIdTracker = new StableChatIdTracker();

        const consume = (dataEvents: { data: string }[]) => {
          for (const event of dataEvents) {
            if (event.data === SSE_DONE) continue;
            let decoded: unknown;
            try {
              decoded = JSON.parse(event.data);
            } catch {
              continue; // ignore malformed frames; hash already covers the bytes
            }
            const parsed = parseCompletionChunk(decoded);
            if (!parsed) continue;
            chatIdTracker.push(parsed);
            adapter.push(parsed);
          }
        };

        const reader = response.body.getReader();
        // Emit the initial start event, mirroring the built-in transport.
        stream.push({ type: "start", partial: output });
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (options?.signal?.aborted) throw new Error("request aborted");
          consume(hasher.push(value));
        }
        const { responseHash, trailing } = hasher.finish();
        consume(trailing);

        adapter.finish();

        // Finish the user-visible stream immediately, carrying the full message.
        finalizeTransportStream({ stream, output, signal: options?.signal });

        // Then queue verification. A missing/conflicting chat id is not provable,
        // but still recorded so `/nearai-verify latest` reflects the outcome.
        const { chatId, conflict } = chatIdTracker.result();
        const terminal = {
          sessionId: options?.sessionId,
          endpoint: origin.origin,
          model: model.id,
          requestHash,
          responseHash,
        };
        if (conflict) {
          onUnprovable?.({
            ...terminal,
            chatId,
            status: "FAIL",
            detail: "completion stream reported conflicting chat ids",
          });
        } else if (!chatId) {
          onUnprovable?.({
            ...terminal,
            status: "SKIP",
            detail: "no stable chat id in completion stream; cannot locate signature",
          });
        } else {
          capture({
            sessionId: options?.sessionId,
            endpoint: origin.origin,
            model: model.id,
            chatId,
            requestHash,
            responseHash,
            apiKey,
            headers: options?.headers,
          });
        }
      } catch (error) {
        failTransportStream({ stream, output, error, signal: options?.signal });
      }
    })();

    return eventStream;
  };
}
