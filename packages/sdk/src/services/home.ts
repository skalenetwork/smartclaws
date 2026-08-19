import { DEFAULT_NETWORK, getNetwork, NETWORKS } from "@smartclaws/core/networks";
import type { Config, SmartClawsMode } from "@smartclaws/core/types";
import { getAddress, isAddress } from "viem";
import { listAgents } from "../agent.js";
import { homeExists, resetHomePreservingWallet } from "../backup.js";
import {
    assertHomeWallet,
    createDefaultConfig,
    loadConfig,
    readStaleConfigHints,
    type StaleConfigHints,
    saveConfig,
    tryLoadConfig,
} from "../config.js";
import { listDevices } from "../device.js";
import { SmartClawsError } from "../errors.js";
import { homeFingerprint, requireHomeFingerprint } from "../fingerprint.js";
import { listGroups } from "../group.js";
import { redactRpcUrl, validateChainId, validateRegistryAddress, validateRpcUrl } from "../rpc.js";
import { generateWallet, loadWallet } from "../wallet.js";
import { enforceModeConstraints, resolveAgent, resolveDevice, resolveGroup } from "./discovery.js";

export const SMARTCLAWS_MODES: readonly SmartClawsMode[] = [
    "controller",
    "bridge-agent",
    "master-agent",
];

export function isSmartClawsMode(value: string): value is SmartClawsMode {
    return (SMARTCLAWS_MODES as readonly string[]).includes(value);
}

export function knownNetworkKey(name: string | undefined): string | undefined {
    if (!name) return undefined;
    if (name in NETWORKS) return name;
    const match = Object.entries(NETWORKS).find(([, network]) => network.name === name);
    return match?.[0];
}

export function requireNamedNetwork(name: string) {
    const key = knownNetworkKey(name);
    if (!key) {
        throw new SmartClawsError(
            "INVALID_TARGET",
            `Unknown network '${name}'. Available: ${Object.keys(NETWORKS).join(", ")}.`,
            { network: name, available: Object.keys(NETWORKS) },
        );
    }
    return { key, network: getNetwork(key) };
}

export interface PublicConfigView {
    network: string;
    chainId: number;
    rpcUrl: string;
    registryAddress: string;
    mode: SmartClawsMode;
    walletAddress: string;
}

export function presentConfig(config: Config): PublicConfigView {
    return {
        network: config.network,
        chainId: config.chainId,
        rpcUrl: redactRpcUrl(config.rpcUrl),
        registryAddress: config.contractAddress,
        mode: config.mode,
        walletAddress: config.walletAddress,
    };
}

export interface BuildHomeConfigInput {
    homeDir?: string;
    mode: SmartClawsMode;
    walletAddress: string;
    network?: string;
    rpcUrl?: string;
    chainId?: number;
    registryAddress?: string;
    hints?: StaleConfigHints;
}

/**
 * Construct a current-version HOME config. Matches CLI init field precedence:
 * explicit input, then existing current config, then salvaged hints, then the
 * named-network table. Registry hints are never reused.
 */
export function buildHomeConfig(input: BuildHomeConfigInput): Config {
    const existing = tryLoadConfig(input.homeDir);
    const networkKey =
        knownNetworkKey(input.network) ??
        knownNetworkKey(existing?.network) ??
        knownNetworkKey(input.hints?.network) ??
        DEFAULT_NETWORK;
    const network = getNetwork(networkKey);
    const rpcUrl = input.rpcUrl ?? existing?.rpcUrl ?? input.hints?.rpcUrl ?? network.rpcUrl;
    const chainId = input.chainId
        ? input.chainId
        : existing?.chainId || input.hints?.chainId || network.chainId;
    const contractAddress =
        input.registryAddress || existing?.contractAddress || network.registryAddress;
    const config =
        existing ??
        createDefaultConfig(
            network.name,
            rpcUrl,
            chainId,
            contractAddress,
            input.mode,
            input.walletAddress,
        );

    config.version = 3;
    config.network = network.name;
    config.rpcUrl = rpcUrl;
    config.chainId = chainId;
    config.contractAddress = contractAddress;
    config.walletAddress = config.walletAddress || input.walletAddress;
    config.mode = input.mode;
    return config;
}

export interface InitializeHomeInput {
    homeDir: string;
    mode: SmartClawsMode;
    network: string;
}

export interface InitializeHomeResult {
    walletAddress: string;
    network: string;
    networkKey: string;
    registry: string;
    chainId: number;
    rpcUrl: string;
    mode: SmartClawsMode;
    fingerprint: string;
    generated: boolean;
}

/**
 * Initialize a HOME that has no configuration. Reuses a wallet-only HOME so a
 * reset or interrupted first setup can be completed without importing or
 * replacing its signing key. Refuses any current or stale configuration.
 * Generates a local signing wallet only when none exists.
 * Does not register anything on-chain.
 */
export function initializeHome(input: InitializeHomeInput): InitializeHomeResult {
    if (!isSmartClawsMode(input.mode)) {
        throw new SmartClawsError("MODE_CONSTRAINT", `Invalid mode: ${input.mode}`, {
            mode: input.mode,
        });
    }
    const existingWallet = loadWallet(input.homeDir);
    if (tryLoadConfig(input.homeDir) || readStaleConfigHints(input.homeDir)) {
        throw new SmartClawsError(
            "NOT_INITIALIZED",
            "This SmartClaws HOME already has configuration. Use configure, attach, or home reset instead of initialize.",
        );
    }
    const { key, network } = requireNamedNetwork(input.network);
    const wallet = existingWallet ?? generateWallet(input.homeDir);
    const config = createDefaultConfig(
        key,
        network.rpcUrl,
        network.chainId,
        network.registryAddress,
        input.mode,
        wallet.address,
    );
    saveConfig(config, input.homeDir);
    return {
        walletAddress: wallet.address,
        network: key,
        networkKey: key,
        registry: network.registryAddress,
        chainId: network.chainId,
        rpcUrl: redactRpcUrl(network.rpcUrl),
        mode: input.mode,
        fingerprint: homeFingerprint(input.homeDir),
        generated: existingWallet === null,
    };
}

export interface HomeConfigPatch {
    network?: string;
    rpcUrl?: string;
    chainId?: number;
    registryAddress?: string;
    mode?: SmartClawsMode;
}

export interface UpdateHomeConfigInput {
    homeDir: string;
    expectedFingerprint: string;
    patch: HomeConfigPatch;
    allowPrivateRpc?: boolean;
}

function hasAttachments(config: Config): boolean {
    return Boolean(
        config.attachedGroupAddress ||
            config.attachedAgentAddress ||
            config.attachedDeviceAddresses.length > 0 ||
            config.deviceGroupAddress,
    );
}

function isDeploymentFieldChange(before: Config, after: Config): boolean {
    return (
        before.network !== after.network ||
        before.chainId !== after.chainId ||
        before.contractAddress.toLowerCase() !== after.contractAddress.toLowerCase()
    );
}

export interface UpdateHomeConfigResult {
    before: PublicConfigView;
    after: PublicConfigView;
    fingerprint: string;
}

export function updateHomeConfig(input: UpdateHomeConfigInput): UpdateHomeConfigResult {
    requireHomeFingerprint(input.homeDir, input.expectedFingerprint);
    const existing = loadConfig(input.homeDir);
    if (!existing) {
        throw new SmartClawsError("NOT_INITIALIZED", "No SmartClaws configuration to update.");
    }
    const wallet = loadWallet(input.homeDir);
    if (wallet) assertHomeWallet(existing, wallet);

    const patch = input.patch;
    if (
        patch.network === undefined &&
        patch.rpcUrl === undefined &&
        patch.chainId === undefined &&
        patch.registryAddress === undefined &&
        patch.mode === undefined
    ) {
        throw new SmartClawsError(
            "INVALID_TARGET",
            "Configuration update requires at least one field.",
        );
    }

    const next: Config = {
        ...existing,
        attachedDeviceAddresses: [...existing.attachedDeviceAddresses],
    };

    if (patch.network !== undefined) {
        const { key, network } = requireNamedNetwork(patch.network);
        next.network = key;
        if (patch.rpcUrl === undefined) next.rpcUrl = network.rpcUrl;
        if (patch.chainId === undefined) next.chainId = network.chainId;
        if (patch.registryAddress === undefined) next.contractAddress = network.registryAddress;
    }
    if (patch.rpcUrl !== undefined) {
        next.rpcUrl = validateRpcUrl(patch.rpcUrl, { allowPrivateRpc: input.allowPrivateRpc });
    }
    if (patch.chainId !== undefined) {
        next.chainId = validateChainId(patch.chainId);
    }
    if (patch.registryAddress !== undefined) {
        next.contractAddress = validateRegistryAddress(patch.registryAddress);
    }
    if (patch.mode !== undefined) {
        if (!isSmartClawsMode(patch.mode)) {
            throw new SmartClawsError("MODE_CONSTRAINT", `Invalid mode: ${patch.mode}`, {
                mode: patch.mode,
            });
        }
        next.mode = patch.mode;
    }

    if (
        JSON.stringify(presentConfig(existing)) === JSON.stringify(presentConfig(next)) &&
        existing.rpcUrl === next.rpcUrl
    ) {
        throw new SmartClawsError(
            "INVALID_TARGET",
            "Configuration update requires at least one changed field.",
        );
    }

    if (isDeploymentFieldChange(existing, next) && hasAttachments(existing)) {
        throw new SmartClawsError(
            "STATE_CHANGED",
            "Refusing to change network, chain, or registry while attachments exist. Use home reset, then re-attach.",
        );
    }

    const group = existing.attachedGroupAddress
        ? (listGroups(input.homeDir).find(
              (item) =>
                  item.groupAddress.toLowerCase() === existing.attachedGroupAddress.toLowerCase(),
          ) ?? null)
        : null;
    const agent = existing.attachedAgentAddress
        ? (listAgents(input.homeDir).find(
              (item) =>
                  item.agentContract.toLowerCase() === existing.attachedAgentAddress.toLowerCase(),
          ) ?? null)
        : null;
    const devices = existing.attachedDeviceAddresses
        .map(
            (address) =>
                listDevices(input.homeDir).find(
                    (item) => item.deviceContract.toLowerCase() === address.toLowerCase(),
                ) ?? null,
        )
        .filter((item): item is NonNullable<typeof item> => item !== null);
    enforceModeConstraints(next.mode, { group, agent, devices });

    next.walletAddress = existing.walletAddress;
    saveConfig(next, input.homeDir);
    return {
        before: presentConfig(existing),
        after: presentConfig(next),
        fingerprint: homeFingerprint(input.homeDir),
    };
}

export interface AttachHomeEntitiesInput {
    homeDir: string;
    expectedFingerprint: string;
    group?: string | null;
    agent?: string | null;
    devices?: string[];
}

function sameAddress(left?: string, right?: string): boolean {
    return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export async function attachHomeEntities(input: AttachHomeEntitiesInput) {
    requireHomeFingerprint(input.homeDir, input.expectedFingerprint);
    const config = loadConfig(input.homeDir);
    if (!config) {
        throw new SmartClawsError("NOT_INITIALIZED", "No SmartClaws configuration to attach to.");
    }
    const wallet = loadWallet(input.homeDir) ?? undefined;
    if (wallet) assertHomeWallet(config, wallet);

    const groupQuery =
        input.group === undefined ? config.attachedGroupAddress || undefined : input.group;
    const agentQuery =
        input.agent === undefined ? config.attachedAgentAddress || undefined : input.agent;

    const group =
        groupQuery === undefined || groupQuery === null
            ? null
            : await resolveGroup(groupQuery, config, wallet, input.homeDir);
    const agent =
        agentQuery === undefined || agentQuery === null
            ? null
            : await resolveAgent(agentQuery, config, wallet, input.homeDir);

    let devices = config.attachedDeviceAddresses.map((address) =>
        listDevices(input.homeDir).find((item) => sameAddress(item.deviceContract, address)),
    );
    if (input.devices) {
        devices = await Promise.all(
            input.devices.map((query) =>
                resolveDevice(query, config, wallet, input.homeDir, group?.groupAddress),
            ),
        );
    } else {
        devices = devices.filter((item): item is NonNullable<typeof item> => Boolean(item));
        if (devices.length !== config.attachedDeviceAddresses.length) {
            devices = await Promise.all(
                config.attachedDeviceAddresses.map((address) =>
                    resolveDevice(address, config, wallet, input.homeDir, group?.groupAddress),
                ),
            );
        }
    }

    const resolvedDevices = (devices ?? []).filter((item): item is NonNullable<typeof item> =>
        Boolean(item),
    );

    if (group && config.contractAddress && !isAddress(group.groupAddress)) {
        throw new SmartClawsError("INVALID_TARGET", "Resolved group address is invalid.");
    }
    enforceModeConstraints(config.mode, { group, agent, devices: resolvedDevices });

    const next: Config = {
        ...config,
        deviceGroupAddress: group?.groupAddress ?? "",
        attachedGroupAddress: group?.groupAddress ?? "",
        attachedAgentAddress: agent?.agentContract ?? "",
        attachedDeviceAddresses: resolvedDevices.map((device) => getAddress(device.deviceContract)),
    };
    saveConfig(next, input.homeDir);
    return {
        group,
        agent,
        devices: resolvedDevices,
        fingerprint: homeFingerprint(input.homeDir),
    };
}

export interface ResetHomeInput {
    homeDir: string;
    expectedFingerprint: string;
    reason: "stale-config" | "deployment-change";
}

export function resetHomeChecked(input: ResetHomeInput) {
    requireHomeFingerprint(input.homeDir, input.expectedFingerprint);
    if (!homeExists(input.homeDir)) {
        throw new SmartClawsError("NOT_INITIALIZED", "No SmartClaws HOME to reset.");
    }
    const wallet = loadWallet(input.homeDir);
    const { backup, walletPreserved } = resetHomePreservingWallet(input.homeDir);
    return {
        reason: input.reason,
        backupName: backup.name,
        walletAddress: wallet?.address ?? null,
        walletPreserved,
        fingerprint: homeFingerprint(input.homeDir),
    };
}
