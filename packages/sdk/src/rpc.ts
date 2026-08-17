import type { Config } from "@smartclaws/core/types";
import { getAddress, isAddress } from "viem";
import { SmartClawsError } from "./errors.js";

const SENSITIVE_QUERY_KEYS = [
    "apikey",
    "api_key",
    "api-key",
    "token",
    "auth",
    "password",
    "secret",
    "access_token",
    "key",
];

export type RpcFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const RPC_FETCH = Symbol.for("@smartclaws/sdk/rpc-fetch");
type ConfigWithRpcFetch = Config & { [RPC_FETCH]?: RpcFetch };

/** Attach a runtime-only fetch implementation without persisting it in config JSON. */
export function withRpcFetch(config: Config, fetchFn: RpcFetch): Config {
    const decorated = { ...config } as ConfigWithRpcFetch;
    Object.defineProperty(decorated, RPC_FETCH, { value: fetchFn, enumerable: false });
    return decorated;
}

export function getRpcFetch(config: Config): RpcFetch | undefined {
    return (config as ConfigWithRpcFetch)[RPC_FETCH];
}

function ipv4Octets(host: string): number[] | null {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!match) return null;
    const octets = match.slice(1).map(Number);
    if (octets.some((value) => value > 255)) return null;
    return octets;
}

export function isPrivateOrUnsafeHostname(host: string): boolean {
    const hostname = host.toLowerCase().replace(/^\[|]$/g, "");
    if (
        hostname === "localhost" ||
        hostname === "localhost.localdomain" ||
        hostname === "metadata.google.internal" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".internal") ||
        hostname.endsWith(".local")
    ) {
        return true;
    }

    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(hostname);
    if (mapped) return isPrivateOrUnsafeHostname(mapped[1]);

    const octets = ipv4Octets(hostname);
    if (octets) {
        const [a, b] = octets;
        if (a === 0 || a === 10 || a === 127) return true;
        if (a === 169 && b === 254) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 100 && b >= 64 && b <= 127) return true;
        return false;
    }

    if (hostname === "::1" || hostname === "0:0:0:0:0:0:0:1") return true;
    if (hostname.startsWith("fe80:") || hostname.startsWith("fc") || hostname.startsWith("fd")) {
        return true;
    }
    return false;
}

/** Strip credentials and sensitive query values so RPC URLs are safe to return. */
export function redactRpcUrl(url: string): string {
    try {
        const parsed = new URL(url);
        if (parsed.username || parsed.password) {
            parsed.username = "REDACTED";
            parsed.password = "REDACTED";
        }
        for (const key of [...parsed.searchParams.keys()]) {
            if (SENSITIVE_QUERY_KEYS.some((item) => key.toLowerCase().includes(item))) {
                parsed.searchParams.set(key, "REDACTED");
            }
        }
        return parsed.toString();
    } catch {
        return "[unparseable-url]";
    }
}

/** Replace credential-bearing URLs inside error text copied from RPC clients. */
export function redactErrorMessage(message: string): string {
    return message.replace(/https?:\/\/[^\s)'"]+/gi, (url) => redactRpcUrl(url));
}

export interface RpcValidationOptions {
    allowPrivateRpc?: boolean;
}

/**
 * Accept only HTTP(S) RPC URLs. Embedded credentials are always rejected.
 * Loopback, link-local, metadata, and private destinations require `allowPrivateRpc`.
 */
export function validateRpcUrl(url: string, options: RpcValidationOptions = {}): string {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new SmartClawsError("CUSTOM_RPC_FORBIDDEN", "RPC URL is not a valid absolute URL.", {
            url: redactRpcUrl(url),
        });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new SmartClawsError("CUSTOM_RPC_FORBIDDEN", "RPC URL must use http or https.", {
            protocol: parsed.protocol,
        });
    }
    if (parsed.username || parsed.password) {
        throw new SmartClawsError("CUSTOM_RPC_FORBIDDEN", "RPC URL must not embed credentials.");
    }
    if (!options.allowPrivateRpc && isPrivateOrUnsafeHostname(parsed.hostname)) {
        throw new SmartClawsError(
            "CUSTOM_RPC_FORBIDDEN",
            "RPC URL points at a loopback, private, link-local, or metadata destination.",
            { host: parsed.hostname },
        );
    }
    return parsed.toString();
}

export function validateChainId(chainId: number): number {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
        throw new SmartClawsError("INVALID_RANGE", "Chain ID must be a positive safe integer.", {
            chainId,
        });
    }
    return chainId;
}

export function validateRegistryAddress(address: string): string {
    if (!isAddress(address)) {
        throw new SmartClawsError(
            "INVALID_TARGET",
            "Registry address is not a valid Ethereum address.",
            { address },
        );
    }
    return getAddress(address);
}
