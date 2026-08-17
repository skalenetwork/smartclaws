import type { Config, WalletFile } from "@smartclaws/core/types";
import { type Address, getAddress } from "viem";
import * as contracts from "../contracts.js";
import { SmartClawsError } from "../errors.js";
import type { ChannelSide } from "./channels.js";
import * as discovery from "./discovery.js";

/**
 * Alias of {@link ChannelSide}. Reader ACLs and channel resolution talk about the same
 * axis, so they must not drift into two vocabularies for one concept.
 */
export type ReaderChannelSide = ChannelSide;

function normalizeAddress(address: string): Address {
    return getAddress(address) as Address;
}

function requireSuccessfulReceipt(
    receipt: { status: "success" | "reverted" },
    txHash: `0x${string}`,
    action: string,
): void {
    if (receipt.status === "success") return;
    throw new SmartClawsError("TRANSACTION_REVERTED", `${action} transaction reverted`, { txHash });
}

async function requireEncryptedChannel(channelAddress: Address, config: Config): Promise<Address> {
    const address = normalizeAddress(channelAddress);
    if (!(await contracts.resolveChannelEncrypted(address, config))) {
        throw new SmartClawsError(
            "ENCRYPTION_UNSUPPORTED",
            "Reader ACLs exist only on encrypted channels.",
            { channel: address },
        );
    }
    return address;
}

async function listChannelReaderAddresses(
    channelAddress: Address,
    config: Config,
): Promise<Address[]> {
    const channel = contracts.getEncryptedChannelReadContract(channelAddress, config);
    const readers = (await channel.read.getReaders()) as readonly Address[];
    return readers.map(normalizeAddress);
}

export async function isAuthorizedReader(
    channelAddress: string,
    account: string,
    config: Config,
): Promise<boolean> {
    const channel = await requireEncryptedChannel(normalizeAddress(channelAddress), config);
    const reader = contracts.getEncryptedChannelReadContract(channel, config);
    return reader.read.isAuthorizedReader([normalizeAddress(account)]) as Promise<boolean>;
}

export async function listChannelReaders(
    channelAddress: string,
    config: Config,
): Promise<Address[]> {
    const channel = await requireEncryptedChannel(normalizeAddress(channelAddress), config);
    return listChannelReaderAddresses(channel, config);
}

export async function grantChannelReader(
    config: Config,
    wallet: WalletFile,
    channelAddress: string,
    readerAddress: string,
): Promise<{
    channel: Address;
    reader: Address;
    txHash: `0x${string}`;
    status: "success";
}> {
    const channel = await requireEncryptedChannel(normalizeAddress(channelAddress), config);
    const reader = normalizeAddress(readerAddress);
    const contract = contracts.getEncryptedChannelContract(channel, config, wallet);
    const { publicClient } = contracts.getClients(config, wallet);
    const hash = await contract.write.addReader([reader]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    requireSuccessfulReceipt(receipt, hash, "addReader");
    return { channel, reader, txHash: hash, status: "success" };
}

export async function revokeChannelReader(
    config: Config,
    wallet: WalletFile,
    channelAddress: string,
    readerAddress: string,
): Promise<{
    channel: Address;
    reader: Address;
    txHash: `0x${string}`;
    status: "success";
}> {
    const channel = await requireEncryptedChannel(normalizeAddress(channelAddress), config);
    const reader = normalizeAddress(readerAddress);
    const contract = contracts.getEncryptedChannelContract(channel, config, wallet);
    const { publicClient } = contracts.getClients(config, wallet);
    const hash = await contract.write.removeReader([reader]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    requireSuccessfulReceipt(receipt, hash, "removeReader");
    return { channel, reader, txHash: hash, status: "success" };
}

async function groupAdministersDevice(
    deviceAddress: Address,
    groupAddress: string | undefined,
    config: Config,
): Promise<boolean> {
    if (!groupAddress) return false;
    const device = contracts.getDeviceContract(deviceAddress, config);
    return device.read.hasRole([
        discovery.deviceRoleIds.deviceAdmin,
        normalizeAddress(groupAddress),
    ]) as Promise<boolean>;
}

function deviceChannel(
    device: { incomingChannel: string; outgoingChannel: string },
    side: ReaderChannelSide,
): Address {
    return normalizeAddress(side === "incoming" ? device.incomingChannel : device.outgoingChannel);
}

export async function grantDeviceReader(
    config: Config,
    wallet: WalletFile,
    deviceQuery: string,
    side: ReaderChannelSide,
    readerAddress: string,
    homeDir?: string,
): Promise<{
    device: Address;
    side: ReaderChannelSide;
    reader: Address;
    txHash: `0x${string}`;
    status: "success";
}> {
    const device = await discovery.resolveDevice(deviceQuery, config, wallet, homeDir);
    const deviceAddress = normalizeAddress(device.deviceContract);
    await requireEncryptedChannel(deviceChannel(device, side), config);
    const reader = normalizeAddress(readerAddress);
    const { publicClient } = contracts.getClients(config, wallet);
    const useGroup = await groupAdministersDevice(deviceAddress, device.groupAddress, config);
    const hash = useGroup
        ? await contracts
              .getDeviceGroupContract(
                  normalizeAddress(device.groupAddress as string),
                  config,
                  wallet,
              )
              .write[side === "incoming" ? "addIncomingReader" : "addOutgoingReader"]([
                  deviceAddress,
                  reader,
              ])
        : await contracts
              .getDeviceWriteContract(deviceAddress, config, wallet)
              .write[side === "incoming" ? "addIncomingReader" : "addOutgoingReader"]([reader]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    requireSuccessfulReceipt(receipt, hash, "grantDeviceReader");
    return { device: deviceAddress, side, reader, txHash: hash, status: "success" };
}

export async function revokeDeviceReader(
    config: Config,
    wallet: WalletFile,
    deviceQuery: string,
    side: ReaderChannelSide,
    readerAddress: string,
    homeDir?: string,
): Promise<{
    device: Address;
    side: ReaderChannelSide;
    reader: Address;
    txHash: `0x${string}`;
    status: "success";
}> {
    const device = await discovery.resolveDevice(deviceQuery, config, wallet, homeDir);
    const deviceAddress = normalizeAddress(device.deviceContract);
    await requireEncryptedChannel(deviceChannel(device, side), config);
    const reader = normalizeAddress(readerAddress);
    const { publicClient } = contracts.getClients(config, wallet);
    const useGroup = await groupAdministersDevice(deviceAddress, device.groupAddress, config);
    const hash = useGroup
        ? await contracts
              .getDeviceGroupContract(
                  normalizeAddress(device.groupAddress as string),
                  config,
                  wallet,
              )
              .write[side === "incoming" ? "removeIncomingReader" : "removeOutgoingReader"]([
                  deviceAddress,
                  reader,
              ])
        : await contracts
              .getDeviceWriteContract(deviceAddress, config, wallet)
              .write[side === "incoming" ? "removeIncomingReader" : "removeOutgoingReader"]([
                  reader,
              ]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    requireSuccessfulReceipt(receipt, hash, "revokeDeviceReader");
    return { device: deviceAddress, side, reader, txHash: hash, status: "success" };
}

export async function listDeviceReaders(
    config: Config,
    deviceQuery: string,
    side: ReaderChannelSide,
    homeDir?: string,
): Promise<Address[]> {
    const device = await discovery.resolveDevice(deviceQuery, config, undefined, homeDir);
    return listChannelReaders(deviceChannel(device, side), config);
}

export async function getDeviceReaderStatus(
    config: Config,
    deviceQuery: string,
    account: string,
    homeDir?: string,
): Promise<{ isIncomingReader: boolean; isOutgoingReader: boolean }> {
    const device = await discovery.resolveDevice(deviceQuery, config, undefined, homeDir);
    const incoming = normalizeAddress(device.incomingChannel);
    const outgoing = normalizeAddress(device.outgoingChannel);
    if (!(await contracts.resolveChannelEncrypted(incoming, config))) {
        return { isIncomingReader: false, isOutgoingReader: false };
    }
    const [isIncomingReader, isOutgoingReader] = await Promise.all([
        isAuthorizedReader(incoming, account, config),
        isAuthorizedReader(outgoing, account, config),
    ]);
    return { isIncomingReader, isOutgoingReader };
}

export async function grantAgentReader(
    config: Config,
    wallet: WalletFile,
    agentQuery: string,
    side: ReaderChannelSide,
    readerAddress: string,
    homeDir?: string,
): Promise<{
    agent: Address;
    side: ReaderChannelSide;
    reader: Address;
    txHash: `0x${string}`;
    status: "success";
}> {
    const agent = await discovery.resolveAgent(agentQuery, config, wallet, homeDir);
    const agentAddress = normalizeAddress(agent.agentContract);
    await requireEncryptedChannel(
        normalizeAddress(side === "incoming" ? agent.incomingChannel : agent.outgoingChannel),
        config,
    );
    const reader = normalizeAddress(readerAddress);
    const contract = contracts.getAgentWriteContract(agentAddress, config, wallet);
    const { publicClient } = contracts.getClients(config, wallet);
    const hash = await contract.write[
        side === "incoming" ? "addIncomingReader" : "addOutgoingReader"
    ]([reader]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    requireSuccessfulReceipt(receipt, hash, "grantAgentReader");
    return { agent: agentAddress, side, reader, txHash: hash, status: "success" };
}

export async function revokeAgentReader(
    config: Config,
    wallet: WalletFile,
    agentQuery: string,
    side: ReaderChannelSide,
    readerAddress: string,
    homeDir?: string,
): Promise<{
    agent: Address;
    side: ReaderChannelSide;
    reader: Address;
    txHash: `0x${string}`;
    status: "success";
}> {
    const agent = await discovery.resolveAgent(agentQuery, config, wallet, homeDir);
    const agentAddress = normalizeAddress(agent.agentContract);
    await requireEncryptedChannel(
        normalizeAddress(side === "incoming" ? agent.incomingChannel : agent.outgoingChannel),
        config,
    );
    const reader = normalizeAddress(readerAddress);
    const contract = contracts.getAgentWriteContract(agentAddress, config, wallet);
    const { publicClient } = contracts.getClients(config, wallet);
    const hash = await contract.write[
        side === "incoming" ? "removeIncomingReader" : "removeOutgoingReader"
    ]([reader]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    requireSuccessfulReceipt(receipt, hash, "revokeAgentReader");
    return { agent: agentAddress, side, reader, txHash: hash, status: "success" };
}

export async function listAgentReaders(
    config: Config,
    agentQuery: string,
    side: ReaderChannelSide,
    homeDir?: string,
): Promise<Address[]> {
    const agent = await discovery.resolveAgent(agentQuery, config, undefined, homeDir);
    return listChannelReaders(
        side === "incoming" ? agent.incomingChannel : agent.outgoingChannel,
        config,
    );
}

export async function getAgentReaderStatus(
    config: Config,
    agentQuery: string,
    account: string,
    homeDir?: string,
): Promise<{ isIncomingReader: boolean; isOutgoingReader: boolean }> {
    const agent = await discovery.resolveAgent(agentQuery, config, undefined, homeDir);
    const incoming = normalizeAddress(agent.incomingChannel);
    const outgoing = normalizeAddress(agent.outgoingChannel);
    if (!(await contracts.resolveChannelEncrypted(incoming, config))) {
        return { isIncomingReader: false, isOutgoingReader: false };
    }
    const [isIncomingReader, isOutgoingReader] = await Promise.all([
        isAuthorizedReader(incoming, account, config),
        isAuthorizedReader(outgoing, account, config),
    ]);
    return { isIncomingReader, isOutgoingReader };
}
