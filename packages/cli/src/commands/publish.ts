import {
    hydrateDevice,
    listAgents,
    listDevices,
    loadAgent,
    loadDevice,
    publishAgentOutbound,
    publishChannelMessage,
    publishDeviceCommand,
    publishDeviceTelemetry,
    resolveChannel,
    SmartClawsError,
} from "@smartclaws/sdk";
import { Command } from "commander";
import { printPublishOutcome, publishHeadline } from "../format.ts";
import { loadConfigOrExit, loadWalletOrExit } from "../runtime.ts";

function printPublisherGuidance(deviceName: string, account: string, canGrant: boolean): void {
    console.error(
        `Wallet ${account} does not have publisher permission for device '${deviceName}'.`,
    );
    if (canGrant) {
        console.error("Grant it with:");
        console.error(
            `  smartclaws device grant --device ${deviceName} --role publisher --account ${account}`,
        );
    } else {
        console.error("Ask a device admin to grant publisher permission:");
        console.error(
            `  smartclaws device grant --device ${deviceName} --role publisher --account ${account}`,
        );
    }
}

function printMasterGuidance(deviceName: string, account: string, canGrant: boolean): void {
    console.error(`Wallet ${account} does not have master permission for device '${deviceName}'.`);
    if (canGrant) {
        console.error("Grant it with:");
        console.error(
            `  smartclaws device grant --device ${deviceName} --role master --account ${account}`,
        );
    } else {
        console.error("Ask a device admin to grant master permission:");
        console.error(
            `  smartclaws device grant --device ${deviceName} --role master --account ${account}`,
        );
    }
}

export const publishCommand = new Command("publish")
    .description("Publish a message through a device contract or directly to an authorized channel")
    .option(
        "--device <address-or-name>",
        "Device contract address or local name (publishes through SmartClawsDevice)",
    )
    .option(
        "--device-channel <channel>",
        "When using --device: telemetry for outgoing telemetry, command for incoming commands",
        "telemetry",
    )
    .option(
        "--agent <address-or-name>",
        "Agent contract address or local name (publishes to the agent's outgoing channel)",
    )
    .option("--channel <address>", "Direct channel address (publish to any authorized channel)")
    .option(
        "--from <name>",
        "Envelope 'dev' field when using --channel (default: controller)",
        "controller",
    )
    .requiredOption(
        "--topic <topic>",
        "Message topic (e.g. telemetry.switch_status, command.switch.set)",
    )
    .requiredOption("--data <json>", `Payload as JSON (e.g. '{"on":true}')`)
    .option("--wait", "Wait for CTX confirmation on encrypted publishes (default)")
    .option(
        "--no-wait",
        "Return after the origin transaction; encrypted publishes report Scheduled, never Published",
    )
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        // Commander leaves `wait` undefined unless a flag is passed, and sets it to false for
        // --no-wait. Read the parsed option rather than scanning process.argv: a global scan
        // ignores this command's parse entirely and cannot be driven in-process by a test.
        const wait = opts.wait ?? true;

        let payload: Record<string, unknown>;
        try {
            payload = JSON.parse(opts.data);
        } catch {
            console.error(`Invalid JSON payload. Example: '{"on":true}'`);
            process.exit(1);
        }

        try {
            const targets = [opts.device, opts.agent, opts.channel].filter(Boolean);
            if (targets.length !== 1) {
                throw new SmartClawsError(
                    "INVALID_TARGET",
                    "Provide exactly one of --device, --agent or --channel.",
                );
            }

            if (opts.agent) {
                const agent = loadAgent(opts.agent);
                if (!agent) {
                    console.error(`Agent '${opts.agent}' not found.`);
                    const agents = listAgents();
                    if (agents.length > 0)
                        console.error(`Available: ${agents.map((a) => a.name).join(", ")}`);
                    process.exit(1);
                }
                // The agent's own outgoing channel — a decision log. Writing to another
                // agent's inbox is a different operation with a different role (SENDER_ROLE)
                // and is not folded in here.
                const result = await publishAgentOutbound(
                    {
                        agentAddress: agent.agentContract as `0x${string}`,
                        topic: opts.topic,
                        payload,
                        from: opts.from === "controller" ? agent.name : opts.from,
                    },
                    config,
                    wallet,
                    { wait },
                );
                const ok = printPublishOutcome(
                    result,
                    publishHeadline(result.status, `to ${agent.name}/${result.topic}`),
                    [
                        ["Agent:", agent.agentContract],
                        ["Channel:", result.channel],
                    ],
                );
                if (!ok) process.exit(1);
                return;
            }

            if (opts.device) {
                if (!["telemetry", "command"].includes(opts.deviceChannel)) {
                    throw new SmartClawsError(
                        "INVALID_TARGET",
                        "--device-channel must be one of: telemetry, command.",
                    );
                }
                const device = loadDevice(opts.device);
                if (!device) {
                    console.error(`Device '${opts.device}' not found.`);
                    const devices = listDevices();
                    if (devices.length > 0)
                        console.error(`Available: ${devices.map((d) => d.name).join(", ")}`);
                    process.exit(1);
                }

                const hydrated = await hydrateDevice(device.deviceContract, config, wallet);
                if (opts.deviceChannel === "command") {
                    if (!hydrated.capabilities?.isMaster) {
                        printMasterGuidance(
                            hydrated.name,
                            wallet.address,
                            Boolean(hydrated.capabilities?.isDeviceAdmin),
                        );
                        process.exit(1);
                    }

                    const result = await publishDeviceCommand(
                        {
                            deviceAddress: hydrated.deviceContract as `0x${string}`,
                            topic: opts.topic,
                            payload,
                            from: opts.from,
                        },
                        config,
                        wallet,
                        { wait },
                    );
                    const ok = printPublishOutcome(
                        result,
                        publishHeadline(
                            result.status,
                            `command to ${hydrated.name}/${result.topic}`,
                        ),
                        [
                            ["Device:", hydrated.deviceContract],
                            ["Channel:", result.channel],
                        ],
                    );
                    if (!ok) process.exit(1);
                    return;
                }

                if (!hydrated.capabilities?.isPublisher) {
                    printPublisherGuidance(
                        hydrated.name,
                        wallet.address,
                        Boolean(hydrated.capabilities?.isDeviceAdmin),
                    );
                    process.exit(1);
                }

                const result = await publishDeviceTelemetry(
                    {
                        deviceAddress: hydrated.deviceContract as `0x${string}`,
                        topic: opts.topic,
                        payload,
                        from: hydrated.name,
                    },
                    config,
                    wallet,
                    { wait },
                );
                const ok = printPublishOutcome(
                    result,
                    publishHeadline(result.status, `to ${hydrated.name}/${result.topic}`),
                    [
                        ["Device:", hydrated.deviceContract],
                        ["Channel:", result.channel],
                    ],
                );
                if (!ok) process.exit(1);
                return;
            }

            const resolved = resolveChannel({ channel: opts.channel });
            const result = await publishChannelMessage(
                {
                    channelAddress: resolved.channelAddress,
                    topic: opts.topic,
                    payload,
                    from: opts.from,
                },
                config,
                wallet,
                { wait },
            );
            const ok = printPublishOutcome(
                result,
                publishHeadline(
                    result.status,
                    `${opts.from}/${result.topic} to channel ${resolved.channelAddress}`,
                ),
            );
            if (!ok) process.exit(1);
        } catch (e: unknown) {
            console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
            process.exit(1);
        }
    });
