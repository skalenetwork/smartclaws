import {
    getClients,
    getPublicKeyRegistryContract,
    getPublicKeyWithConfig,
    hasPublicKeyWithConfig,
    registerPublicKeyWithConfig,
    resolvePublicKeyRegistryAddress,
    SmartClawsError,
} from "@smartclaws/sdk";
import { Command } from "commander";
import { loadConfigOrExit, loadWalletOrExit } from "../runtime.ts";

async function waitForWrite(
    config: ReturnType<typeof loadConfigOrExit>,
    wallet: ReturnType<typeof loadWalletOrExit>,
    hash: `0x${string}`,
    action: string,
): Promise<void> {
    const { publicClient } = getClients(config, wallet);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "success") return;
    throw new SmartClawsError("TRANSACTION_REVERTED", `${action} transaction reverted`, {
        txHash: hash,
    });
}

export const keyCommand = new Command("key").description(
    "Register, inspect, or remove this wallet's secp256k1 public key in PublicKeyRegistry",
);

keyCommand
    .command("register")
    .description("Register this wallet's public key (required before paid disclosure)")
    .action(async () => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        try {
            const registry = await resolvePublicKeyRegistryAddress(config);
            const hash = await registerPublicKeyWithConfig(config, wallet);
            await waitForWrite(config, wallet, hash, "registerPublicKey");
            console.log("Public key registered");
            console.log(`  Account:  ${wallet.address}`);
            console.log(`  Registry: ${registry}`);
            console.log(`  Tx:       ${hash}`);
        } catch (e: unknown) {
            console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
            process.exit(1);
        }
    });

keyCommand
    .command("show")
    .description("Show whether this wallet has a registered public key")
    .action(async () => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        try {
            const account = wallet.address as `0x${string}`;
            if (!(await hasPublicKeyWithConfig(config, account))) {
                console.log("Public key: not registered");
                console.log("Register it with:");
                console.log("  smartclaws key register");
                return;
            }
            const publicKey = await getPublicKeyWithConfig(config, account);
            const registry = await resolvePublicKeyRegistryAddress(config);
            console.log("Public key: registered");
            console.log(`  Account:  ${wallet.address}`);
            console.log(`  Registry: ${registry}`);
            console.log(`  X:        ${publicKey.x}`);
            console.log(`  Y:        ${publicKey.y}`);
        } catch (e: unknown) {
            console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
            process.exit(1);
        }
    });

keyCommand
    .command("remove")
    .description("Remove this wallet's public key from PublicKeyRegistry")
    .action(async () => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        try {
            const account = wallet.address as `0x${string}`;
            if (!(await hasPublicKeyWithConfig(config, account))) {
                console.error("Public key: not registered");
                process.exit(1);
            }
            const registry = await resolvePublicKeyRegistryAddress(config);
            const contract = getPublicKeyRegistryContract(registry, config, wallet);
            const hash = await contract.write.removePublicKey();
            await waitForWrite(config, wallet, hash, "removePublicKey");
            console.log("Public key removed");
            console.log(`  Account:  ${wallet.address}`);
            console.log(`  Registry: ${registry}`);
            console.log(`  Tx:       ${hash}`);
        } catch (e: unknown) {
            console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
            process.exit(1);
        }
    });
