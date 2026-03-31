export interface Envelope {
  v: 1;
  ts: number;
  dev: string;
  topic: string;
  p: Record<string, unknown>;
}

export function encode(
  topic: string,
  payload: Record<string, unknown>,
  deviceId: string,
  timestamp?: number,
): Uint8Array {
  if (!topic) throw new Error("topic is required");
  if (!deviceId) throw new Error("deviceId is required");

  const envelope: Envelope = {
    v: 1,
    ts: timestamp ?? Math.floor(Date.now() / 1000),
    dev: deviceId,
    topic,
    p: payload,
  };
  return new TextEncoder().encode(JSON.stringify(envelope));
}

export function decode(data: Uint8Array): Envelope {
  const json = new TextDecoder().decode(data);
  const obj = JSON.parse(json);

  if (obj.v !== 1) throw new Error(`unsupported envelope version: ${obj.v}`);
  if (typeof obj.ts !== "number") throw new Error("missing or invalid ts");
  if (typeof obj.dev !== "string") throw new Error("missing or invalid dev");
  if (typeof obj.topic !== "string") throw new Error("missing or invalid topic");
  if (typeof obj.p !== "object" || obj.p === null) throw new Error("missing or invalid payload");

  return obj as Envelope;
}
