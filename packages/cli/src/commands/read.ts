import {
    discloseMessages,
    getEncryptedChannelReadContract,
    getPublicClient,
    listDevices,
    MAX_DISCLOSE_BATCH,
    quoteReadFee,
    readMessages,
    resolveChannel,
    resolveChannelEncrypted,
    SmartClawsError,
} from "@smartclaws/sdk";
import { Command } from "commander";
import { formatDisclosureCost, formatReadMessageLine, jsonStringify } from "../format.ts";
import { loadConfigOrExit, loadOptionalWalletOrExit, loadWalletOrExit } from "../runtime.ts";

function printReaderGuidance(account: string): void {
    console.error(`Wallet ${account} is not an authorized reader on this channel.`);
    console.error("Ask the channel owner to grant reader access:");
    console.error(
        `  smartclaws device reader add --device <name> --channel outgoing --account ${account}`,
    );
    console.error(
        `  smartclaws agent reader add --agent <name> --channel outgoing --account ${account}`,
    );
}

function printPublicKeyGuidance(): void {
    console.error("This wallet has no public key registered. Disclosure cannot run until it does.");
    console.error("After the wallet is funded, register it with:");
    console.error("  smartclaws key register");
}

async function quoteDisclosureDeposit(
    channelAddress: `0x${string}`,
    fromOffset: number,
    count: number,
    config: ReturnType<typeof loadConfigOrExit>,
): Promise<bigint> {
    const preview = await readMessages(
        { channelAddress, offset: fromOffset, limit: count },
        config,
    );
    const ciphertexts = preview.messages.map((message) => message.rawHex);
    const channel = getEncryptedChannelReadContract(channelAddress, config);
    const publicClient = getPublicClient(config);
    const quote = await quoteReadFee(
        ciphertexts,
        () => publicClient.getGasPrice(),
        (totalBytes, n) => channel.read.getReadCallbackGas([totalBytes, n]) as Promise<bigint>,
    );
    return quote.value;
}

export const readCommand = new Command("read")
    .description("Read messages from a device's outgoing channel")
    .option("--device <name>", "Device name (reads from local device config)")
    .option("--channel <address>", "Channel address (reads directly, no local device needed)")
    .option("--limit <n>", "Number of messages to read", "10")
    .option("--offset <n>", "Start reading from this offset")
    .option("--raw", "Show raw hex instead of decoded envelopes")
    .option("--json", "Output as JSON")
    .option(
        "--disclose",
        "Paid disclosure: request, wait for CTX, and decrypt (encrypted channels)",
    )
    .option("--decrypt", "Alias for --disclose")
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const disclose = Boolean(opts.disclose || opts.decrypt);
        if (disclose) {
            loadWalletOrExit(config);
        } else {
            loadOptionalWalletOrExit(config);
        }

        const limit = Number(opts.limit);
        if (disclose && (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_DISCLOSE_BATCH)) {
            console.error(
                `Disclosure --limit must be between 1 and ${MAX_DISCLOSE_BATCH}; larger ranges are not split into multiple paid transactions.`,
            );
            process.exit(1);
        }

        let channelAddress: `0x${string}`;
        let deviceName: string | undefined;
        try {
            const resolved = resolveChannel({ device: opts.device, channel: opts.channel });
            channelAddress = resolved.channelAddress;
            deviceName = resolved.device;
        } catch (e: unknown) {
            if (e instanceof SmartClawsError && e.code === "DEVICE_NOT_FOUND") {
                console.error(`Device '${opts.device}' not found.`);
                const devices = listDevices();
                if (devices.length > 0) {
                    console.error(`Available: ${devices.map((d) => d.name).join(", ")}`);
                }
                process.exit(1);
            }
            console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
            process.exit(1);
        }

        try {
            if (!disclose) {
                const result = await readMessages(
                    {
                        channelAddress,
                        limit,
                        offset: opts.offset !== undefined ? Number(opts.offset) : undefined,
                    },
                    config,
                );
                const encrypted = result.messages.some((message) => message.encrypted)
                    ? true
                    : await resolveChannelEncrypted(channelAddress, config);

                if (result.total === 0) {
                    if (opts.json) {
                        console.log(
                            jsonStringify({
                                device: deviceName ?? null,
                                channel: channelAddress,
                                encrypted,
                                total: 0,
                                messages: [],
                            }),
                        );
                    } else {
                        console.log("No messages.");
                    }
                    return;
                }

                if (opts.json) {
                    console.log(
                        jsonStringify({
                            device: deviceName ?? null,
                            channel: result.channel,
                            encrypted,
                            total: result.total,
                            oldest: result.oldest,
                            latest: result.latest,
                            messages: result.messages,
                        }),
                    );
                    return;
                }

                console.log(
                    `Messages: ${result.total} total (offsets ${result.oldest}..${result.latest})`,
                );
                console.log(`Reading: ${result.from}..${result.to}\n`);

                for (const message of result.messages) {
                    console.log(formatReadMessageLine(message, Boolean(opts.raw)));
                }
                return;
            }

            const wallet = loadWalletOrExit(config);
            if (!(await resolveChannelEncrypted(channelAddress, config))) {
                throw new SmartClawsError(
                    "ENCRYPTION_UNSUPPORTED",
                    "Disclosure is only available on encrypted channels. Omit --disclose/--decrypt for a free plaintext read.",
                    { channel: channelAddress },
                );
            }
            const preview = await readMessages(
                {
                    channelAddress,
                    limit,
                    offset: opts.offset !== undefined ? Number(opts.offset) : undefined,
                },
                config,
            );
            if (preview.total === 0 || preview.messages.length === 0) {
                if (opts.json) {
                    console.log(
                        jsonStringify({
                            device: deviceName ?? null,
                            channel: channelAddress,
                            encrypted: true,
                            total: 0,
                            messages: [],
                        }),
                    );
                } else {
                    console.log("No messages.");
                }
                return;
            }

            const fromOffset = preview.from;
            const count = preview.messages.length;
            const deposit = await quoteDisclosureDeposit(channelAddress, fromOffset, count, config);
            console.error(formatDisclosureCost(deposit));

            const disclosed = await discloseMessages(
                { channelAddress, fromOffset, count },
                config,
                wallet,
            );

            if (opts.json) {
                console.log(
                    jsonStringify({
                        device: deviceName ?? null,
                        encrypted: true,
                        ...disclosed,
                    }),
                );
                return;
            }

            console.log(
                `Disclosed: offsets ${disclosed.from}..${disclosed.to} (${disclosed.messages.length} messages)`,
            );
            console.log(`  Tx:      ${disclosed.txHash}`);
            if (disclosed.ctxHashes.length > 0) {
                console.log(`  CTX:     ${disclosed.ctxHashes.join(", ")}`);
            }
            console.log(`  Deposit: ${disclosed.callbackDeposit.toString()} wei`);
            console.log("");
            for (const message of disclosed.messages) {
                console.log(formatReadMessageLine(message, Boolean(opts.raw)));
            }
        } catch (e: unknown) {
            if (e instanceof SmartClawsError && e.code === "NOT_A_READER") {
                printReaderGuidance(loadWalletOrExit(config).address);
                process.exit(1);
            }
            if (e instanceof SmartClawsError && e.code === "NO_PUBLIC_KEY") {
                printPublicKeyGuidance();
                process.exit(1);
            }
            console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
            process.exit(1);
        }
    });
