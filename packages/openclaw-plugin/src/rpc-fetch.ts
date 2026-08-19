import type { RpcFetch } from "@smartclaws/sdk";
import { fetchWithSsrFGuard, type LookupFn } from "openclaw/plugin-sdk/ssrf-runtime";

/**
 * Create a JSON-RPC fetcher that resolves and pins DNS through OpenClaw's SSRF
 * guard for every request. Buffering the small JSON-RPC response lets us close
 * the pinned dispatcher before returning control to viem.
 */
export function createGuardedRpcFetch(allowPrivateRpc: boolean, lookupFn?: LookupFn): RpcFetch {
    return async (input, init) => {
        const url = input instanceof Request ? input.url : input.toString();
        const guarded = await fetchWithSsrFGuard({
            url,
            init,
            lookupFn,
            maxRedirects: 0,
            policy: allowPrivateRpc ? { dangerouslyAllowPrivateNetwork: true } : undefined,
            auditContext: "smartclaws.rpc",
        });
        try {
            const body = await guarded.response.arrayBuffer();
            return new Response(body, {
                status: guarded.response.status,
                statusText: guarded.response.statusText,
                headers: guarded.response.headers,
            });
        } finally {
            await guarded.release();
        }
    };
}
