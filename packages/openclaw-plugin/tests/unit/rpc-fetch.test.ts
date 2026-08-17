import { describe, expect, test } from "bun:test";
import { createGuardedRpcFetch } from "../../src/rpc-fetch.ts";

describe("guarded RPC fetch", () => {
    test("rejects a public-looking hostname that resolves to loopback", async () => {
        const fetchRpc = createGuardedRpcFetch(false, (async () => ({
            address: "127.0.0.1",
            family: 4,
        })) as never);
        await expect(
            fetchRpc("https://rpc.example.com", {
                method: "POST",
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId" }),
            }),
        ).rejects.toThrow();
    });
});
