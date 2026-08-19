import { beforeEach, describe, expect, test } from "bun:test";
import {
    CONFIG,
    getAgentReaderStatus,
    getDeviceReaderStatus,
    getViewKeyStatus,
    getWalletInfo,
    listAgents,
    listDevices,
    loadWallet,
    type ToolSpec,
    toolFactory,
    WALLET,
} from "./sdk-mock.ts";

const KEY_STATUS = {
    account: WALLET.address,
    registry: "0x00000000000000000000000000000000000000e0",
    registered: true,
    matchesViewKey: true,
    viewKeyMissing: false,
    localPublicKey: { x: `0x${"11".repeat(32)}`, y: `0x${"22".repeat(32)}` },
};

const WALLET_WITH_VIEW_KEY = {
    ...WALLET,
    viewPrivateKey: "0x02",
};

async function loadWalletInfoSpec() {
    const { walletInfoTool } = await import("../../src/tools/wallet-info.ts");
    return walletInfoTool(toolFactory as never) as ToolSpec;
}

async function run(wallet = WALLET) {
    loadWallet.mockImplementationOnce(() => wallet);
    const spec = await loadWalletInfoSpec();
    return (await spec.execute({}, { smartclawsHome: "/tmp/smartclaws-test" }, {})) as Record<
        string,
        unknown
    >;
}

describe("smartclaws_wallet_info", () => {
    beforeEach(() => {
        getWalletInfo.mockClear();
        getViewKeyStatus.mockClear();
        getDeviceReaderStatus.mockClear();
        getAgentReaderStatus.mockClear();
        listDevices.mockClear();
        listAgents.mockClear();
        loadWallet.mockClear();
        listDevices.mockReturnValue([]);
        listAgents.mockReturnValue([]);
        getViewKeyStatus.mockImplementation(async () => KEY_STATUS);
    });

    test("reports wallet identity without requiring a viewing key", async () => {
        const result = await run();

        expect(getWalletInfo).toHaveBeenCalled();
        expect(getViewKeyStatus).not.toHaveBeenCalled();
        expect(result.publicKeyRegistered).toBeNull();
        expect(result.registeredKeyOpensDisclosures).toBeNull();
        expect(result.usesSeparateViewKey).toBeNull();
    });

    test("reports key readiness without walking every known entity", async () => {
        listDevices.mockReturnValue([
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

        const result = await run(WALLET_WITH_VIEW_KEY);

        expect(getWalletInfo).toHaveBeenCalledWith(CONFIG, WALLET_WITH_VIEW_KEY);
        expect(result.publicKeyRegistered).toBe(true);
        // Identity and balance must not cost a round-trip per entity. Access moved to
        // smartclaws_access_check, which can also be asked about one entity.
        expect(getDeviceReaderStatus).not.toHaveBeenCalled();
        expect(getAgentReaderStatus).not.toHaveBeenCalled();
        expect(result).not.toHaveProperty("readers");
        expect(result).not.toHaveProperty("privateKey");
    });

    test("distinguishes a registered key that this wallet cannot actually open", async () => {
        getViewKeyStatus.mockImplementation(async () => ({
            ...KEY_STATUS,
            registered: true,
            matchesViewKey: false,
            viewKeyMissing: false,
        }));

        const result = await run(WALLET_WITH_VIEW_KEY);

        // The exact state behind a disclosure that succeeds, costs the fee, and returns
        // something unreadable. "Registered" alone cannot tell you that.
        expect(result.publicKeyRegistered).toBe(true);
        expect(result.registeredKeyOpensDisclosures).toBe(false);
        expect(result.usesSeparateViewKey).toBe(true);
    });

    test("an unregistered key cannot open disclosures", async () => {
        getViewKeyStatus.mockImplementation(async () => ({
            ...KEY_STATUS,
            registered: false,
            matchesViewKey: false,
        }));

        const result = await run(WALLET_WITH_VIEW_KEY);

        expect(result.publicKeyRegistered).toBe(false);
        expect(result.registeredKeyOpensDisclosures).toBe(false);
    });
});
