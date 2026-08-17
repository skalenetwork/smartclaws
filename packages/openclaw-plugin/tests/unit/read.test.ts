import { beforeEach, describe, expect, test } from "bun:test";
import {
    CHANNEL,
    CONFIG,
    discloseMessages,
    loadWallet,
    readMessages,
    resolveChannel,
    type ToolSpec,
    toolFactory,
} from "./sdk-mock.ts";

async function loadReadSpec() {
    const { readTool } = await import("../../src/tools/read.ts");
    return readTool(toolFactory as never) as ToolSpec;
}

describe("smartclaws_read", () => {
    beforeEach(() => {
        readMessages.mockClear();
        discloseMessages.mockClear();
        loadWallet.mockClear();
        resolveChannel.mockClear();
        resolveChannel.mockReturnValue({
            channelAddress: CHANNEL,
            device: "sensor-1",
            side: "outgoing",
        });
    });

    test("passes the entity target and side straight through to the resolver", async () => {
        const spec = await loadReadSpec();

        // An agent's inbox is where notify() delivers, so it must be addressable by name
        // rather than only by raw channel address.
        await spec.execute(
            { agent: "controller-1", side: "incoming" },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        );

        expect(resolveChannel).toHaveBeenCalledWith(
            {
                device: undefined,
                agent: "controller-1",
                channel: undefined,
                side: "incoming",
            },
            "/tmp/smartclaws-test",
        );
    });

    test("reports which side was read so the result is not ambiguous", async () => {
        resolveChannel.mockReturnValue({
            channelAddress: CHANNEL,
            device: "sensor-1",
            side: "incoming",
        });
        const spec = await loadReadSpec();

        const result = (await spec.execute(
            { device: "sensor-1", side: "incoming" },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        )) as Record<string, unknown>;

        expect(result.side).toBe("incoming");
        expect(result.device).toBe("sensor-1");
        expect(result.agent).toBeNull();
    });

    test("is wallet-free and returns labelled ciphertext for encrypted channels", async () => {
        const spec = await loadReadSpec();
        const result = (await spec.execute(
            { device: "sensor-1", limit: 5 },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        )) as { messages: Array<Record<string, unknown>> };

        expect(loadWallet).not.toHaveBeenCalled();
        expect(discloseMessages).not.toHaveBeenCalled();
        expect(readMessages).toHaveBeenCalledWith(
            { channelAddress: CHANNEL, limit: 5, offset: undefined },
            CONFIG,
        );
        expect(result.messages[0]).toEqual({
            offset: 0,
            rawHex: "0xaabbcc",
            encrypted: true,
            ciphertextHex: "0xaabbcc",
            ciphertextBytes: 3,
        });
        expect(result.messages[0]).not.toHaveProperty("decodeError");
    });

    test("reading ciphertext is not a decode error", async () => {
        const spec = await loadReadSpec();
        const result = (await spec.execute(
            { channel: CHANNEL },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        )) as { messages: Array<Record<string, unknown>> };

        expect(result.messages[0]?.encrypted).toBe(true);
        expect(result.messages[0]?.decodeError).toBeUndefined();
        expect(typeof result.messages[0]?.ciphertextBytes).toBe("number");
    });
});
