import { generateName } from "@smartclaws/core/names";
import { Command } from "commander";
import { type Address, decodeEventLog } from "viem";
import {
  getAgentContract,
  getAgentPath,
  getClients,
  getRegistryContract,
  listAgents,
  loadAgent,
  loadConfig,
  loadWallet,
  saveAgent,
} from "@smartclaws/sdk";

const DEFAULT_CHANNEL_CAPACITY = 1024 * 1024;

export const agentCommand = new Command("agent").description("Agent management");

agentCommand
  .command("register")
  .description("Register a new agent on-chain with dedicated in/out channels")
  .option("--name <name>", "Local agent name (also used as on-chain agentId; random if omitted)")
  .option("--metadata <string>", "Agent capability description", "")
  .option("--capacity <bytes>", "Channel capacity in bytes", String(DEFAULT_CHANNEL_CAPACITY))
  .action(async (opts) => {
    const config = loadConfig();
    if (!config) {
      console.error("Not initialized. Run 'smartclaws init' first.");
      process.exit(1);
    }
    if (!config.contractAddress) {
      console.error("No registry contract address configured.");
      process.exit(1);
    }

    const wallet = loadWallet();
    if (!wallet) {
      console.error("No wallet found. Run 'smartclaws init' first.");
      process.exit(1);
    }

    const name = opts.name || generateName();

    const existing = loadAgent(name);
    if (existing) {
      console.error(`Agent '${name}' is already registered locally.`);
      console.error(`  Contract: ${existing.agentContract}`);
      process.exit(1);
    }

    const registry = getRegistryContract(config, wallet);
    const { publicClient } = getClients(config, wallet);

    console.log(`Registering agent '${name}'...`);

    const hash = await registry.write.registerAgent([name, opts.metadata, BigInt(opts.capacity)]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    let agentAddress: Address | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== config.contractAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: registry.abi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "AgentRegistered") {
          agentAddress = (decoded.args as unknown as { agent: Address }).agent;
        }
      } catch {}
    }

    if (!agentAddress) {
      console.error("Failed to parse AgentRegistered event.");
      process.exit(1);
    }

    const agent = getAgentContract(agentAddress, config);
    let incomingChannel: Address;
    let outgoingChannel: Address;
    try {
      incomingChannel = (await agent.read.incomingChannel()) as Address;
      outgoingChannel = (await agent.read.outgoingChannel()) as Address;
    } catch (err) {
      console.error(`Agent registered on-chain but channel lookup failed.`);
      console.error(`  Contract: ${agentAddress}`);
      console.error(`  Tx:       ${hash}`);
      console.error(
        `Re-run when RPC is reachable; agent address is recoverable from the AgentRegistered event.`,
      );
      console.error(err);
      process.exit(1);
    }

    const record = {
      name,
      agentId: name,
      metadata: opts.metadata,
      agentContract: agentAddress,
      incomingChannel,
      outgoingChannel,
    };

    try {
      saveAgent(record);
    } catch (err) {
      console.error(`Agent registered on-chain but local save failed:`);
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      console.error(`Recover by writing this JSON to ${getAgentPath(name)}:`);
      console.error(JSON.stringify(record, null, 2));
      process.exit(1);
    }

    console.log(`Agent registered:`);
    console.log(`  Name:      ${name}`);
    console.log(`  Contract:  ${agentAddress}`);
    console.log(`  Outgoing:  ${outgoingChannel}`);
    console.log(`  Incoming:  ${incomingChannel}`);
    console.log(`  Tx:        ${hash}`);
  });

agentCommand
  .command("list")
  .description("List locally registered agents")
  .action(() => {
    const agents = listAgents();
    if (agents.length === 0) {
      console.log("No agents registered.");
      return;
    }
    for (const a of agents) {
      console.log(`${a.name}`);
      console.log(`  Contract:  ${a.agentContract}`);
      console.log(`  Outgoing:  ${a.outgoingChannel}`);
      console.log(`  Incoming:  ${a.incomingChannel}`);
      if (a.metadata) console.log(`  Metadata:  ${a.metadata}`);
    }
  });
