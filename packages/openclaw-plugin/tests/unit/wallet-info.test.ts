import { beforeEach, describe, expect, test } from "bun:test";
import {
    CONFIG,
    getAgentReaderStatus,
    getDeviceReaderStatus,
    getWalletInfo,
    hasPublicKeyWithConfig,
    listAgents,
    listDevices,
    loadWallet,
    type ToolSpec,
    toolFactory,
    WALLET,
} from "./sdk-mock.ts";

async function loadWalletInfoSpec() {
    const { walletInfoTool } = await import("../../src/tools/wallet-info.ts");
    return walletInfoTool(toolFactory as never) as ToolSpec;
}

describe("smartclaws_wallet_info", () => {
    beforeEach(() => {
        getWalletInfo.mockClear();
        hasPublicKeyWithConfig.mockClear();
        getDeviceReaderStatus.mockClear();
        getAgentReaderStatus.mockClear();
        listDevices.mockClear();
        listAgents.mockClear();
        loadWallet.mockClear();
        listDevices.mockReturnValue([]);
        listAgents.mockReturnValue([]);
        hasPublicKeyWithConfig.mockImplementation(async () => false);
        getDeviceReaderStatus.mockImplementation(async () => ({
            isIncomingReader: false,
            isOutgoingReader: false,
        }));
        getAgentReaderStatus.mockImplementation(async () => ({
            isIncomingReader: false,
            isOutgoingReader: false,
        }));
    });

    test("returns public-key readiness and skips plain local channels", async () => {
        listDevices.mockReturnValue([
            {
                name: "plain-1",
                deviceContract: "0x00000000000000000000000000000000000000d0",
                incomingChannel: "0x00000000000000000000000000000000000000c0",
                outgoingChannel: "0x00000000000000000000000000000000000000c1",
                encrypted: false,
            },
            {
                name: "sensor-1",
                deviceContract: "0x00000000000000000000000000000000000000d1",
                incomingChannel: "0x00000000000000000000000000000000000000c2",
                outgoingChannel: "0x00000000000000000000000000000000000000c3",
                encrypted: true,
            },
        ]);
        listAgents.mockReturnValue([
            {
                name: "controller-1",
                agentContract: "0x00000000000000000000000000000000000000a1",
                incomingChannel: "0x00000000000000000000000000000000000000c4",
                outgoingChannel: "0x00000000000000000000000000000000000000c5",
                encrypted: true,
            },
        ]);
        hasPublicKeyWithConfig.mockImplementation(async () => true);
        getDeviceReaderStatus.mockImplementation(async () => ({
            isIncomingReader: false,
            isOutgoingReader: true,
        }));
        getAgentReaderStatus.mockImplementation(async () => ({
            isIncomingReader: true,
            isOutgoingReader: true,
        }));
        const spec = await loadWalletInfoSpec();

        const result = (await spec.execute(
            {},
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        )) as Record<string, unknown>;

        expect(getWalletInfo).toHaveBeenCalledWith(CONFIG, WALLET);
        expect(hasPublicKeyWithConfig).toHaveBeenCalledWith(CONFIG, WALLET.address);
        expect(getDeviceReaderStatus).toHaveBeenCalledTimes(1);
        expect(getDeviceReaderStatus).toHaveBeenCalledWith(
            CONFIG,
            "0x00000000000000000000000000000000000000d1",
            WALLET.address,
            "/tmp/smartclaws-test",
        );
        expect(getAgentReaderStatus).toHaveBeenCalledWith(
            CONFIG,
            "0x00000000000000000000000000000000000000a1",
            WALLET.address,
            "/tmp/smartclaws-test",
        );
        expect(result.publicKeyRegistered).toBe(true);
        expect(result.readers).toEqual([
            {
                kind: "device",
                name: "sensor-1",
                incomingChannel: "0x00000000000000000000000000000000000000c2",
                outgoingChannel: "0x00000000000000000000000000000000000000c3",
                isIncomingReader: false,
                isOutgoingReader: true,
            },
            {
                kind: "agent",
                name: "controller-1",
                incomingChannel: "0x00000000000000000000000000000000000000c4",
                outgoingChannel: "0x00000000000000000000000000000000000000c5",
                isIncomingReader: true,
                isOutgoingReader: true,
            },
        ]);
        expect(result).not.toHaveProperty("privateKey");
    });
});
