import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  MAX_SSE_EVENT_CHARS,
  SseByteHasher,
  StableChatIdTracker,
} from "../src/sse.js";

const encoder = new TextEncoder();

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Feed a byte array through the hasher in fixed-size chunks. */
function run(bytes: Uint8Array, chunkSize: number): { hash: string; data: string[] } {
  const hasher = new SseByteHasher();
  const data: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    for (const ev of hasher.push(bytes.subarray(i, i + chunkSize))) data.push(ev.data);
  }
  const { responseHash, trailing } = hasher.finish();
  for (const ev of trailing) data.push(ev.data);
  return { hash: responseHash, data };
}

const body = ['data: {"id":"chat-1","choices":[{"delta":{"content":"Hi"}}]}', "", 'data: [DONE]', "", ""].join("\n");

describe("SseByteHasher hash exactness", () => {
  test("hash covers the exact bytes including the trailing [DONE] newlines", () => {
    const bytes = encoder.encode(body);
    const expected = sha256Hex(bytes);
    const { hash, data } = run(bytes, bytes.length);
    expect(hash).toBe(expected);
    expect(data).toEqual(['{"id":"chat-1","choices":[{"delta":{"content":"Hi"}}]}', "[DONE]"]);
  });

  test("hash is identical for every chunk boundary (byte-by-byte)", () => {
    const bytes = encoder.encode(body);
    const expected = sha256Hex(bytes);
    for (let size = 1; size <= bytes.length; size++) {
      expect(run(bytes, size).hash).toBe(expected);
    }
  });

  test("splitting inside a multi-byte UTF-8 sequence is safe", () => {
    const withEmoji = 'data: {"id":"c","choices":[{"delta":{"content":"party 🎉 time"}}]}\n\ndata: [DONE]\n\n';
    const bytes = encoder.encode(withEmoji);
    const expected = sha256Hex(bytes);
    // The emoji occupies 4 bytes; assert every split reproduces both the hash
    // and a correctly reassembled first event payload.
    for (let size = 1; size <= bytes.length; size++) {
      const { hash, data } = run(bytes, size);
      expect(hash).toBe(expected);
      expect(data[0]).toContain("party 🎉 time");
    }
  });

  test("handles CRLF framing and comment lines", () => {
    const crlf = ": keep-alive\r\ndata: {\"id\":\"c\"}\r\n\r\ndata: [DONE]\r\n\r\n";
    const bytes = encoder.encode(crlf);
    const { data } = run(bytes, 3);
    expect(data).toEqual(['{"id":"c"}', "[DONE]"]);
  });

  test("finish flushes a final event with no trailing blank line", () => {
    const noTrailer = 'data: {"id":"c"}';
    const { data } = run(encoder.encode(noTrailer), 5);
    expect(data).toEqual(['{"id":"c"}']);
  });

  test("rejects an unterminated event that exceeds the buffer limit", () => {
    const hasher = new SseByteHasher();
    expect(() =>
      hasher.push(
        encoder.encode(`data: ${"x".repeat(MAX_SSE_EVENT_CHARS + 1)}`),
      ),
    ).toThrow(/SSE event exceeds/);
  });
});

describe("StableChatIdTracker", () => {
  test("incremental tracking preserves the first id and conflict state", () => {
    const tracker = new StableChatIdTracker();
    tracker.push({});
    tracker.push({ id: "a" });
    tracker.push({ id: "a" });
    tracker.push({ id: "b" });
    tracker.push({ id: "a" });
    expect(tracker.result()).toEqual({ chatId: "a", conflict: true });
  });

  test("ignores chunks without an id", () => {
    const tracker = new StableChatIdTracker();
    tracker.push({});
    tracker.push({ id: "" });
    expect(tracker.result()).toEqual({
      chatId: undefined,
      conflict: false,
    });
  });
});
