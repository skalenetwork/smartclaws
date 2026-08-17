import PublicKeyRegistryABI from "@smartclaws/core/abi/PublicKeyRegistry.json" with {
    type: "json",
};
import SmartClawsABI from "@smartclaws/core/abi/SmartClaws.json" with { type: "json" };
import SmartClawsAgentABI from "@smartclaws/core/abi/SmartClawsAgent.json" with { type: "json" };
import SmartClawsChannelABI from "@smartclaws/core/abi/SmartClawsChannel.json" with {
    type: "json",
};
import SmartClawsChannelEncryptedABI from "@smartclaws/core/abi/SmartClawsChannelEncrypted.json" with {
    type: "json",
};
import SmartClawsDeviceABI from "@smartclaws/core/abi/SmartClawsDevice.json" with { type: "json" };
import SmartClawsDeviceGroupABI from "@smartclaws/core/abi/SmartClawsDeviceGroup.json" with {
    type: "json",
};
import { NETWORKS } from "@smartclaws/core/networks";
import type { Config, WalletFile } from "@smartclaws/core/types";
import {
    type Address,
    createPublicClient,
    createWalletClient,
    defineChain,
    getAddress,
    getContract,
    http,
    type PublicClient,
    type WalletClient,
} from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";

function buildChain(config: Config) {
    const network = NETWORKS[config.network];
    return defineChain({
        id: config.chainId,
        name: network?.chainName ?? `skale-${config.chainId}`,
        nativeCurrency: network?.nativeCurrency ?? { name: "sFUEL", symbol: "sFUEL", decimals: 18 },
        rpcUrls: { default: { http: [config.rpcUrl] } },
    });
}

export function getPublicClient(config: Config): PublicClient {
    const chain = buildChain(config);
    return createPublicClient({ chain, transport: http(config.rpcUrl) });
}

export interface Clients {
    publicClient: PublicClient;
    walletClient: WalletClient;
    account: PrivateKeyAccount;
}

export function getClients(config: Config, wallet: WalletFile): Clients {
    const chain = buildChain(config);
    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
    const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
    const walletClient = createWalletClient({
        account,
        chain,
        transport: http(config.rpcUrl),
    });
    return { publicClient, walletClient, account };
}

export function getRegistryContract(config: Config, wallet: WalletFile) {
    const { publicClient, walletClient } = getClients(config, wallet);
    return getContract({
        address: config.contractAddress as Address,
        abi: SmartClawsABI.abi,
        client: { public: publicClient, wallet: walletClient },
    });
}

export function getRegistryReadContract(config: Config) {
    const publicClient = getPublicClient(config);
    return getContract({
        address: config.contractAddress as Address,
        abi: SmartClawsABI.abi,
        client: publicClient,
    });
}

export function getDeviceGroupContract(address: Address, config: Config, wallet: WalletFile) {
    const { publicClient, walletClient } = getClients(config, wallet);
    return getContract({
        address,
        abi: SmartClawsDeviceGroupABI.abi,
        client: { public: publicClient, wallet: walletClient },
    });
}

export function getDeviceGroupReadContract(address: Address, config: Config) {
    const publicClient = getPublicClient(config);
    return getContract({
        address,
        abi: SmartClawsDeviceGroupABI.abi,
        client: publicClient,
    });
}

export function getDeviceContract(address: Address, config: Config) {
    const publicClient = getPublicClient(config);
    return getContract({
        address,
        abi: SmartClawsDeviceABI.abi,
        client: publicClient,
    });
}

export function getDeviceWriteContract(address: Address, config: Config, wallet: WalletFile) {
    const { publicClient, walletClient } = getClients(config, wallet);
    return getContract({
        address,
        abi: SmartClawsDeviceABI.abi,
        client: { public: publicClient, wallet: walletClient },
    });
}

export function getAgentContract(address: Address, config: Config) {
    const publicClient = getPublicClient(config);
    return getContract({
        address,
        abi: SmartClawsAgentABI.abi,
        client: publicClient,
    });
}

export function getAgentWriteContract(address: Address, config: Config, wallet: WalletFile) {
    const { publicClient, walletClient } = getClients(config, wallet);
    return getContract({
        address,
        abi: SmartClawsAgentABI.abi,
        client: { public: publicClient, wallet: walletClient },
    });
}

export function getChannelContract(address: Address, config: Config, wallet: WalletFile) {
    const { publicClient, walletClient } = getClients(config, wallet);
    return getContract({
        address,
        abi: SmartClawsChannelABI.abi,
        client: { public: publicClient, wallet: walletClient },
    });
}

export function getChannelReadContract(address: Address, config: Config) {
    const publicClient = getPublicClient(config);
    return getContract({
        address,
        abi: SmartClawsChannelABI.abi,
        client: publicClient,
    });
}

export function getEncryptedChannelContract(address: Address, config: Config, wallet: WalletFile) {
    const { publicClient, walletClient } = getClients(config, wallet);
    return getContract({
        address,
        abi: SmartClawsChannelEncryptedABI.abi,
        client: { public: publicClient, wallet: walletClient },
    });
}

export function getEncryptedChannelReadContract(address: Address, config: Config) {
    const publicClient = getPublicClient(config);
    return getContract({
        address,
        abi: SmartClawsChannelEncryptedABI.abi,
        client: publicClient,
    });
}

export function getPublicKeyRegistryContract(address: Address, config: Config, wallet: WalletFile) {
    const { publicClient, walletClient } = getClients(config, wallet);
    return getContract({
        address,
        abi: PublicKeyRegistryABI.abi,
        client: { public: publicClient, wallet: walletClient },
    });
}

export function getPublicKeyRegistryReadContract(address: Address, config: Config) {
    const publicClient = getPublicClient(config);
    return getContract({
        address,
        abi: PublicKeyRegistryABI.abi,
        client: publicClient,
    });
}

const publicKeyRegistries = new Map<string, Promise<Address>>();
const channelEncrypted = new Map<string, Promise<boolean>>();

export function clearContractCaches(): void {
    publicKeyRegistries.clear();
    channelEncrypted.clear();
}

export async function resolvePublicKeyRegistryAddress(config: Config): Promise<Address> {
    const key = getAddress(config.contractAddress);
    const cached = publicKeyRegistries.get(key);
    if (cached) return cached;

    const lookup = (async () => {
        const registry = getRegistryReadContract(config);
        return getAddress((await registry.read.publicKeyRegistry()) as Address);
    })();

    publicKeyRegistries.set(key, lookup);
    try {
        return await lookup;
    } catch (error) {
        publicKeyRegistries.delete(key);
        throw error;
    }
}

export function rememberChannelEncrypted(address: Address, encrypted: boolean): void {
    channelEncrypted.set(getAddress(address), Promise.resolve(encrypted));
}

export async function resolveChannelEncrypted(address: Address, config: Config): Promise<boolean> {
    const key = getAddress(address);
    const cached = channelEncrypted.get(key);
    if (cached) return cached;

    const lookup = (async () => {
        const channel = getChannelReadContract(key, config);
        return (await channel.read.isEncrypted()) as boolean;
    })();

    channelEncrypted.set(key, lookup);
    try {
        return await lookup;
    } catch (error) {
        channelEncrypted.delete(key);
        throw error;
    }
}
