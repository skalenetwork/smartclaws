import { generateName } from "@smartclaws/core/names";
import {
    type AgentPermissionRole,
    getAgentPath,
    grantAgentPermission,
    grantAgentReader,
    listAgentReaders,
    listAgents,
    loadAgent,
    publishAgentInbound,
    publishAgentOutbound,
    registerAgent,
    resolveAgent,
    revokeAgentPermission,
    revokeAgentReader,
    SmartClawsError,
} from "@smartclaws/sdk";
import { Command } from "commander";
import {
    entityKindLabel,
    parseChannelSide,
    printPublishOutcome,
    publishHeadline,
} from "../format.ts";
import { loadConfigOrExit, loadWalletOrExit } from "../runtime.ts";

const DEFAULT_CHANNEL_CAPACITY = 1024 * 1024;
const AGENT_PERMISSION_ROLES = new Set(["publisher", "sender", "agent-admin"]);

function parseAgentPermissionRole(role: string): AgentPermissionRole {
    if (AGENT_PERMISSION_ROLES.has(role)) return role as AgentPermissionRole;
    console.error("Invalid role. Use one of: publisher, sender, agent-admin.");
    process.exit(1);
}

function parsePayload(data: string): Record<string, unknown> {
    try {
        return JSON.parse(data);
    } catch {
        console.error(`Invalid JSON payload. Example: '{"job":7}'`);
        process.exit(1);
    }
}

export const agentCommand = new Command("agent").description("Agent management");

agentCommand
    .command("register")
    .description("Register a new agent on-chain with dedicated in/out channels")
    .option("--name <name>", "Local agent name (also used as on-chain agentId; random if omitted)")
    .option("--metadata <string>", "Agent capability description", "")
    .option("--capacity <bytes>", "Channel capacity in bytes", String(DEFAULT_CHANNEL_CAPACITY))
    .option("--encrypted", "Register with encrypted channels")
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
        const agent = await registerAgent(
            config,
            wallet,
            name,
            opts.metadata,
            BigInt(opts.capacity),
            undefined,
            opts.encrypted ? { encrypted: true } : {},
        );

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
        console.log(`  Kind:      ${entityKindLabel(agent.encrypted)}`);
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
            console.log(`${a.name} (${entityKindLabel(a.encrypted)})`);
            console.log(`  Contract:  ${a.agentContract}`);
            console.log(`  Outgoing:  ${a.outgoingChannel}`);
            console.log(`  Incoming:  ${a.incomingChannel}`);
            if (a.owner) console.log(`  Owner:     ${a.owner}`);
            if (a.createdAt)
                console.log(`  Created:   ${new Date(a.createdAt * 1000).toISOString()}`);
            if (a.metadata) console.log(`  Metadata:  ${a.metadata}`);
        }
    });

agentCommand
    .command("publish")
    .description("Publish a message to your agent's outgoing channel (e.g. a decision log)")
    .requiredOption("--agent <address-or-name>", "Agent contract address or local/on-chain name")
    .requiredOption("--topic <topic>", "Message topic (e.g. decision.log)")
    .requiredOption("--data <json>", `Payload as JSON (e.g. '{"decision":"hold"}')`)
    .option("--from <name>", "Envelope 'dev' field (default: the agent name)")
    .option("--wait", "Wait for CTX confirmation on encrypted publishes (default)")
    .option(
        "--no-wait",
        "Return after the origin transaction; encrypted publishes report Scheduled, never Published",
    )
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        const payload = parsePayload(opts.data);
        const wait = !process.argv.includes("--no-wait");

        try {
            const agent = await resolveAgent(opts.agent, config, wallet);
            const result = await publishAgentOutbound(
                {
                    agentAddress: agent.agentContract as `0x${string}`,
                    topic: opts.topic,
                    payload,
                    from: opts.from ?? agent.name,
                },
                config,
                wallet,
                { wait },
            );
            const ok = printPublishOutcome(
                result,
                publishHeadline(
                    result.status,
                    `${result.dev}/${result.topic} to agent ${agent.name}`,
                ),
                [["Channel:", result.channel]],
            );
            if (!ok) process.exit(1);
        } catch (e: unknown) {
            console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
            process.exit(1);
        }
    });

agentCommand
    .command("notify")
    .description("Send a message to another agent's incoming channel (requires SENDER_ROLE)")
    .requiredOption("--agent <address-or-name>", "Target agent contract address or name")
    .requiredOption("--topic <topic>", "Message topic (e.g. task.assign)")
    .requiredOption("--data <json>", `Payload as JSON (e.g. '{"job":7}')`)
    .option("--from <name>", "Envelope 'dev' field (default: controller)", "controller")
    .option("--wait", "Wait for CTX confirmation on encrypted publishes (default)")
    .option(
        "--no-wait",
        "Return after the origin transaction; encrypted publishes report Scheduled, never Published",
    )
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        const payload = parsePayload(opts.data);
        const wait = !process.argv.includes("--no-wait");

        try {
            const agent = await resolveAgent(opts.agent, config, wallet);
            const result = await publishAgentInbound(
                {
                    agentAddress: agent.agentContract as `0x${string}`,
                    topic: opts.topic,
                    payload,
                    from: opts.from,
                },
                config,
                wallet,
                { wait },
            );
            const headline =
                result.status === "scheduled"
                    ? `Scheduled notify to ${agent.name}: ${result.dev}/${result.topic}`
                    : result.status === "published"
                      ? `Notified ${agent.name}: ${result.dev}/${result.topic}`
                      : `Notify ${result.status}: ${agent.name}: ${result.dev}/${result.topic}`;
            const ok = printPublishOutcome(result, headline, [["Channel:", result.channel]]);
            if (!ok) process.exit(1);
        } catch (e: unknown) {
            console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
            process.exit(1);
        }
    });

agentCommand
    .command("grant")
    .description("Grant an agent role (publisher, sender, or agent-admin)")
    .requiredOption("--agent <address-or-name>", "Agent contract address or local/on-chain name")
    .requiredOption("--role <role>", "Role to grant: publisher, sender, or agent-admin")
    .requiredOption("--account <address>", "Account address to grant")
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        const role = parseAgentPermissionRole(opts.role);

        try {
            const result = await grantAgentPermission(
                config,
                wallet,
                opts.agent,
                role,
                opts.account,
            );
            console.log(`Granted ${result.role} on ${result.agent.name}`);
            console.log(`  Agent:   ${result.agent.agentContract}`);
            console.log(`  Account: ${result.account}`);
            console.log(`  Tx:      ${result.txHash}`);
            console.log(`  Status:  ${result.status}`);
        } catch (e: unknown) {
            console.error(e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });

agentCommand
    .command("revoke")
    .description("Revoke an agent role (publisher, sender, or agent-admin)")
    .requiredOption("--agent <address-or-name>", "Agent contract address or local/on-chain name")
    .requiredOption("--role <role>", "Role to revoke: publisher, sender, or agent-admin")
    .requiredOption("--account <address>", "Account address to revoke")
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        const role = parseAgentPermissionRole(opts.role);

        try {
            const result = await revokeAgentPermission(
                config,
                wallet,
                opts.agent,
                role,
                opts.account,
            );
            console.log(`Revoked ${result.role} on ${result.agent.name}`);
            console.log(`  Agent:   ${result.agent.agentContract}`);
            console.log(`  Tx:      ${result.txHash}`);
            console.log(`  Status:  ${result.status}`);
        } catch (e: unknown) {
            console.error(e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });

const agentReaderCommand = agentCommand
    .command("reader")
    .description("Manage encrypted-channel reader ACLs (not AccessControl roles)");

agentReaderCommand
    .command("add")
    .description("Authorize a wallet to disclose messages on one agent channel")
    .requiredOption("--agent <address-or-name>", "Agent contract address or local/on-chain name")
    .requiredOption("--side <side>", "incoming or outgoing")
    .requiredOption("--account <address>", "Reader wallet address")
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        const side = parseChannelSide(opts.side);
        try {
            const result = await grantAgentReader(config, wallet, opts.agent, side, opts.account);
            console.log(`Granted ${result.side} reader on agent`);
            console.log(`  Agent:   ${result.agent}`);
            console.log(`  Account: ${result.reader}`);
            console.log(`  Tx:      ${result.txHash}`);
            console.log(`  Status:  ${result.status}`);
        } catch (e: unknown) {
            console.error(e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });

agentReaderCommand
    .command("remove")
    .description("Revoke disclosure access on one agent channel")
    .requiredOption("--agent <address-or-name>", "Agent contract address or local/on-chain name")
    .requiredOption("--side <side>", "incoming or outgoing")
    .requiredOption("--account <address>", "Reader wallet address")
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        const side = parseChannelSide(opts.side);
        try {
            const result = await revokeAgentReader(config, wallet, opts.agent, side, opts.account);
            console.log(`Revoked ${result.side} reader on agent`);
            console.log(`  Agent:   ${result.agent}`);
            console.log(`  Account: ${result.reader}`);
            console.log(`  Tx:      ${result.txHash}`);
            console.log(`  Status:  ${result.status}`);
        } catch (e: unknown) {
            console.error(e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });

agentReaderCommand
    .command("list")
    .description("List authorized readers on one agent channel")
    .requiredOption("--agent <address-or-name>", "Agent contract address or local/on-chain name")
    .requiredOption("--side <side>", "incoming or outgoing")
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const side = parseChannelSide(opts.side);
        try {
            const readers = await listAgentReaders(config, opts.agent, side);
            if (readers.length === 0) {
                console.log(`No ${side} readers.`);
                return;
            }
            console.log(`${side} readers:`);
            for (const reader of readers) console.log(`  ${reader}`);
        } catch (e: unknown) {
            console.error(e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });
