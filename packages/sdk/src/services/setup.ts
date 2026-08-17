import type { AgentFile, Config, DeviceFile, GroupFile, WalletFile } from "@smartclaws/core/types";
import { getAddress } from "viem";
import { loadAgent } from "../agent.js";
import { homeExists, summarizeHome } from "../backup.js";
import { tryLoadConfig } from "../config.js";
import { loadDevice } from "../device.js";
import { homeFingerprint } from "../fingerprint.js";
import { loadGroup } from "../group.js";
import { redactErrorMessage, redactRpcUrl } from "../rpc.js";
import { loadWallet } from "../wallet.js";
import { type PublicConfigView, presentConfig } from "./home.js";
import { getViewKeyStatus } from "./key-transactions.js";
import { publicKeyFingerprint, publicKeyFromPrivateKey, viewingPrivateKey } from "./keys.js";
import { getWalletInfo } from "./wallet.js";

export type SetupState =
    | "uninitialized"
    | "stale-config"
    | "wallet-missing"
    | "configuration-incomplete"
    | "wallet-unfunded"
    | "identity-unattached"
    | "public-key-unregistered"
    | "public-key-mismatch"
    | "permission-incomplete"
    | "ready"
    | "degraded-rpc";

export interface SetupIssue {
    code: string;
    severity: "blocking" | "warning";
    recommendedTool: string;
    requiresOwnerAuthorization: boolean;
    signs: boolean;
    spends: boolean;
}

export interface SetupOverrides {
    network?: string;
    rpcUrl?: string;
    chainId?: number;
    registryAddress?: string;
}

export interface GetSetupStatusInput {
    homeDir: string;
    overrides?: SetupOverrides;
}

function shadowedFields(persisted: Config | null, overrides?: SetupOverrides): string[] {
    if (!persisted || !overrides) return [];
    const fields: string[] = [];
    if (overrides.network !== undefined && overrides.network !== persisted.network) {
        fields.push("network");
    }
    if (overrides.rpcUrl !== undefined && overrides.rpcUrl !== persisted.rpcUrl) {
        fields.push("rpcUrl");
    }
    if (overrides.chainId !== undefined && overrides.chainId !== persisted.chainId) {
        fields.push("chainId");
    }
    if (
        overrides.registryAddress !== undefined &&
        overrides.registryAddress.toLowerCase() !== persisted.contractAddress.toLowerCase()
    ) {
        fields.push("registryAddress");
    }
    return fields;
}

function applyOverrides(config: Config, overrides?: SetupOverrides): Config {
    if (!overrides) return config;
    return {
        ...config,
        network: overrides.network ?? config.network,
        rpcUrl: overrides.rpcUrl ?? config.rpcUrl,
        chainId: overrides.chainId ?? config.chainId,
        contractAddress: overrides.registryAddress ?? config.contractAddress,
    };
}

function configurationIncomplete(config: Config | null): boolean {
    if (!config) return true;
    return !config.network || !config.rpcUrl || !config.chainId || !config.contractAddress;
}

function presentGroup(group: GroupFile) {
    return {
        name: group.name,
        address: group.groupAddress,
        owner: group.owner ?? null,
        skills: group.skills ?? "",
        deviceCount: group.deviceCount,
        capabilities: group.capabilities ?? null,
    };
}

function presentDevice(device: DeviceFile) {
    return {
        name: device.name,
        address: device.deviceContract,
        group: device.groupAddress,
        incomingChannel: device.incomingChannel,
        outgoingChannel: device.outgoingChannel,
        encrypted: device.encrypted === true,
        capabilities: device.capabilities ?? null,
    };
}

function presentAgent(agent: AgentFile) {
    return {
        name: agent.name,
        address: agent.agentContract,
        owner: agent.owner ?? null,
        incomingChannel: agent.incomingChannel,
        outgoingChannel: agent.outgoingChannel,
        encrypted: agent.encrypted === true,
        capabilities: agent.capabilities ?? null,
    };
}

function identityUnattached(config: Config): boolean {
    if (config.mode === "controller") return false;
    if (config.mode === "bridge-agent") {
        return !config.attachedAgentAddress || config.attachedDeviceAddresses.length !== 1;
    }
    if (config.mode === "master-agent") {
        return !config.attachedAgentAddress || !config.attachedGroupAddress;
    }
    return false;
}

function permissionIncomplete(
    config: Config,
    wallet: WalletFile | null,
    homeDir?: string,
): boolean {
    if (!wallet) return false;
    if (config.mode === "controller") return false;
    const agent = config.attachedAgentAddress
        ? loadAgent(config.attachedAgentAddress, homeDir)
        : null;
    if (config.mode === "bridge-agent" || config.mode === "master-agent") {
        if (agent?.capabilities && agent.capabilities.isAgentAdmin === false) {
            return true;
        }
    }
    return false;
}

export async function getSetupStatus(input: GetSetupStatusInput) {
    const homeDir = input.homeDir;
    const summary = summarizeHome(homeDir);
    const persisted = tryLoadConfig(homeDir);
    const wallet = loadWallet(homeDir);
    const overrides = input.overrides ?? {};
    const pluginOverrides: Record<string, unknown> = {};
    if (overrides.network !== undefined) pluginOverrides.network = overrides.network;
    if (overrides.rpcUrl !== undefined) pluginOverrides.rpcUrl = redactRpcUrl(overrides.rpcUrl);
    if (overrides.chainId !== undefined) pluginOverrides.chainId = overrides.chainId;
    if (overrides.registryAddress !== undefined) {
        pluginOverrides.registryAddress = overrides.registryAddress;
    }

    const effectiveConfig = persisted ? applyOverrides(persisted, input.overrides) : null;
    const issues: SetupIssue[] = [];
    let state: SetupState = "ready";
    let rpcOk = true;
    let rpcError: string | null = null;
    let funded: boolean | null = null;
    let balanceWei: string | null = null;
    let key: {
        registered: boolean | null;
        matchesViewKey: boolean | null;
        usesSigningKey: boolean;
        fingerprint: string;
    } | null = null;

    const exists =
        homeExists(homeDir) || Boolean(wallet) || Boolean(persisted) || summary.staleConfig;

    if (!exists) {
        state = "uninitialized";
        issues.push({
            code: "HOME_NOT_INITIALIZED",
            severity: "blocking",
            recommendedTool: "smartclaws_initialize",
            requiresOwnerAuthorization: true,
            signs: false,
            spends: false,
        });
    } else if (summary.staleConfig) {
        state = "stale-config";
        issues.push({
            code: "CONFIG_VERSION_UNSUPPORTED",
            severity: "blocking",
            recommendedTool: "smartclaws_home_reset",
            requiresOwnerAuthorization: true,
            signs: false,
            spends: false,
        });
    } else if (!wallet) {
        state = "wallet-missing";
        issues.push({
            code: "NO_WALLET",
            severity: "blocking",
            recommendedTool: "smartclaws_initialize",
            requiresOwnerAuthorization: true,
            signs: false,
            spends: false,
        });
    } else if (configurationIncomplete(effectiveConfig)) {
        state = "configuration-incomplete";
        issues.push({
            code: "CONFIGURATION_INCOMPLETE",
            severity: "blocking",
            recommendedTool: persisted ? "smartclaws_configure" : "smartclaws_initialize",
            requiresOwnerAuthorization: true,
            signs: false,
            spends: false,
        });
    }

    if (
        wallet &&
        effectiveConfig &&
        !configurationIncomplete(effectiveConfig) &&
        state === "ready"
    ) {
        try {
            const info = await getWalletInfo(effectiveConfig, wallet);
            funded = BigInt(info.balanceWei) > 0n;
            balanceWei = info.balanceWei;
        } catch (error) {
            rpcOk = false;
            rpcError = redactErrorMessage(error instanceof Error ? error.message : String(error));
        }

        if (rpcOk) {
            try {
                const status = await getViewKeyStatus(effectiveConfig, wallet);
                key = {
                    registered: status.registered,
                    matchesViewKey: status.matchesViewKey,
                    usesSigningKey: status.usesSigningKey,
                    fingerprint: publicKeyFingerprint(status.localPublicKey),
                };
            } catch (error) {
                rpcOk = false;
                rpcError = redactErrorMessage(
                    error instanceof Error ? error.message : String(error),
                );
                key = {
                    registered: null,
                    matchesViewKey: null,
                    usesSigningKey: wallet.viewPrivateKey === undefined,
                    fingerprint: publicKeyFingerprint(
                        publicKeyFromPrivateKey(viewingPrivateKey(wallet)),
                    ),
                };
            }
        } else {
            key = {
                registered: null,
                matchesViewKey: null,
                usesSigningKey: wallet.viewPrivateKey === undefined,
                fingerprint: publicKeyFingerprint(
                    publicKeyFromPrivateKey(viewingPrivateKey(wallet)),
                ),
            };
        }

        if (!rpcOk) {
            state = "degraded-rpc";
            issues.push({
                code: "NO_RPC",
                severity: "warning",
                recommendedTool: "smartclaws_setup_status",
                requiresOwnerAuthorization: false,
                signs: false,
                spends: false,
            });
        } else if (funded === false) {
            state = "wallet-unfunded";
            issues.push({
                code: "INSUFFICIENT_BALANCE",
                severity: "blocking",
                recommendedTool: "smartclaws_setup_status",
                requiresOwnerAuthorization: false,
                signs: false,
                spends: false,
            });
        } else if (identityUnattached(effectiveConfig)) {
            state = "identity-unattached";
            issues.push({
                code: "IDENTITY_UNATTACHED",
                severity: "blocking",
                recommendedTool: "smartclaws_attach",
                requiresOwnerAuthorization: true,
                signs: false,
                spends: false,
            });
        } else if (key?.registered === false) {
            state = "public-key-unregistered";
            issues.push({
                code: "NO_PUBLIC_KEY",
                severity: "blocking",
                recommendedTool: "smartclaws_view_key_register",
                requiresOwnerAuthorization: true,
                signs: true,
                spends: true,
            });
        } else if (key?.registered === true && key.matchesViewKey === false) {
            state = "public-key-mismatch";
            issues.push({
                code: "PUBLIC_KEY_MISMATCH",
                severity: "blocking",
                recommendedTool: "smartclaws_view_key_register",
                requiresOwnerAuthorization: true,
                signs: true,
                spends: true,
            });
        } else if (permissionIncomplete(effectiveConfig, wallet, homeDir)) {
            state = "permission-incomplete";
            issues.push({
                code: "MISSING_PERMISSION",
                severity: "warning",
                recommendedTool: "smartclaws_role_grant",
                requiresOwnerAuthorization: true,
                signs: true,
                spends: true,
            });
        }
    } else if (wallet && !key) {
        key = {
            registered: null,
            matchesViewKey: null,
            usesSigningKey: wallet.viewPrivateKey === undefined,
            fingerprint: publicKeyFingerprint(publicKeyFromPrivateKey(viewingPrivateKey(wallet))),
        };
    }

    const attachedGroup = effectiveConfig?.attachedGroupAddress
        ? loadGroup(effectiveConfig.attachedGroupAddress, homeDir)
        : null;
    const attachedAgent = effectiveConfig?.attachedAgentAddress
        ? loadAgent(effectiveConfig.attachedAgentAddress, homeDir)
        : null;
    const attachedDevices = (effectiveConfig?.attachedDeviceAddresses ?? [])
        .map((address) => loadDevice(address, homeDir))
        .filter((item): item is DeviceFile => item !== null);

    return {
        state,
        ready: state === "ready",
        home: {
            exists,
            configVersion: summary.configVersion,
            staleConfig: summary.staleConfig,
            fingerprint: homeFingerprint(homeDir),
        },
        configuration: {
            persisted: persisted ? presentConfig(persisted) : null,
            pluginOverrides,
            effective: effectiveConfig ? presentConfig(effectiveConfig) : null,
            shadowedFields: shadowedFields(persisted, input.overrides),
        },
        wallet: wallet
            ? {
                  address: getAddress(wallet.address),
                  funded,
                  balanceWei,
              }
            : null,
        attachments: {
            group: attachedGroup ? presentGroup(attachedGroup) : null,
            agent: attachedAgent ? presentAgent(attachedAgent) : null,
            devices: attachedDevices.map(presentDevice),
        },
        key,
        rpc: {
            ok: rpcOk,
            error: rpcError,
            url: effectiveConfig ? redactRpcUrl(effectiveConfig.rpcUrl) : null,
        },
        issues,
    };
}

export type SetupStatus = Awaited<ReturnType<typeof getSetupStatus>>;
export type { PublicConfigView };
