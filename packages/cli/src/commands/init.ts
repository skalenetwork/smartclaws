import { checkbox, confirm, input, password, select } from "@inquirer/prompts";
import { DEFAULT_NETWORK, NETWORKS } from "@smartclaws/core/networks";
import type {
    AgentFile,
    Config,
    DeviceFile,
    GroupFile,
    SmartClawsMode,
    WalletFile,
} from "@smartclaws/core/types";
import {
    assertHomeWallet,
    buildHomeConfig,
    createBackup,
    discoverDeviceSummaries,
    discoverGroupSummaries,
    discoverOwnedAgents,
    enforceModeConstraints,
    generateWallet,
    hasPublicKeyWithConfig,
    homeExists,
    isSmartClawsMode,
    loadConfig,
    loadWallet,
    readStaleConfigHints,
    registerAgent,
    registerDevice,
    registerGroup,
    resetHomePreservingWallet,
    resolveAgent,
    resolveDevice,
    resolveGroup,
    type StaleConfigHints,
    saveConfig,
    saveWallet,
    summarizeHome,
    walletFromPrivateKey,
} from "@smartclaws/sdk";
import { Command } from "commander";

const DEFAULT_CHANNEL_CAPACITY = 1024 * 1024;

interface InitOptions {
    home?: string;
    mode?: string;
    network?: string;
    rpcUrl?: string;
    chainId?: string;
    contract?: string;
    privateKey?: string;
    generateWallet?: boolean;
    group?: string;
    device?: string | string[];
    agent?: string;
    createGroup?: string;
    createDevice?: string;
    createAgent?: string;
    skills?: string;
    metadata?: string;
    capacity?: string;
    yes?: boolean;
    verbose?: boolean;
    backup?: boolean;
    encrypted?: boolean;
}

interface WalletState {
    wallet: WalletFile;
    imported: boolean;
    generated: boolean;
}

function isMode(value: string): value is SmartClawsMode {
    return isSmartClawsMode(value);
}

function splitDevices(value: unknown): string[] {
    if (!value) return [];
    const values = Array.isArray(value) ? value : [value];
    return values
        .flatMap((entry) => String(entry).split(","))
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function describeDate(seconds?: number): string {
    return seconds ? new Date(seconds * 1000).toISOString() : "unknown";
}

function groupLabel(group: GroupFile, verbose: boolean): string {
    const base = `${group.name} (${group.deviceCount} devices)`;
    if (!verbose) return base;
    return (
        base +
        " — " +
        group.groupAddress +
        " — owner " +
        group.owner +
        " — created " +
        describeDate(group.createdAt)
    );
}

function registrationKind(encrypted: boolean | undefined): { encrypted?: boolean } {
    return encrypted ? { encrypted: true } : {};
}

function deviceLabel(device: DeviceFile, verbose: boolean): string {
    const kind = device.encrypted ? "encrypted" : "plain";
    if (!verbose) return `${device.name} (${kind})`;
    return `${device.name} (${kind}) — ${device.deviceContract} — created ${describeDate(device.createdAt)}`;
}

function agentLabel(agent: AgentFile, verbose: boolean): string {
    if (!verbose) return agent.encrypted ? `${agent.name} (encrypted)` : agent.name;
    return (
        agent.name +
        " — " +
        agent.agentContract +
        " — owner " +
        (agent.owner ?? "unknown") +
        " — created " +
        describeDate(agent.createdAt)
    );
}

async function createOrLoadWallet(
    homeDir: string | undefined,
    opts: InitOptions,
    interactive: boolean,
): Promise<WalletState> {
    const existingWallet = loadWallet(homeDir);
    const existingConfig = loadConfig(homeDir);

    if (opts.privateKey) {
        const wallet = walletFromPrivateKey(opts.privateKey);
        if (
            existingConfig?.walletAddress &&
            existingConfig.walletAddress.toLowerCase() !== wallet.address.toLowerCase()
        ) {
            throw new Error(
                "This HOME belongs to " +
                    existingConfig.walletAddress +
                    ". Use a separate SMARTCLAWS_HOME for " +
                    wallet.address +
                    ".",
            );
        }
        if (
            existingWallet &&
            existingWallet.address.toLowerCase() !== wallet.address.toLowerCase()
        ) {
            throw new Error(
                "This HOME already has wallet " +
                    existingWallet.address +
                    ". Use a separate SMARTCLAWS_HOME for " +
                    wallet.address +
                    ".",
            );
        }
        saveWallet(wallet, homeDir);
        return { wallet, imported: true, generated: false };
    }

    if (opts.generateWallet) {
        if (existingConfig?.walletAddress || existingWallet) {
            throw new Error(
                "This HOME already has a wallet. Use a separate SMARTCLAWS_HOME for a new wallet.",
            );
        }
        const wallet = generateWallet(homeDir);
        return { wallet, imported: false, generated: true };
    }

    if (existingWallet) return { wallet: existingWallet, imported: false, generated: false };

    if (!interactive) {
        const wallet = generateWallet(homeDir);
        return { wallet, imported: false, generated: true };
    }

    const action = await select({
        message: "Wallet",
        choices: [
            { name: "Generate a new wallet", value: "generate" },
            { name: "Import a private key", value: "import" },
        ],
    });

    if (action === "import") {
        const privateKey = await password({ message: "Private key" });
        const wallet = walletFromPrivateKey(privateKey);
        if (
            existingConfig?.walletAddress &&
            existingConfig.walletAddress.toLowerCase() !== wallet.address.toLowerCase()
        ) {
            throw new Error(
                "This HOME belongs to " +
                    existingConfig.walletAddress +
                    ". Use a separate SMARTCLAWS_HOME for " +
                    wallet.address +
                    ".",
            );
        }
        saveWallet(wallet, homeDir);
        return { wallet, imported: true, generated: false };
    }

    const wallet = generateWallet(homeDir);
    return { wallet, imported: false, generated: true };
}

function buildConfig(
    opts: InitOptions,
    mode: SmartClawsMode,
    walletAddress: string,
    homeDir?: string,
    hints?: StaleConfigHints,
): Config {
    return buildHomeConfig({
        homeDir,
        mode,
        walletAddress,
        network: opts.network,
        rpcUrl: opts.rpcUrl,
        chainId: opts.chainId ? Number(opts.chainId) : undefined,
        registryAddress: opts.contract || undefined,
        hints,
    });
}

async function chooseGroup(
    config: Config,
    wallet: WalletFile,
    opts: InitOptions,
    interactive: boolean,
    verbose: boolean,
    homeDir?: string,
) {
    if (opts.createGroup)
        return registerGroup(config, wallet, opts.createGroup, opts.skills ?? "", homeDir);
    if (opts.group) return resolveGroup(opts.group, config, wallet, homeDir);
    if (!interactive) return null;

    const groups = await discoverGroupSummaries(config, wallet, homeDir).catch(
        () => [] as GroupFile[],
    );
    const choices = groups.map((group) => ({
        name: groupLabel(group, verbose),
        value: group.groupAddress,
    }));
    choices.push({ name: "Register a new group", value: "__new" });
    choices.push({ name: "Skip group for now", value: "__skip" });

    const selected = await select({ message: "Device group", choices });
    if (selected === "__skip") return null;
    if (selected === "__new") {
        const name = await input({ message: "Group name", required: true });
        const skills = await input({ message: "Skills", default: opts.skills ?? "" });
        return registerGroup(config, wallet, name, skills, homeDir);
    }
    return resolveGroup(selected, config, wallet, homeDir);
}

async function chooseDevices(
    mode: SmartClawsMode,
    config: Config,
    wallet: WalletFile,
    group: GroupFile | null,
    opts: InitOptions,
    interactive: boolean,
    verbose: boolean,
    homeDir?: string,
): Promise<DeviceFile[]> {
    const requested = splitDevices(opts.device);
    const devices: DeviceFile[] = [];
    const groupAddress = group?.groupAddress;

    for (const item of requested)
        devices.push(await resolveDevice(item, config, wallet, homeDir, groupAddress));
    if (opts.createDevice) {
        if (!groupAddress)
            throw new Error("--create-device requires an attached or created group.");
        devices.push(
            await registerDevice(
                config,
                wallet,
                groupAddress,
                opts.createDevice,
                BigInt(opts.capacity ?? DEFAULT_CHANNEL_CAPACITY),
                homeDir,
                registrationKind(opts.encrypted),
            ),
        );
    }
    if (devices.length > 0 || !interactive) return devices;

    if (!groupAddress) return devices;
    let showedProgress = false;
    const existing = await discoverDeviceSummaries(
        config,
        groupAddress,
        homeDir,
        (loaded, total) => {
            showedProgress = total > 0;
            if (showedProgress) process.stderr.write(`\rLoading device names: ${loaded}/${total}`);
        },
    ).catch(() => [] as DeviceFile[]);
    if (showedProgress) process.stderr.write("\n");

    if (mode === "bridge-agent") {
        const choices = existing.map((device) => ({
            name: deviceLabel(device, verbose),
            value: device.deviceContract,
        }));
        choices.push({ name: "Register a new device", value: "__new" });
        const selected = await select({ message: "Bridge device", choices });
        if (selected === "__new") {
            const name = await input({ message: "Device name", required: true });
            return [
                await registerDevice(
                    config,
                    wallet,
                    groupAddress,
                    name,
                    BigInt(opts.capacity ?? DEFAULT_CHANNEL_CAPACITY),
                    homeDir,
                    registrationKind(opts.encrypted),
                ),
            ];
        }
        return [await resolveDevice(selected, config, wallet, homeDir, groupAddress)];
    }

    if (existing.length > 0) {
        const selected = await checkbox({
            message: "Attach devices",
            choices: existing.map((device) => ({
                name: deviceLabel(device, verbose),
                value: device.deviceContract,
            })),
            required: false,
        });
        for (const deviceAddress of selected)
            devices.push(
                await resolveDevice(String(deviceAddress), config, wallet, homeDir, groupAddress),
            );
    }

    while (
        await confirm({
            message: "Register another device?",
            default: existing.length === 0 && devices.length === 0,
        })
    ) {
        const name = await input({ message: "Device name", required: true });
        devices.push(
            await registerDevice(
                config,
                wallet,
                groupAddress,
                name,
                BigInt(opts.capacity ?? DEFAULT_CHANNEL_CAPACITY),
                homeDir,
                registrationKind(opts.encrypted),
            ),
        );
    }
    return devices;
}

async function chooseAgent(
    mode: SmartClawsMode,
    config: Config,
    wallet: WalletFile,
    opts: InitOptions,
    interactive: boolean,
    verbose: boolean,
    walletWasImported: boolean,
    walletWasGenerated: boolean,
    homeDir?: string,
) {
    if (mode === "controller") return null;
    if (opts.createAgent)
        return registerAgent(
            config,
            wallet,
            opts.createAgent,
            opts.metadata ?? "",
            BigInt(opts.capacity ?? DEFAULT_CHANNEL_CAPACITY),
            homeDir,
            registrationKind(opts.encrypted),
        );
    if (opts.agent) return resolveAgent(opts.agent, config, wallet, homeDir);
    if (!interactive) return null;

    if (walletWasImported && !walletWasGenerated) {
        const scan = await confirm({
            message: "Scan for agents owned by this wallet?",
            default: true,
        });
        if (scan) {
            const owned = await discoverOwnedAgents(config, wallet, homeDir).catch(
                () => [] as AgentFile[],
            );
            if (owned.length > 0) {
                const choices = owned.map((agent) => ({
                    name: agentLabel(agent, verbose),
                    value: agent.agentContract,
                }));
                choices.push({ name: "Register a new agent", value: "__new" });
                const selected = await select({ message: "Agent", choices });
                if (selected !== "__new") return resolveAgent(selected, config, wallet, homeDir);
            }
        }
    }

    const name = await input({ message: "Agent name", required: true });
    const metadata = await input({ message: "Agent metadata", default: opts.metadata ?? "" });
    return registerAgent(
        config,
        wallet,
        name,
        metadata,
        BigInt(opts.capacity ?? DEFAULT_CHANNEL_CAPACITY),
        homeDir,
        registrationKind(opts.encrypted),
    );
}

interface ExistingHomeOutcome {
    /** False when the user declined; the caller exits without changes. */
    proceed: boolean;
    /** Local preferences salvaged from a stale config that was reset. */
    hints?: StaleConfigHints;
}

/**
 * When a HOME already exists, show what's there, confirm in interactive mode,
 * and snapshot a backup before anything is mutated.
 *
 * A config from a superseded version is reset rather than migrated: the whole HOME is
 * backed up and cleared apart from the wallet, because its cached group/device/agent
 * records name contracts in the abandoned deployment. Only local preferences survive.
 */
async function handleExistingHome(
    homeDir: string | undefined,
    opts: InitOptions,
    interactive: boolean,
): Promise<ExistingHomeOutcome> {
    if (!homeExists(homeDir)) return { proceed: true };

    const s = summarizeHome(homeDir);
    console.log("Existing SmartClaws HOME found:");
    if (s.walletAddress) console.log(`  Wallet:    ${s.walletAddress}`);
    if (s.network) console.log(`  Network:   ${s.network}`);
    if (s.mode) console.log(`  Mode:      ${s.mode}`);
    if (s.attachedGroupAddress) console.log(`  Group:     ${s.attachedGroupAddress}`);
    if (s.attachedAgentAddress) console.log(`  Agent:     ${s.attachedAgentAddress}`);
    console.log(
        `  Records:   ${s.groupCount} group(s), ${s.deviceCount} device(s), ${s.agentCount} agent(s)`,
    );

    if (s.staleConfig) {
        return handleStaleHome(homeDir, opts, interactive, s.configVersion);
    }

    if (interactive) {
        const proceed = await confirm({
            message: "Re-run init on this HOME? A backup will be saved first.",
            default: true,
        });
        if (!proceed) {
            console.log("Left HOME unchanged.");
            return { proceed: false };
        }
    }

    // Backup runs before any mutation. A run that fails later leaves a harmless
    // extra backup; that is acceptable and keeps the prior state recoverable.
    if (opts.backup === false) {
        console.log("Skipping backup (--no-backup).");
    } else {
        const result = createBackup(homeDir);
        console.log(`Backup saved: ${result.path} (${result.fileCount} files)`);
    }
    return { proceed: true };
}

async function handleStaleHome(
    homeDir: string | undefined,
    opts: InitOptions,
    interactive: boolean,
    configVersion: number | null,
): Promise<ExistingHomeOutcome> {
    const version = configVersion === null ? "an unreadable" : `a version ${configVersion}`;
    console.log("");
    console.log(`  This HOME has ${version} config, which this release cannot load.`);
    console.log("  It will be backed up and re-created. Your wallet and address are kept;");
    console.log("  the cached group, device and agent records are not — they name contracts");
    console.log("  from a superseded deployment and would resolve to the wrong channels.");

    // The backup becomes the only copy of the discarded records, so this is the one path
    // where --no-backup would mean irreversible deletion. Refuse rather than honour it.
    if (opts.backup === false) {
        throw new Error(
            "--no-backup cannot be used on a HOME that must be reset: the backup is the only " +
                "copy of the records being discarded. Re-run without --no-backup.",
        );
    }

    if (interactive) {
        const proceed = await confirm({
            message: "Back up and re-create this HOME?",
            default: true,
        });
        if (!proceed) {
            console.log("Left HOME unchanged.");
            return { proceed: false };
        }
    }

    // Read the salvageable preferences before the file is cleared.
    const hints = readStaleConfigHints(homeDir) ?? undefined;
    const { backup, walletPreserved } = resetHomePreservingWallet(homeDir);
    console.log(`Backup saved: ${backup.path} (${backup.fileCount} files)`);
    console.log(walletPreserved ? "Wallet preserved." : "No wallet found to preserve.");

    // The mode is kept because silently downgrading a master-agent node to controller would
    // change how it behaves without saying so. But the entities that mode requires lived in
    // the old deployment, so they have to be re-created in this run or init will refuse.
    if (hints?.mode && hints.mode !== "controller") {
        console.log(
            `Mode '${hints.mode}' is kept, but its agent/devices were part of the old deployment.`,
        );
        console.log("Re-attach or re-create them in this run (--create-agent, --create-device).");
    }
    return { proceed: true, hints };
}

function printSummary(
    config: Config,
    group: GroupFile | null,
    agent: AgentFile | null,
    devices: DeviceFile[],
    generated: boolean,
) {
    console.log("SmartClaws HOME initialized");
    console.log(`  Network:   ${config.network}`);
    console.log(`  RPC URL:   ${config.rpcUrl}`);
    console.log(`  Chain ID:  ${config.chainId}`);
    if (config.contractAddress) console.log(`  Contract:  ${config.contractAddress}`);
    console.log(`  Wallet:    ${config.walletAddress}${generated ? " (generated)" : ""}`);
    console.log(`  Mode:      ${config.mode}`);
    if (group) console.log(`  Group:     ${group.name} (${group.groupAddress})`);
    if (agent)
        console.log(
            `  Agent:     ${agent.name} (${agent.agentContract})${agent.encrypted ? " [encrypted]" : ""}`,
        );
    if (devices.length > 0)
        console.log(
            `  Devices:   ${devices
                .map((device) => (device.encrypted ? `${device.name} (encrypted)` : device.name))
                .join(", ")}`,
        );
}

/**
 * Report whether the wallet can take part in encrypted channels. Registering a key is a
 * transaction and needs a funded wallet, so init never auto-registers — especially not
 * for a freshly generated wallet that still has zero balance.
 */
async function printEncryptionReadiness(
    config: Config,
    wallet: WalletFile,
    generated: boolean,
): Promise<void> {
    let registered: boolean | undefined;
    try {
        registered = await hasPublicKeyWithConfig(config, wallet.address as `0x${string}`);
    } catch {
        // Never fail init over a diagnostic: the HOME is already written and valid.
    }
    if (registered === true) {
        console.log("  Enc. key:  registered");
        return;
    }
    if (registered === false) console.log("  Enc. key:  not registered");
    if (generated) {
        console.log("This wallet is unfunded. After it has sFUEL, register its public key:");
        console.log("  smartclaws key register");
        return;
    }
    if (registered === false) {
        console.log("Register this wallet's public key with:");
        console.log("  smartclaws key register");
    }
}

export const initCommand = new Command("init")
    .description("Initialize SmartClaws configuration, wallet, and local attachments")
    .option("--home <path>", "SmartClaws HOME directory")
    .option("--mode <mode>", "Mode: controller, bridge-agent, or master-agent")
    .option(
        "--network <name>",
        `Network to use (${Object.keys(NETWORKS).join(", ")})`,
        DEFAULT_NETWORK,
    )
    .option("--rpc-url <url>", "Custom RPC endpoint URL (overrides network default)")
    .option("--chain-id <id>", "Custom chain ID (overrides network default)")
    .option("--contract <address>", "SmartClaws registry contract address", "")
    .option("--private-key <hex>", "Import this private key into the HOME")
    .option("--generate-wallet", "Generate a wallet for a fresh HOME")
    .option("--group <address-or-name>", "Attach an existing device group by address or name")
    .option(
        "--device <address-or-name...>",
        "Attach device(s) by address or name; comma-separated values are also accepted",
    )
    .option("--agent <address-or-name>", "Attach an existing agent by address or name")
    .option("--create-group <name>", "Register and attach a new group")
    .option("--create-device <name>", "Register and attach a new device")
    .option("--create-agent <name>", "Register and attach a new agent")
    .option("--skills <skills>", "Skills description for --create-group", "")
    .option("--metadata <metadata>", "Metadata for --create-agent", "")
    .option(
        "--capacity <bytes>",
        "Channel capacity for created devices/agents",
        String(DEFAULT_CHANNEL_CAPACITY),
    )
    .option("--yes", "Run non-interactively using provided flags/defaults")
    .option("--verbose", "Show addresses, owners, createdAt, and role data in interactive choices")
    .option("--encrypted", "Create encrypted devices/agents in this invocation")
    .option("--no-backup", "Skip the automatic backup when re-initializing an existing HOME")
    .action(async (opts: InitOptions) => {
        try {
            const homeDir = opts.home as string | undefined;
            const interactive = Boolean(process.stdin.isTTY && !opts.yes);
            const verbose = Boolean(opts.verbose || process.argv.includes("+info"));

            const existingHome = await handleExistingHome(homeDir, opts, interactive);
            if (!existingHome.proceed) return;
            const hints = existingHome.hints;

            let mode: SmartClawsMode;
            if (opts.mode) {
                if (!isMode(opts.mode)) throw new Error(`Invalid mode: ${opts.mode}`);
                mode = opts.mode;
            } else if (interactive) {
                mode = await select({
                    message: "SmartClaws mode",
                    choices: [
                        { name: "controller", value: "controller" },
                        { name: "bridge-agent", value: "bridge-agent" },
                        { name: "master-agent", value: "master-agent" },
                    ],
                });
            } else {
                mode = loadConfig(homeDir)?.mode ?? hints?.mode ?? "controller";
            }

            const walletState = await createOrLoadWallet(homeDir, opts, interactive);
            const config = buildConfig(opts, mode, walletState.wallet.address, homeDir, hints);
            assertHomeWallet(config, walletState.wallet);

            const group = await chooseGroup(
                config,
                walletState.wallet,
                opts,
                interactive,
                verbose,
                homeDir,
            );
            const agent = await chooseAgent(
                mode,
                config,
                walletState.wallet,
                opts,
                interactive,
                verbose,
                walletState.imported,
                walletState.generated,
                homeDir,
            );
            const devices = await chooseDevices(
                mode,
                config,
                walletState.wallet,
                group,
                opts,
                interactive,
                verbose,
                homeDir,
            );

            enforceModeConstraints(mode, { group, agent, devices });

            if (group) {
                config.deviceGroupAddress = group.groupAddress;
                config.attachedGroupAddress = group.groupAddress;
            }
            if (agent) config.attachedAgentAddress = agent.agentContract;
            config.attachedDeviceAddresses = devices.map((device) => device.deviceContract);
            saveConfig(config, homeDir);

            printSummary(config, group, agent, devices, walletState.generated);
            await printEncryptionReadiness(config, walletState.wallet, walletState.generated);
        } catch (err) {
            console.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    });
