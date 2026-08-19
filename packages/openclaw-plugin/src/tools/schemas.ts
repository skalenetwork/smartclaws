import { SmartClawsError } from "@smartclaws/sdk";
import { Type } from "typebox";

export const ModeSchema = Type.Union(
    [Type.Literal("controller"), Type.Literal("bridge-agent"), Type.Literal("master-agent")],
    { description: "SmartClaws operating mode." },
);

export const ChannelSideSchema = Type.Union([Type.Literal("incoming"), Type.Literal("outgoing")], {
    description: "Which half of a device or agent channel pair.",
});

export const AddressSchema = Type.String({
    description: "0x-prefixed Ethereum address.",
    pattern: "^0x[0-9a-fA-F]{40}$",
});

export function requireSafeInteger(
    value: number | undefined,
    label: string,
    opts: { min?: number; max?: number } = {},
): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isSafeInteger(value)) {
        throw new SmartClawsError("INVALID_RANGE", `${label} must be a safe integer.`, { value });
    }
    if (opts.min !== undefined && value < opts.min) {
        throw new SmartClawsError("INVALID_RANGE", `${label} must be >= ${opts.min}.`, { value });
    }
    if (opts.max !== undefined && value > opts.max) {
        throw new SmartClawsError("INVALID_RANGE", `${label} must be <= ${opts.max}.`, { value });
    }
    return value;
}

export function parseDecimalBigint(value: string, label: string): bigint {
    if (!/^[0-9]+$/.test(value)) {
        throw new SmartClawsError("INVALID_RANGE", `${label} must be a decimal integer string.`, {
            value,
        });
    }
    return BigInt(value);
}

export const DEFAULT_CHANNEL_CAPACITY = 1_048_576n;

export function parseChannelCapacity(
    value: string | undefined,
    max: bigint,
    label = "capacityBytes",
): bigint {
    const parsed = parseDecimalBigint(value ?? DEFAULT_CHANNEL_CAPACITY.toString(), label);
    if (parsed < 1n) {
        throw new SmartClawsError("INVALID_RANGE", `${label} must be at least 1.`, {
            value: parsed.toString(),
        });
    }
    if (parsed > max) {
        throw new SmartClawsError("INVALID_RANGE", `${label} cannot exceed ${max.toString()}.`, {
            value: parsed.toString(),
            max: max.toString(),
        });
    }
    return parsed;
}

export function requireNonEmptyName(name: string, label = "name"): string {
    const trimmed = name.trim();
    if (!trimmed) {
        throw new SmartClawsError("INVALID_TARGET", `${label} is required and must be stable.`, {
            name,
        });
    }
    return trimmed;
}
