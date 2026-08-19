import type { DiscloseResult, PublishResult } from "@smartclaws/sdk";

/**
 * JSON-compatible tool results. OpenClaw serializes execute() returns; bigint
 * (callback deposits) is not JSON-safe, and undefined fields would only add noise.
 *
 * Publication outcome is `status` alone. This helper never adds `success` and
 * never rewrites `scheduled` into `published`.
 */
export function jsonCompatible(value: unknown): unknown {
    if (typeof value === "bigint") return value.toString();
    if (Array.isArray(value)) return value.map(jsonCompatible);
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value)) {
            if (entry !== undefined) out[key] = jsonCompatible(entry);
        }
        return out;
    }
    return value;
}

export function presentPublishResult(result: PublishResult): Record<string, unknown> {
    return jsonCompatible(result) as Record<string, unknown>;
}

export function presentDiscloseResult(result: DiscloseResult): Record<string, unknown> {
    return jsonCompatible(result) as Record<string, unknown>;
}
