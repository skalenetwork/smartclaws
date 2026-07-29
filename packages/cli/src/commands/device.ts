import {
    type DevicePermissionRole,
    grantDevicePermission,
    listDevices,
    loadDevice,
    registerDevice,
    revokeDevicePermission,
} from "@smartclaws/sdk";
import { Command } from "commander";
import { loadConfigOrExit, loadWalletOrExit } from "../runtime.ts";

const DEFAULT_CHANNEL_CAPACITY = 1024 * 1024;
const DEVICE_PERMISSION_ROLES = new Set(["publisher", "master"]);

export const deviceCommand = new Command("device").description("Device management");

deviceCommand
    .command("register")
    .description("Register a new device in the attached device group")
    .requiredOption("--name <name>", "Device name/identifier")
    .option("--capacity <bytes>", "Channel capacity in bytes", String(DEFAULT_CHANNEL_CAPACITY))
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
        );

        console.log("Device registered:");
        console.log(`  Name:      ${device.name}`);
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
            console.log(d.name);
            console.log(`  Contract:  ${d.deviceContract}`);
            if (d.groupAddress) console.log(`  Group:     ${d.groupAddress}`);
            console.log(`  Outgoing:  ${d.outgoingChannel}`);
            console.log(`  Incoming:  ${d.incomingChannel}`);
            if (d.createdAt)
                console.log(`  Created:   ${new Date(d.createdAt * 1000).toISOString()}`);
        }
    });
