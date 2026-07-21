import { checkbox, confirm, input, password, select } from "@inquirer/prompts";
import { DEFAULT_NETWORK, getNetwork, NETWORKS } from "@smartclaws/core/networks";
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
  createBackup,
  createDefaultConfig,
  discoverDevices,
  discoverGroups,
  discoverOwnedAgents,
  enforceModeConstraints,
  generateWallet,
  homeExists,
  loadConfig,
  loadWallet,
  registerAgent,
  registerDevice,
  registerGroup,
  resolveAgent,
  resolveDevice,
  resolveGroup,
  saveConfig,
  saveWallet,
  summarizeHome,
  walletFromPrivateKey,
} from "@smartclaws/sdk";
import { Command } from "commander";

const DEFAULT_CHANNEL_CAPACITY = 1024 * 1024;
const MODES: SmartClawsMode[] = ["controller", "bridge-agent", "master-agent"];

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
}

interface WalletState {
  wallet: WalletFile;
  imported: boolean;
  generated: boolean;
}

function isMode(value: string): value is SmartClawsMode {
  return (MODES as string[]).includes(value);
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

function deviceLabel(device: DeviceFile, verbose: boolean): string {
  if (!verbose) return device.name;
  return `${device.name} — ${device.deviceContract} — created ${describeDate(device.createdAt)}`;
}

function agentLabel(agent: AgentFile, verbose: boolean): string {
  if (!verbose) return agent.name;
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
    if (existingWallet && existingWallet.address.toLowerCase() !== wallet.address.toLowerCase()) {
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
): Config {
  const existing = loadConfig(homeDir);
  const network = getNetwork(opts.network ?? existing?.network ?? DEFAULT_NETWORK);
  const rpcUrl = opts.rpcUrl ?? existing?.rpcUrl ?? network.rpcUrl;
  const chainId = opts.chainId ? Number(opts.chainId) : existing?.chainId || network.chainId;
  const contractAddress = opts.contract || existing?.contractAddress || network.registryAddress;
  const config =
    existing ??
    createDefaultConfig(network.name, rpcUrl, chainId, contractAddress, mode, walletAddress);

  config.version = 2;
  config.network = network.name;
  config.rpcUrl = rpcUrl;
  config.chainId = chainId;
  config.contractAddress = contractAddress;
  config.walletAddress = config.walletAddress || walletAddress;
  config.mode = mode;
  return config;
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

  const groups = await discoverGroups(config, wallet, homeDir).catch(() => [] as GroupFile[]);
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
    if (!groupAddress) throw new Error("--create-device requires an attached or created group.");
    devices.push(
      await registerDevice(
        config,
        wallet,
        groupAddress,
        opts.createDevice,
        BigInt(opts.capacity ?? DEFAULT_CHANNEL_CAPACITY),
        homeDir,
      ),
    );
  }
  if (devices.length > 0 || !interactive) return devices;

  if (!groupAddress) return devices;
  const existing = await discoverDevices(config, groupAddress, wallet, homeDir).catch(
    () => [] as DeviceFile[],
  );

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
    );
  if (opts.agent) return resolveAgent(opts.agent, config, wallet, homeDir);
  if (!interactive) return null;

  if (walletWasImported && !walletWasGenerated) {
    const scan = await confirm({ message: "Scan for agents owned by this wallet?", default: true });
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
  );
}

/**
 * When a HOME already exists, show what's there, confirm in interactive mode,
 * and snapshot a backup before anything is mutated. Returns false when the user
 * declined (caller should exit without changes).
 */
async function handleExistingHome(
  homeDir: string | undefined,
  opts: InitOptions,
  interactive: boolean,
): Promise<boolean> {
  if (!homeExists(homeDir)) return true;

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
  if (s.migratedFromV1) console.log("  Note:      legacy v1 config will be upgraded to v2.");

  if (interactive) {
    const proceed = await confirm({
      message: "Re-run init on this HOME? A backup will be saved first.",
      default: true,
    });
    if (!proceed) {
      console.log("Left HOME unchanged.");
      return false;
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
  return true;
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
  if (agent) console.log(`  Agent:     ${agent.name} (${agent.agentContract})`);
  if (devices.length > 0)
    console.log(`  Devices:   ${devices.map((device) => device.name).join(", ")}`);
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
  .option("--no-backup", "Skip the automatic backup when re-initializing an existing HOME")
  .action(async (opts: InitOptions) => {
    try {
      const homeDir = opts.home as string | undefined;
      const interactive = Boolean(process.stdin.isTTY && !opts.yes);
      const verbose = Boolean(opts.verbose || process.argv.includes("+info"));

      if (!(await handleExistingHome(homeDir, opts, interactive))) return;

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
        mode = loadConfig(homeDir)?.mode ?? "controller";
      }

      const walletState = await createOrLoadWallet(homeDir, opts, interactive);
      const config = buildConfig(opts, mode, walletState.wallet.address, homeDir);
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
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
