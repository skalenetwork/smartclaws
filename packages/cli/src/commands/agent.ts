import { generateName } from "@smartclaws/core/names";
import { getAgentPath, listAgents, loadAgent, registerAgent } from "@smartclaws/sdk";
import { Command } from "commander";
import { loadConfigOrExit, loadWalletOrExit } from "../runtime.ts";

const DEFAULT_CHANNEL_CAPACITY = 1024 * 1024;

export const agentCommand = new Command("agent").description("Agent management");

agentCommand
  .command("register")
  .description("Register a new agent on-chain with dedicated in/out channels")
  .option("--name <name>", "Local agent name (also used as on-chain agentId; random if omitted)")
  .option("--metadata <string>", "Agent capability description", "")
  .option("--capacity <bytes>", "Channel capacity in bytes", String(DEFAULT_CHANNEL_CAPACITY))
  .action(async (opts) => {
    const config = loadConfigOrExit();
    if (!config.contractAddress) {
      console.error("No registry contract address configured.");
      process.exit(1);
    }

    const wallet = loadWalletOrExit(config);

    const name = opts.name || generateName();
    const existing = loadAgent(name);
    if (existing) {
      console.error(`Agent '${name}' is already registered locally.`);
      console.error(`  Contract: ${existing.agentContract}`);
      process.exit(1);
    }

    console.log(`Registering agent '${name}'...`);
    const agent = await registerAgent(config, wallet, name, opts.metadata, BigInt(opts.capacity));

    try {
      // registerAgent already saved the hydrated record; this keeps the old
      // recovery message path reachable if the record shape ever fails locally.
      loadAgent(agent.name);
    } catch (err) {
      console.error("Agent registered on-chain but local save failed:");
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      console.error(`Recover by writing this JSON to ${getAgentPath(name)}:`);
      console.error(JSON.stringify(agent, null, 2));
      process.exit(1);
    }

    console.log("Agent registered:");
    console.log(`  Name:      ${agent.name}`);
    console.log(`  Contract:  ${agent.agentContract}`);
    console.log(`  Outgoing:  ${agent.outgoingChannel}`);
    console.log(`  Incoming:  ${agent.incomingChannel}`);
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
      console.log(a.name);
      console.log(`  Contract:  ${a.agentContract}`);
      console.log(`  Outgoing:  ${a.outgoingChannel}`);
      console.log(`  Incoming:  ${a.incomingChannel}`);
      if (a.owner) console.log(`  Owner:     ${a.owner}`);
      if (a.createdAt) console.log(`  Created:   ${new Date(a.createdAt * 1000).toISOString()}`);
      if (a.metadata) console.log(`  Metadata:  ${a.metadata}`);
    }
  });
