import {
    type DevicePermissionRole,
    grantDevicePermission,
    grantDeviceReader,
    listDeviceReaders,
    listDevices,
    loadDevice,
    registerDevice,
    revokeDevicePermission,
    revokeDeviceReader,
} from "@smartclaws/sdk";
import { Command } from "commander";
import { entityKindLabel, parseChannelSide } from "../format.ts";
import { loadConfigOrExit, loadWalletOrExit } from "../runtime.ts";

const DEFAULT_CHANNEL_CAPACITY = 1024 * 1024;
const DEVICE_PERMISSION_ROLES = new Set(["publisher", "master"]);

export const deviceCommand = new Command("device").description("Device management");

deviceCommand
    .command("register")
    .description("Register a new device in the attached device group")
    .requiredOption("--name <name>", "Device name/identifier")
    .option("--capacity <bytes>", "Channel capacity in bytes", String(DEFAULT_CHANNEL_CAPACITY))
    .option("--encrypted", "Register with encrypted channels")
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const groupAddress = config.attachedGroupAddress || config.deviceGroupAddress;
        if (!groupAddress) {
            console.error(
                "No device group attached. Run 'smartclaws init' or 'smartclaws register' first.",
            );
            process.exit(1);
        }

        const wallet = loadWalletOrExit(config);

        const existing = loadDevice(opts.name);
        if (existing) {
            console.error(`Device '${opts.name}' is already registered.`);
            console.error(`  Outgoing channel: ${existing.outgoingChannel}`);
            process.exit(1);
        }

        console.log(`Registering device '${opts.name}'...`);
        const device = await registerDevice(
            config,
            wallet,
            groupAddress,
            opts.name,
            BigInt(opts.capacity),
            undefined,
            opts.encrypted ? { encrypted: true } : {},
        );

        console.log("Device registered:");
        console.log(`  Name:      ${device.name}`);
        console.log(`  Kind:      ${entityKindLabel(device.encrypted)}`);
        console.log(`  Contract:  ${device.deviceContract}`);
        console.log(`  Outgoing:  ${device.outgoingChannel}`);
        console.log(`  Incoming:  ${device.incomingChannel}`);
    });

function parseDevicePermissionRole(role: string): DevicePermissionRole {
    if (DEVICE_PERMISSION_ROLES.has(role)) return role as DevicePermissionRole;
    console.error("Invalid role. Use one of: publisher, master.");
    process.exit(1);
}

deviceCommand
    .command("grant")
    .description("Grant a device permission role")
    .requiredOption("--device <address-or-name>", "Device contract address or local/on-chain name")
    .requiredOption("--role <role>", "Role to grant: publisher or master")
    .requiredOption("--account <address>", "Account address to grant")
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        const role = parseDevicePermissionRole(opts.role);

        try {
            const result = await grantDevicePermission(
                config,
                wallet,
                opts.device,
                role,
                opts.account,
            );
            console.log(`Granted ${result.role} on ${result.device.name}`);
            console.log(`  Device:  ${result.device.deviceContract}`);
            console.log(`  Account: ${result.account}`);
            console.log(`  Tx:      ${result.txHash}`);
            console.log(`  Status:  ${result.status}`);
        } catch (e: unknown) {
            console.error(e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });

deviceCommand
    .command("revoke")
    .description("Revoke a device permission role")
    .requiredOption("--device <address-or-name>", "Device contract address or local/on-chain name")
    .requiredOption("--role <role>", "Role to revoke: publisher or master")
    .requiredOption("--account <address>", "Account address to revoke")
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        const role = parseDevicePermissionRole(opts.role);

        try {
            const result = await revokeDevicePermission(
                config,
                wallet,
                opts.device,
                role,
                opts.account,
            );
            console.log(`Revoked ${result.role} on ${result.device.name}`);
            console.log(`  Device:  ${result.device.deviceContract}`);
            console.log(`  Account: ${result.account}`);
            console.log(`  Tx:      ${result.txHash}`);
            console.log(`  Status:  ${result.status}`);
        } catch (e: unknown) {
            console.error(e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });

deviceCommand
    .command("list")
    .description("List registered devices")
    .action(() => {
        const devices = listDevices();
        if (devices.length === 0) {
            console.log("No devices registered.");
            return;
        }
        for (const d of devices) {
            console.log(`${d.name} (${entityKindLabel(d.encrypted)})`);
            console.log(`  Contract:  ${d.deviceContract}`);
            if (d.groupAddress) console.log(`  Group:     ${d.groupAddress}`);
            console.log(`  Outgoing:  ${d.outgoingChannel}`);
            console.log(`  Incoming:  ${d.incomingChannel}`);
            if (d.createdAt)
                console.log(`  Created:   ${new Date(d.createdAt * 1000).toISOString()}`);
        }
    });

const deviceReaderCommand = deviceCommand
    .command("reader")
    .description("Manage encrypted-channel reader ACLs (not AccessControl roles)");

deviceReaderCommand
    .command("add")
    .description("Authorize a wallet to disclose messages on one device channel")
    .requiredOption("--device <address-or-name>", "Device contract address or local/on-chain name")
    .requiredOption("--side <side>", "incoming or outgoing")
    .requiredOption("--account <address>", "Reader wallet address")
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        const side = parseChannelSide(opts.side);
        try {
            const result = await grantDeviceReader(config, wallet, opts.device, side, opts.account);
            console.log(`Granted ${result.side} reader on device`);
            console.log(`  Device:  ${result.device}`);
            console.log(`  Account: ${result.reader}`);
            console.log(`  Tx:      ${result.txHash}`);
            console.log(`  Status:  ${result.status}`);
        } catch (e: unknown) {
            console.error(e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });

deviceReaderCommand
    .command("remove")
    .description("Revoke disclosure access on one device channel")
    .requiredOption("--device <address-or-name>", "Device contract address or local/on-chain name")
    .requiredOption("--side <side>", "incoming or outgoing")
    .requiredOption("--account <address>", "Reader wallet address")
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        const side = parseChannelSide(opts.side);
        try {
            const result = await revokeDeviceReader(
                config,
                wallet,
                opts.device,
                side,
                opts.account,
            );
            console.log(`Revoked ${result.side} reader on device`);
            console.log(`  Device:  ${result.device}`);
            console.log(`  Account: ${result.reader}`);
            console.log(`  Tx:      ${result.txHash}`);
            console.log(`  Status:  ${result.status}`);
        } catch (e: unknown) {
            console.error(e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });

deviceReaderCommand
    .command("list")
    .description("List authorized readers on one device channel")
    .requiredOption("--device <address-or-name>", "Device contract address or local/on-chain name")
    .requiredOption("--side <side>", "incoming or outgoing")
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const side = parseChannelSide(opts.side);
        try {
            const readers = await listDeviceReaders(config, opts.device, side);
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
