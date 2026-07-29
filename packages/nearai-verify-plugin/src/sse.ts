// Byte-exact response hashing and OpenAI SSE parsing.
//
// The response hash must cover the exact decoded entity-body bytes exposed by
// `fetch`, including the trailing `data: [DONE]\n\n` and its two newlines.
// Hashing happens on the raw bytes before any text decoding, so re-encoding can
// never perturb the digest. The SSE parser runs on a separate decoded view and
// never feeds back into the hash.
import { createHash, type Hash } from "node:crypto";
import { SHA_256_ALGORITHM } from "./util.js";

export const MAX_SSE_EVENT_CHARS = 1_000_000;

/** A single parsed SSE event: its `data:` payload lines joined by `\n`. */
export interface SseEvent {
  data: string;
}

/**
 * Incrementally hashes raw response bytes while decoding and framing SSE
 * events. Call `push` for every chunk in arrival order, then `finish`.
 */
export class SseByteHasher {
  private readonly hash: Hash = createHash(SHA_256_ALGORITHM);
  private readonly decoder = new TextDecoder("utf-8");
  private textBuffer = "";
  private finished = false;

  /**
   * Feed one raw chunk. Hashes the exact bytes first, then decodes and yields
   * any complete SSE events contained so far.
   */
  push(chunk: Uint8Array): SseEvent[] {
    if (this.finished) throw new Error("SseByteHasher already finished");
    this.hash.update(chunk);
    this.textBuffer += this.decoder.decode(chunk, { stream: true });
    return this.drainEvents();
  }

  /** Flush the streaming decoder and return the final hex digest. */
  finish(): { responseHash: string; trailing: SseEvent[] } {
    if (this.finished) throw new Error("SseByteHasher already finished");
    this.finished = true;
    this.textBuffer += this.decoder.decode();
    const trailing = this.drainEvents(true);
    return { responseHash: this.hash.digest("hex"), trailing };
  }

  private drainEvents(final = false): SseEvent[] {
    const events: SseEvent[] = [];
    // Events are separated by a blank line. Normalize CRLF to LF for framing.
    let normalized = this.textBuffer.replace(/\r\n/g, "\n");
    let idx = normalized.indexOf("\n\n");
    while (idx !== -1) {
      const block = normalized.slice(0, idx);
      if (block.length > MAX_SSE_EVENT_CHARS) {
        throw new Error(`SSE event exceeds ${MAX_SSE_EVENT_CHARS} characters`);
      }
      normalized = normalized.slice(idx + 2);
      const event = parseSseBlock(block);
      if (event) events.push(event);
      idx = normalized.indexOf("\n\n");
    }
    if (final && normalized.length > 0) {
      if (normalized.length > MAX_SSE_EVENT_CHARS) {
        throw new Error(`SSE event exceeds ${MAX_SSE_EVENT_CHARS} characters`);
      }
      const event = parseSseBlock(normalized);
      if (event) events.push(event);
      normalized = "";
    }
    if (normalized.length > MAX_SSE_EVENT_CHARS) {
      throw new Error(`SSE event exceeds ${MAX_SSE_EVENT_CHARS} characters`);
    }
    this.textBuffer = normalized;
    return events;
  }
}

/** Parse a single SSE event block into its concatenated data payload. */
function parseSseBlock(block: string): SseEvent | null {
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue; // comment
    if (line.startsWith("data:")) {
      // A single leading space after the colon is stripped, per the SSE spec.
      const value = line.slice(5);
      dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    }
  }
  if (dataLines.length === 0) return null;
  return { data: dataLines.join("\n") };
}

/** The `[DONE]` sentinel that terminates an OpenAI completions stream. */
export const SSE_DONE = "[DONE]";

/**
 * Incrementally retain only the correlation state needed from completion
 * chunks. Differing ids are a hard failure (the stream was not coherent).
 */
export class StableChatIdTracker {
  private chatId: string | undefined;
  private conflict = false;

  push(chunk: { id?: unknown }): void {
    if (typeof chunk.id !== "string" || chunk.id.length === 0) return;
    if (this.chatId === undefined) this.chatId = chunk.id;
    else if (this.chatId !== chunk.id) this.conflict = true;
  }

  result(): { chatId?: string; conflict: boolean } {
    return { chatId: this.chatId, conflict: this.conflict };
  }
}
