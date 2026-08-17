import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Config, DeviceFile, WalletFile } from "@smartclaws/core/types";
import { getAddress } from "viem";
import * as contracts from "../../src/contracts.js";
import { SmartClawsError } from "../../src/errors.js";
import * as discovery from "../../src/services/discovery.js";
import {
    getDeviceReaderStatus,
    grantChannelReader,
    grantDeviceReader,
    listChannelReaders,
} from "../../src/services/readers.js";

const CONFIG: Config = {
    version: 3,
    network: "base-testnet",
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:0",
    contractAddress: "0x0000000000000000000000000000000000000001",
    walletAddress: "0x0000000000000000000000000000000000000002",
    mode: "controller",
    deviceGroupAddress: "",
    attachedGroupAddress: "",
    attachedAgentAddress: "",
    attachedDeviceAddresses: [],
};

const WALLET: WalletFile = {
    address: "0x0000000000000000000000000000000000000002",
    privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
};

const CHANNEL = "0x00000000000000000000000000000000000000c1";
const READER = "0x00000000000000000000000000000000000000aa";
const GROUP = "0x0000000000000000000000000000000000000011";
const DEVICE = "0x0000000000000000000000000000000000000032";

function encryptedDevice(): DeviceFile {
    return {
        name: "sensor",
        deviceContract: DEVICE,
        groupAddress: GROUP,
        createdAt: 1,
        incomingChannel: CHANNEL,
        outgoingChannel: "0x00000000000000000000000000000000000000c2",
        encrypted: true,
    };
}

afterEach(() => {
    mock.restore();
    contracts.clearContractCaches();
});

describe("channel readers", () => {
    test("lists readers on an encrypted channel", async () => {
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(contracts, "getEncryptedChannelReadContract").mockReturnValue({
            read: {
                getReaders: async () => [READER],
            },
        } as never);

        expect(await listChannelReaders(CHANNEL, CONFIG)).toEqual([getAddress(READER)]);
    });

    test("rejects reader operations on a plain channel", async () => {
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(false);
        try {
            await listChannelReaders(CHANNEL, CONFIG);
            throw new Error("expected throw");
        } catch (error) {
            expect(error).toBeInstanceOf(SmartClawsError);
            expect((error as SmartClawsError).code).toBe("ENCRYPTION_UNSUPPORTED");
        }
    });

    test("grants a reader directly on a channel", async () => {
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(contracts, "getEncryptedChannelContract").mockReturnValue({
            write: { addReader: async () => `0x${"11".repeat(32)}` },
        } as never);
        spyOn(contracts, "getClients").mockReturnValue({
            publicClient: {
                waitForTransactionReceipt: async () => ({ status: "success" }),
            },
        } as never);

        const result = await grantChannelReader(CONFIG, WALLET, CHANNEL, READER);
        expect(result.status).toBe("success");
        expect(result.reader).toBe(getAddress(READER));
    });

    test("throws when a grant transaction reverts", async () => {
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(contracts, "getEncryptedChannelContract").mockReturnValue({
            write: { addReader: async () => `0x${"11".repeat(32)}` },
        } as never);
        spyOn(contracts, "getClients").mockReturnValue({
            publicClient: {
                waitForTransactionReceipt: async () => ({ status: "reverted" }),
            },
        } as never);

        try {
            await grantChannelReader(CONFIG, WALLET, CHANNEL, READER);
            throw new Error("expected throw");
        } catch (error) {
            expect(error).toBeInstanceOf(SmartClawsError);
            expect((error as SmartClawsError).code).toBe("TRANSACTION_REVERTED");
        }
    });
});

describe("device readers", () => {
    test("uses group passthroughs when the group is the device admin", async () => {
        spyOn(discovery, "resolveDevice").mockResolvedValue(encryptedDevice());
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(contracts, "getDeviceContract").mockReturnValue({
            read: { hasRole: async () => true },
        } as never);
        const groupWrite = {
            addIncomingReader: async (args: unknown[]) => {
                expect(args).toEqual([getAddress(DEVICE), getAddress(READER)]);
                return `0x${"22".repeat(32)}`;
            },
        };
        const group = spyOn(contracts, "getDeviceGroupContract").mockReturnValue({
            write: groupWrite,
        } as never);
        const deviceWrite = spyOn(contracts, "getDeviceWriteContract");
        spyOn(contracts, "getClients").mockReturnValue({
            publicClient: {
                waitForTransactionReceipt: async () => ({ status: "success" }),
            },
        } as never);

        await grantDeviceReader(CONFIG, WALLET, DEVICE, "incoming", READER);
        expect(group).toHaveBeenCalled();
        expect(deviceWrite).not.toHaveBeenCalled();
    });

    test("uses the device contract when the group is not the device admin", async () => {
        spyOn(discovery, "resolveDevice").mockResolvedValue(encryptedDevice());
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(contracts, "getDeviceContract").mockReturnValue({
            read: { hasRole: async () => false },
        } as never);
        const group = spyOn(contracts, "getDeviceGroupContract");
        const addIncomingReader = async (args: unknown[]) => {
            expect(args).toEqual([getAddress(READER)]);
            return `0x${"33".repeat(32)}`;
        };
        spyOn(contracts, "getDeviceWriteContract").mockReturnValue({
            write: { addIncomingReader },
        } as never);
        spyOn(contracts, "getClients").mockReturnValue({
            publicClient: {
                waitForTransactionReceipt: async () => ({ status: "success" }),
            },
        } as never);

        await grantDeviceReader(CONFIG, WALLET, DEVICE, "incoming", READER);
        expect(group).not.toHaveBeenCalled();
    });

    test("reader status is a dedicated accessor, not a role id", async () => {
        spyOn(discovery, "resolveDevice").mockResolvedValue(encryptedDevice());
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(contracts, "getEncryptedChannelReadContract").mockReturnValue({
            read: {
                isAuthorizedReader: async ([account]: [string]) =>
                    account.toLowerCase() === READER.toLowerCase(),
            },
        } as never);

        const status = await getDeviceReaderStatus(CONFIG, DEVICE, READER);
        expect(status).toEqual({ isIncomingReader: true, isOutgoingReader: true });
        expect(discovery.deviceRoleIds.publisher).not.toBe(discovery.deviceRoleIds.deviceAdmin);
    });
});
