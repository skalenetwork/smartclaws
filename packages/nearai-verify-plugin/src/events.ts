// OpenAI Chat Completions -> OpenClaw event adapter.
//
// This is an intentionally small, version-pinned compatibility seam (see
// package `openclaw.build`). It maps the mainstream completions delta shapes
// (visible text, reasoning, tool calls, usage, finish reasons) onto the exact
// OpenClaw transport event contract. Adapter fixtures cover individual event
// shapes, and the transport integration test covers the complete public stream.
//
// It imports only documented package helpers; the built-in bundle is never
// imported at runtime.
import { calculateCost, type Model, type Usage } from "openclaw/plugin-sdk/llm";
import {
  coerceTransportToolCallArguments,
  createEmptyTransportUsage,
  type WritableTransportStream,
} from "openclaw/plugin-sdk/provider-transport-runtime";
import { isRecord } from "./util.js";

export const MAX_TOOL_CALL_ARGUMENT_BYTES = 256_000;

type TextBlock = { type: "text"; text: string };
type ThinkingBlock = { type: "thinking"; thinking: string };
type ToolCallBlock = {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  partialArgs: string;
};
type Block = TextBlock | ThinkingBlock | ToolCallBlock;

/** The accumulator passed as `partial`/`message` on every emitted event. */
export interface TransportOutput {
  role?: "assistant";
  content: Block[];
  api?: Model["api"];
  provider?: string;
  model?: string;
  stopReason: string;
  usage?: Usage & { reasoningTokens?: number };
  responseId?: string;
  timestamp?: number;
}

/** A minimal view of an OpenAI completions streaming chunk. */
export interface CompletionChunk {
  id?: string;
  usage?: unknown;
  choices?: Array<{
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}

/** Validate and retain only completion fields consumed by the adapter. */
export function parseCompletionChunk(value: unknown): CompletionChunk | null {
  if (!isRecord(value)) return null;
  const chunk: CompletionChunk = {};
  if (typeof value.id === "string") chunk.id = value.id;
  if (value.usage !== undefined) chunk.usage = value.usage;
  if (!Array.isArray(value.choices)) return chunk;

  chunk.choices = value.choices.flatMap((choiceValue) => {
    if (!isRecord(choiceValue)) return [];
    const choice: NonNullable<CompletionChunk["choices"]>[number] = {};
    if (typeof choiceValue.finish_reason === "string" || choiceValue.finish_reason === null) {
      choice.finish_reason = choiceValue.finish_reason;
    }
    if (!isRecord(choiceValue.delta)) return [choice];

    const rawDelta = choiceValue.delta;
    const delta: NonNullable<typeof choice.delta> = {};
    if (typeof rawDelta.content === "string" || rawDelta.content === null) {
      delta.content = rawDelta.content;
    }
    if (typeof rawDelta.reasoning_content === "string" || rawDelta.reasoning_content === null) {
      delta.reasoning_content = rawDelta.reasoning_content;
    }
    if (typeof rawDelta.reasoning === "string" || rawDelta.reasoning === null) {
      delta.reasoning = rawDelta.reasoning;
    }
    if (Array.isArray(rawDelta.tool_calls)) {
      delta.tool_calls = rawDelta.tool_calls.flatMap((toolCallValue) => {
        if (!isRecord(toolCallValue)) return [];
        const toolCall: NonNullable<typeof delta.tool_calls>[number] = {};
        if (typeof toolCallValue.index === "number") {
          toolCall.index = toolCallValue.index;
        }
        if (typeof toolCallValue.id === "string") toolCall.id = toolCallValue.id;
        if (isRecord(toolCallValue.function)) {
          const fn: NonNullable<typeof toolCall.function> = {};
          if (typeof toolCallValue.function.name === "string") {
            fn.name = toolCallValue.function.name;
          }
          if (typeof toolCallValue.function.arguments === "string") {
            fn.arguments = toolCallValue.function.arguments;
          }
          toolCall.function = fn;
        }
        return [toolCall];
      });
    }
    choice.delta = delta;
    return [choice];
  });
  return chunk;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Normalize OpenAI token fields to OpenClaw's transport usage contract. */
export function normalizeCompletionUsage(
  rawUsage: unknown,
  model?: Model,
): Usage & { reasoningTokens?: number } {
  const raw = isRecord(rawUsage) ? rawUsage : {};
  const promptDetails = isRecord(raw.prompt_tokens_details) ? raw.prompt_tokens_details : {};
  const completionDetails = isRecord(raw.completion_tokens_details)
    ? raw.completion_tokens_details
    : {};
  const promptTokens = nonNegativeNumber(raw.prompt_tokens);
  const cacheRead = nonNegativeNumber(promptDetails.cached_tokens);
  const input = Math.max(0, promptTokens - cacheRead);
  const output = nonNegativeNumber(raw.completion_tokens);
  const reasoningTokens =
    typeof completionDetails.reasoning_tokens === "number" &&
    Number.isFinite(completionDetails.reasoning_tokens)
      ? Math.max(0, completionDetails.reasoning_tokens)
      : undefined;
  const usage: Usage & { reasoningTokens?: number } = {
    ...createEmptyTransportUsage(),
    input,
    output,
    cacheRead,
    totalTokens: input + output + cacheRead,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
  if (model) calculateCost(model, usage);
  return usage;
}

function mapStopReason(finish: string): string {
  if (finish === "tool_calls") return "toolUse";
  if (finish === "length") return "length";
  if (finish === "content_filter") return "stop";
  return "stop";
}

/**
 * Stateful adapter: feed parsed completion chunks in order, then `finish()`.
 * Emits OpenClaw transport events onto the provided writable stream.
 */
export class CompletionEventAdapter {
  readonly output: TransportOutput;
  private current: TextBlock | ThinkingBlock | null = null;
  private readonly toolCallsByIndex = new Map<number, ToolCallBlock>();
  private readonly toolCallArgumentBytes = new WeakMap<ToolCallBlock, number>();
  private sawStop = false;

  /**
   * `output` may be supplied so the transport shares a single accumulator: the
   * same object it seeds with role/model/usage/timestamp is the one carried on
   * every `partial` event and, ultimately, the persisted `done` message.
   */
  constructor(
    private readonly stream: WritableTransportStream,
    output?: TransportOutput,
    private readonly normalizeUsage: (
      usage: unknown,
    ) => Usage & { reasoningTokens?: number } = normalizeCompletionUsage,
  ) {
    this.output = output ?? { content: [], stopReason: "stop" };
  }

  private blockIndex(block: Block): number {
    return this.output.content.indexOf(block);
  }

  /** Close the open text or thinking block, if any. Tool calls close separately. */
  private closeCurrent(): void {
    const block = this.current;
    if (!block) return;
    const contentIndex = this.blockIndex(block);
    if (block.type === "text") {
      this.stream.push({
        type: "text_end",
        contentIndex,
        content: block.text,
        partial: this.output,
      });
    } else {
      this.stream.push({
        type: "thinking_end",
        contentIndex,
        content: block.thinking,
        partial: this.output,
      });
    }
    this.current = null;
  }

  /** Emit a terminal event for every open tool-call block, in the order it appeared. */
  private closeToolCalls(): void {
    for (const block of this.toolCallsByIndex.values()) {
      block.arguments = coerceTransportToolCallArguments(block.partialArgs);
      this.stream.push({
        type: "toolcall_end",
        contentIndex: this.blockIndex(block),
        toolCall: { type: "toolCall", id: block.id, name: block.name, arguments: block.arguments },
        partial: this.output,
      });
    }
    this.toolCallsByIndex.clear();
  }

  private openText(): TextBlock {
    if (this.current?.type === "text") return this.current;
    this.closeCurrent();
    const block: TextBlock = { type: "text", text: "" };
    this.output.content.push(block);
    this.current = block;
    this.stream.push({
      type: "text_start",
      contentIndex: this.blockIndex(block),
      partial: this.output,
    });
    return block;
  }

  private openThinking(): ThinkingBlock {
    if (this.current?.type === "thinking") return this.current;
    this.closeCurrent();
    const block: ThinkingBlock = { type: "thinking", thinking: "" };
    this.output.content.push(block);
    this.current = block;
    this.stream.push({
      type: "thinking_start",
      contentIndex: this.blockIndex(block),
      partial: this.output,
    });
    return block;
  }

  /** Process one parsed completion chunk. */
  push(chunk: CompletionChunk): void {
    if (typeof chunk.id === "string" && chunk.id.length > 0 && !this.output.responseId) {
      this.output.responseId = chunk.id;
    }
    if (chunk.usage) this.output.usage = this.normalizeUsage(chunk.usage);

    const choice = chunk.choices?.[0];
    if (!choice) return;

    if (choice.finish_reason) {
      this.output.stopReason = mapStopReason(choice.finish_reason);
      if (choice.finish_reason === "stop") this.sawStop = true;
    }

    const delta = choice.delta;
    if (!delta) return;

    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (reasoning) {
      const block = this.openThinking();
      block.thinking += reasoning;
      this.stream.push({
        type: "thinking_delta",
        contentIndex: this.blockIndex(block),
        delta: reasoning,
        partial: this.output,
      });
    }

    if (delta.content) {
      const block = this.openText();
      block.text += delta.content;
      this.stream.push({
        type: "text_delta",
        contentIndex: this.blockIndex(block),
        delta: delta.content,
      });
    }

    if (delta.tool_calls && delta.tool_calls.length > 0) {
      // Any visible text/thinking block ends once tool calls begin. Tool-call
      // blocks then stay open until finish(): providers stream them in parallel
      // (one chunk can announce several indices), so they must never close one
      // another.
      this.closeCurrent();
      for (const toolCall of delta.tool_calls) {
        const index = typeof toolCall.index === "number" ? toolCall.index : 0;
        let block = this.toolCallsByIndex.get(index);
        if (!block) {
          block = {
            type: "toolCall",
            id: toolCall.id ?? "",
            name: toolCall.function?.name ?? "",
            arguments: {},
            partialArgs: "",
          };
          this.output.content.push(block);
          this.toolCallsByIndex.set(index, block);
          this.stream.push({
            type: "toolcall_start",
            contentIndex: this.blockIndex(block),
            partial: this.output,
          });
        }
        if (toolCall.id) block.id = toolCall.id;
        if (toolCall.function?.name) block.name = toolCall.function.name;
        const argsDelta = toolCall.function?.arguments;
        if (argsDelta) {
          const argumentBytes =
            (this.toolCallArgumentBytes.get(block) ?? 0) + Buffer.byteLength(argsDelta, "utf8");
          if (argumentBytes > MAX_TOOL_CALL_ARGUMENT_BYTES) {
            throw new Error(`tool-call arguments exceed ${MAX_TOOL_CALL_ARGUMENT_BYTES} bytes`);
          }
          this.toolCallArgumentBytes.set(block, argumentBytes);
          block.partialArgs += argsDelta;
          block.arguments = coerceTransportToolCallArguments(block.partialArgs);
          this.stream.push({
            type: "toolcall_delta",
            contentIndex: this.blockIndex(block),
            delta: argsDelta,
            partial: this.output,
          });
        }
      }
    }
  }

  /** Close any open block and reconcile the final stop reason. */
  finish(): TransportOutput {
    this.closeCurrent();
    this.closeToolCalls();
    const hasToolCalls = this.output.content.some((b) => b.type === "toolCall");
    if (this.output.stopReason === "toolUse" && !hasToolCalls) this.output.stopReason = "stop";
    if (this.sawStop && this.output.stopReason === "stop" && hasToolCalls)
      this.output.stopReason = "toolUse";
    return this.output;
  }
}
