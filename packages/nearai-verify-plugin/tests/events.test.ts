import { describe, expect, test } from "bun:test";
import {
  type CompletionChunk,
  CompletionEventAdapter,
  MAX_TOOL_CALL_ARGUMENT_BYTES,
  normalizeCompletionUsage,
} from "../src/events.js";

type Event = { type: string; delta?: string; contentIndex?: number; toolCall?: { arguments: unknown } };

function drive(chunks: CompletionChunk[]) {
  const events: Event[] = [];
  const stream = { push: (e: unknown) => events.push(e as Event), end: () => {} };
  const adapter = new CompletionEventAdapter(stream);
  for (const c of chunks) adapter.push(c);
  const output = adapter.finish();
  return { events, output, types: events.map((e) => e.type) };
}

describe("CompletionEventAdapter text", () => {
  test("emits start/delta*/end and accumulates content", () => {
    const { types, output } = drive([
      { id: "chat-1", choices: [{ delta: { content: "Hi" } }] },
      { choices: [{ delta: { content: " there" } }] },
      { choices: [{ finish_reason: "stop", delta: {} }] },
    ]);
    expect(types).toEqual(["text_start", "text_delta", "text_delta", "text_end"]);
    expect(output.stopReason).toBe("stop");
    expect(output.responseId).toBe("chat-1");
    expect(output.content).toEqual([{ type: "text", text: "Hi there" }]);
  });
});

describe("CompletionEventAdapter reasoning", () => {
  test("maps reasoning_content to thinking events", () => {
    const { types, output } = drive([
      { choices: [{ delta: { reasoning_content: "let me think" } }] },
      { choices: [{ delta: { content: "answer" } }] },
      { choices: [{ finish_reason: "stop", delta: {} }] },
    ]);
    expect(types).toEqual(["thinking_start", "thinking_delta", "thinking_end", "text_start", "text_delta", "text_end"]);
    expect(output.content[0]).toEqual({ type: "thinking", thinking: "let me think" });
  });
});

describe("CompletionEventAdapter usage", () => {
  test("normalizes OpenAI usage fields to the OpenClaw contract", () => {
    const { output } = drive([
      {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          prompt_tokens_details: { cached_tokens: 40 },
          completion_tokens_details: { reasoning_tokens: 5 },
        },
      },
    ]);

    expect(output.usage).toEqual({
      input: 60,
      output: 20,
      cacheRead: 40,
      cacheWrite: 0,
      reasoningTokens: 5,
      totalTokens: 120,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    });
  });

  test("handles malformed usage without producing NaN", () => {
    expect(normalizeCompletionUsage({ prompt_tokens: "bad" })).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    });
  });
});

describe("CompletionEventAdapter tool calls", () => {
  test("assembles streamed tool-call arguments and maps stop reason", () => {
    const { types, events, output } = drive([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "foo", arguments: '{"a":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] } }] },
      { choices: [{ finish_reason: "tool_calls", delta: {} }] },
    ]);
    expect(types).toEqual(["toolcall_start", "toolcall_delta", "toolcall_delta", "toolcall_end"]);
    expect(output.stopReason).toBe("toolUse");
    const end = events.find((e) => e.type === "toolcall_end");
    expect(end?.toolCall?.arguments).toEqual({ a: 1 });
  });

  test("downgrades a toolUse stop reason when no tool call was produced", () => {
    const { output } = drive([
      { choices: [{ delta: { content: "hi" } }] },
      { choices: [{ finish_reason: "tool_calls", delta: {} }] },
    ]);
    expect(output.stopReason).toBe("stop");
  });

  test("keeps parallel tool calls open and closes each once, in order", () => {
    const { types, events, output } = drive([
      // One chunk announces two parallel tool calls.
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "t0", function: { name: "alpha", arguments: "" } },
                { index: 1, id: "t1", function: { name: "beta", arguments: "" } },
              ],
            },
          },
        ],
      },
      // Arguments then stream interleaved across both indices.
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"x":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{"y":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: "2}" } }] } }] },
      { choices: [{ finish_reason: "tool_calls", delta: {} }] },
    ]);
    // Two starts up front, both ends deferred to finish() in index order.
    expect(types).toEqual([
      "toolcall_start",
      "toolcall_start",
      "toolcall_delta",
      "toolcall_delta",
      "toolcall_delta",
      "toolcall_delta",
      "toolcall_end",
      "toolcall_end",
    ]);
    const ends = events.filter((e) => e.type === "toolcall_end");
    expect(ends).toHaveLength(2);
    expect(ends[0]?.toolCall?.arguments).toEqual({ x: 1 });
    expect(ends[1]?.toolCall?.arguments).toEqual({ y: 2 });
    expect(output.stopReason).toBe("toolUse");
    expect(output.content).toEqual([
      { type: "toolCall", id: "t0", name: "alpha", arguments: { x: 1 }, partialArgs: '{"x":1}' },
      { type: "toolCall", id: "t1", name: "beta", arguments: { y: 2 }, partialArgs: '{"y":2}' },
    ]);
  });

  test("rejects an oversized streamed tool-call argument", () => {
    const stream = { push: () => {}, end: () => {} };
    const adapter = new CompletionEventAdapter(stream);
    expect(() =>
      adapter.push({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "large",
                  function: {
                    name: "large",
                    arguments: "x".repeat(MAX_TOOL_CALL_ARGUMENT_BYTES + 1),
                  },
                },
              ],
            },
          },
        ],
      }),
    ).toThrow(/arguments exceed/);
  });
});
