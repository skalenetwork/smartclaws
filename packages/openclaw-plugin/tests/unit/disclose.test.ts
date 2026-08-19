import { beforeEach, describe, expect, test } from "bun:test";
import {
    CALLBACK_DEPOSIT,
    CHANNEL,
    CONFIG,
    CTX_HASH,
    discloseMessages,
    loadWallet,
    ORIGIN,
    readMessages,
    resolveChannel,
    type ToolSpec,
    toolFactory,
    WALLET,
} from "./sdk-mock.ts";

async function loadDiscloseSpec() {
    const { discloseTool } = await import("../../src/tools/disclose.ts");
    return discloseTool(toolFactory as never) as ToolSpec & { optional?: boolean };
}

describe("smartclaws_disclose", () => {
    beforeEach(() => {
        discloseMessages.mockClear();
        readMessages.mockClear();
        loadWallet.mockClear();
        resolveChannel.mockClear();
        resolveChannel.mockReturnValue({
            channelAddress: CHANNEL,
            device: "sensor-1",
            side: "outgoing",
        });
        discloseMessages.mockImplementation(async () => ({
            channel: CHANNEL,
            from: 0,
            to: 0,
            messages: [
                { offset: 0, rawHex: "0xaa", encrypted: true, topic: "telemetry.pm", p: { n: 1 } },
            ],
            txHash: ORIGIN,
            ctxHashes: [CTX_HASH],
            callbackDeposit: CALLBACK_DEPOSIT,
        }));
    });

    test("is marked optional so it is not allowlisted with free reads", async () => {
        const spec = await loadDiscloseSpec();
        expect(spec.optional).toBe(true);
    });

    test("can disclose an entity's incoming channel, not just its outgoing one", async () => {
        resolveChannel.mockReturnValue({
            channelAddress: CHANNEL,
            device: "sensor-1",
            side: "incoming",
        });
        const spec = await loadDiscloseSpec();

        // Encrypted commands sent to a device are only auditable through disclosure, so
        // the incoming side has to be addressable by name.
        const result = (await spec.execute(
            { device: "sensor-1", side: "incoming", fromOffset: 0, count: 1 },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        )) as Record<string, unknown>;

        expect(resolveChannel).toHaveBeenCalledWith(
            { device: "sensor-1", agent: undefined, channel: undefined, side: "incoming" },
            CONFIG,
            WALLET,
            "/tmp/smartclaws-test",
        );
        expect(result.side).toBe("incoming");
    });

    test("signs a paid disclosure after resolving the channel", async () => {
        const spec = await loadDiscloseSpec();
        const result = (await spec.execute(
            { device: "sensor-1", fromOffset: 0, count: 1 },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        )) as Record<string, unknown>;

        expect(loadWallet).toHaveBeenCalled();
        expect(readMessages).not.toHaveBeenCalled();
        expect(discloseMessages).toHaveBeenCalledWith(
            { channelAddress: CHANNEL, fromOffset: 0, count: 1 },
            CONFIG,
            WALLET,
        );
        expect(result).toMatchObject({
            channel: CHANNEL,
            from: 0,
            to: 0,
            device: "sensor-1",
            txHash: ORIGIN,
            ctxHashes: [CTX_HASH],
            callbackDeposit: CALLBACK_DEPOSIT.toString(),
        });
        expect(typeof result.callbackDeposit).toBe("string");
    });

    test("defaults count to 1", async () => {
        const spec = await loadDiscloseSpec();
        await spec.execute(
            { channel: CHANNEL, fromOffset: 4 },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        );
        expect(discloseMessages).toHaveBeenCalledWith(
            { channelAddress: CHANNEL, fromOffset: 4, count: 1 },
            CONFIG,
            WALLET,
        );
    });

    test("rejects a batch above 10 before spending", async () => {
        const spec = await loadDiscloseSpec();
        try {
            await spec.execute(
                { channel: CHANNEL, fromOffset: 0, count: 11 },
                { smartclawsHome: "/tmp/smartclaws-test" },
                {},
            );
            throw new Error("expected throw");
        } catch (error) {
            expect((error as { code?: string }).code).toBe("READ_BATCH_LIMIT");
        }
        expect(discloseMessages).not.toHaveBeenCalled();
    });

    test("rejects a zero count before spending", async () => {
        const spec = await loadDiscloseSpec();
        try {
            await spec.execute(
                { channel: CHANNEL, fromOffset: 0, count: 0 },
                { smartclawsHome: "/tmp/smartclaws-test" },
                {},
            );
            throw new Error("expected throw");
        } catch (error) {
            expect((error as { code?: string }).code).toBe("READ_BATCH_LIMIT");
        }
        expect(discloseMessages).not.toHaveBeenCalled();
    });
});
