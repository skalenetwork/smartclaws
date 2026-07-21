import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  getContract,
  http,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import SmartClawsArtifact from "@smartclaws/core/abi/SmartClaws.json";
import SmartClawsChannelArtifact from "@smartclaws/core/abi/SmartClawsChannel.json";
import AgentFactoryArtifact from "../../../smart-contracts/artifacts/contracts/factories/AgentFactory.sol/AgentFactory.json";
import ChannelFactoryArtifact from "../../../smart-contracts/artifacts/contracts/factories/ChannelFactory.sol/ChannelFactory.json";
import DeviceFactoryArtifact from "../../../smart-contracts/artifacts/contracts/factories/DeviceFactory.sol/DeviceFactory.json";
import DeviceGroupFactoryArtifact from "../../../smart-contracts/artifacts/contracts/factories/DeviceGroupFactory.sol/DeviceGroupFactory.json";

const ANVIL_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ANVIL_RPC = "http://127.0.0.1:8545";

export const account = privateKeyToAccount(ANVIL_PRIVATE_KEY);

export const publicClient = createPublicClient({
  chain: foundry,
  transport: http(ANVIL_RPC),
});

export const walletClient = createWalletClient({
  account,
  chain: foundry,
  transport: http(ANVIL_RPC),
});

async function deployArtifact(artifact: { abi: unknown; bytecode: string }, label: string): Promise<Address> {
  const hash = await walletClient.deployContract({
    abi: artifact.abi as never,
    bytecode: artifact.bytecode as `0x${string}`,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error(label + " deployment failed");
  return receipt.contractAddress;
}

export async function deployRegistry(): Promise<Address> {
  const channelFactory = await deployArtifact(ChannelFactoryArtifact, "ChannelFactory");
  const deviceFactory = await deployArtifact(DeviceFactoryArtifact, "DeviceFactory");
  const deviceGroupFactory = await deployArtifact(DeviceGroupFactoryArtifact, "DeviceGroupFactory");
  const agentFactory = await deployArtifact(AgentFactoryArtifact, "AgentFactory");
  const hash = await walletClient.deployContract({
    abi: SmartClawsArtifact.abi,
    bytecode: SmartClawsArtifact.bytecode as `0x${string}`,
    args: [channelFactory, deviceFactory, deviceGroupFactory, agentFactory],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("Registry deployment failed");
  return receipt.contractAddress;
}

export async function createChannel(registryAddress: Address, capacity = 1024 * 1024): Promise<Address> {
  const registry = getContract({
    address: registryAddress,
    abi: SmartClawsArtifact.abi,
    client: { public: publicClient, wallet: walletClient },
  });

  const hash = await registry.write.createChannel([account.address, BigInt(capacity)]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== registryAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: SmartClawsArtifact.abi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "ChannelCreated") {
        const args = decoded.args as { channel: Address };
        return args.channel;
      }
    } catch {
      continue;
    }
  }
  throw new Error("ChannelCreated event not found");
}

export function getChannelContract(address: Address) {
  return getContract({
    address,
    abi: SmartClawsChannelArtifact.abi,
    client: { public: publicClient, wallet: walletClient },
  });
}

export function createOtherWalletChannel(channelAddress: Address, privateKey: `0x${string}`) {
  const otherAccount = privateKeyToAccount(privateKey);
  const otherWallet = createWalletClient({
    account: otherAccount,
    chain: foundry,
    transport: http(ANVIL_RPC),
  });
  return getContract({
    address: channelAddress,
    abi: SmartClawsChannelArtifact.abi,
    client: { public: publicClient, wallet: otherWallet },
  });
}
