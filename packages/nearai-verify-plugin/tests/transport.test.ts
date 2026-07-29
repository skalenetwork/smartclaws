import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { AssistantMessageEvent, Context, Model } from "openclaw/plugin-sdk/llm";
import { createNearAiVerifiedStreamFn } from "../src/transport.js";
import type { VerificationJobInput } from "../src/types.js";
import { isRecord } from "../src/util.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const model: Model<"openai-completions"> = {
  id: "deepseek-ai/DeepSeek-V4-Flash",
  name: "DeepSeek V4 Flash",
  api: "openai-completions",
  provider: "nearai",
  baseUrl: "https://node1.completions.near.ai/v1",
  reasoning: true,
  input: ["text"],
  cost: {
    input: 1,
    output: 2,
    cacheRead: 0.5,
    cacheWrite: 0,
  },
  contextWindow: 128_000,
  maxTokens: 8_192,
};

const context: Context = {
  messages: [
    {
      role: "user",
      content: "hello",
      timestamp: 1,
    },
  ],
};

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("NEAR AI verified transport integration", () => {
  test("sends and hashes exact bytes, emits a complete message, and queues capture metadata", async () => {
    const responseText = [
      'data: {"id":"chat-1","choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"id":"chat-1","choices":[{"delta":{"content":" there"}}]}\n\n',
      'data: {"id":"chat-1","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3,"prompt_tokens_details":{"cached_tokens":4}}}\n\n',
      'data: {"id":"chat-1","choices":[{"finish_reason":"stop","delta":{}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const responseBytes = encoder.encode(responseText);
    const observed: {
      url?: string;
      headers?: Headers;
      requestBytes?: Uint8Array;
      capture?: VerificationJobInput;
    } = {};

    const fetchImpl: typeof fetch = async (input, init) => {
      observed.url = String(input);
      observed.headers = new Headers(init?.headers);
      if (!(init?.body instanceof Uint8Array)) {
        throw new TypeError("expected request body bytes");
      }
      observed.requestBytes = new Uint8Array(init.body);

      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const split = Math.floor(responseBytes.length / 2);
            controller.enqueue(responseBytes.subarray(0, split));
            controller.enqueue(responseBytes.subarray(split));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      );
    };

    const streamFn = createNearAiVerifiedStreamFn(
      (capture) => {
        observed.capture = capture;
      },
      { fetchImpl },
    );
    const stream = streamFn(model, context, {
      apiKey: "current-key",
      sessionId: "session-1",
      reasoning: "off",
      headers: {
        Authorization: "stale-key",
        "Content-Type": "text/plain",
        "x-request-id": "request-1",
      },
      onPayload: async (payload) => {
        if (!isRecord(payload)) throw new TypeError("expected object payload");
        return { ...payload, integration_marker: true };
      },
    });

    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();

    expect(observed.url).toBe("https://node1.completions.near.ai/v1/chat/completions");
    expect(observed.headers?.get("authorization")).toBe("Bearer current-key");
    expect(observed.headers?.get("content-type")).toBe("application/json");
    expect(observed.headers?.get("x-request-id")).toBe("request-1");

    const requestBytes = observed.requestBytes;
    if (!requestBytes) throw new Error("transport did not send request bytes");
    const requestPayload: unknown = JSON.parse(decoder.decode(requestBytes));
    expect(isRecord(requestPayload) && "reasoning_effort" in requestPayload).toBe(false);
    expect(requestPayload).toMatchObject({
      stream: true,
      integration_marker: true,
    });

    expect(events.map((event) => event.type)).toEqual([
      "start",
      "text_start",
      "text_delta",
      "text_delta",
      "text_end",
      "done",
    ]);
    expect(result).toMatchObject({
      role: "assistant",
      model: model.id,
      stopReason: "stop",
      responseId: "chat-1",
      content: [{ type: "text", text: "Hi there" }],
      usage: {
        input: 6,
        output: 3,
        cacheRead: 4,
        cacheWrite: 0,
        totalTokens: 13,
      },
    });

    expect(observed.capture).toEqual({
      sessionId: "session-1",
      endpoint: "https://node1.completions.near.ai",
      model: model.id,
      chatId: "chat-1",
      requestHash: sha256Hex(requestBytes),
      responseHash: sha256Hex(responseBytes),
      apiKey: "current-key",
      headers: {
        Authorization: "stale-key",
        "Content-Type": "text/plain",
        "x-request-id": "request-1",
      },
    });
  });
});
