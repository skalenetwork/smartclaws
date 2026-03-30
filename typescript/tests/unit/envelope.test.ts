import { describe, expect, test } from "bun:test";
import { decode, encode } from "../../src/envelope.ts";

describe("envelope", () => {
  const topic = "temperature";
  const payload = { temperature: 24.5, humidity: 61.2 };
  const deviceId = "sc_dev_abc123";
  const ts = 1711324800;

  test("encode produces valid JSON bytes", () => {
    const bytes = encode(topic, payload, deviceId, ts);
    const json = JSON.parse(new TextDecoder().decode(bytes));
    expect(json.v).toBe(1);
    expect(json.ts).toBe(ts);
    expect(json.dev).toBe(deviceId);
    expect(json.topic).toBe(topic);
    expect(json.p).toEqual(payload);
  });

  test("encode/decode round-trip", () => {
    const bytes = encode(topic, payload, deviceId, ts);
    const envelope = decode(bytes);
    expect(envelope.v).toBe(1);
    expect(envelope.ts).toBe(ts);
    expect(envelope.dev).toBe(deviceId);
    expect(envelope.topic).toBe(topic);
    expect(envelope.p).toEqual(payload);
  });

  test("encode uses current time when ts omitted", () => {
    const before = Math.floor(Date.now() / 1000);
    const bytes = encode(topic, payload, deviceId);
    const envelope = decode(bytes);
    const after = Math.floor(Date.now() / 1000);
    expect(envelope.ts).toBeGreaterThanOrEqual(before);
    expect(envelope.ts).toBeLessThanOrEqual(after);
  });

  test("encode rejects empty topic", () => {
    expect(() => encode("", payload, deviceId)).toThrow("topic is required");
  });

  test("encode rejects empty deviceId", () => {
    expect(() => encode(topic, payload, "")).toThrow("deviceId is required");
  });

  test("decode rejects invalid version", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ v: 2, ts: 0, dev: "x", topic: "x", p: {} }));
    expect(() => decode(bytes)).toThrow("unsupported envelope version");
  });

  test("decode rejects missing fields", () => {
    const incomplete = new TextEncoder().encode(JSON.stringify({ v: 1 }));
    expect(() => decode(incomplete)).toThrow();
  });

  test("decode rejects non-object payload", () => {
    const bad = new TextEncoder().encode(JSON.stringify({ v: 1, ts: 0, dev: "x", topic: "x", p: "string" }));
    expect(() => decode(bad)).toThrow("missing or invalid payload");
  });
});
