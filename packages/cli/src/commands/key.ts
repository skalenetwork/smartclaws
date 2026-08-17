import {
    generateViewKey,
    getViewKeyStatus,
    loadWallet,
    registerActiveViewKey,
    removeRegisteredPublicKey,
    removeViewKey,
    SmartClawsError,
    setViewKey,
} from "@smartclaws/sdk";
import { Command } from "commander";
import { loadConfigOrExit, loadWalletOrExit } from "../runtime.ts";

/**
 * Replacing a stored view key abandons any disclosure already in flight: `requestMessages`
 * snapshots the registered key at request time, so the reply is locked to the old key and the
 * fee for it is already spent. Cheap to redo, but only if the operator meant to.
 */
function confirmReplacement(hasExisting: boolean, force: boolean): void {
    if (!hasExisting || force) return;
    console.error("A view key is already stored for this wallet.");
    console.error(
        "Replacing it abandons any disclosure already requested with the current key, and the",
    );
    console.error("fee for that request is not refunded. Re-run with --force to replace it.");
    process.exit(1);
}

function printNextSteps(): void {
    console.log("");
    console.log("This key is local only until you register it:");
    console.log("  smartclaws key register");
}

export const keyCommand = new Command("key").description(
    "Manage the viewing key that opens paid disclosures, and its entry in PublicKeyRegistry",
);

keyCommand
    .command("generate")
    .description("Create a new local viewing key, separate from the wallet's signing key")
    .option("--force", "Replace an existing view key")
    .action((opts) => {
        loadConfigOrExit();
        try {
            confirmReplacement(loadWallet()?.viewPrivateKey !== undefined, Boolean(opts.force));
            const wallet = generateViewKey();
            console.log("View key generated");
            console.log(`  Account: ${wallet.address}`);
            printNextSteps();
        } catch (e: unknown) {
            console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
            process.exit(1);
        }
    });

keyCommand
    .command("import")
    .description("Store an existing private key as this wallet's viewing key")
    .requiredOption("--key <hex>", "secp256k1 private key")
    .option("--force", "Replace an existing view key")
    .action((opts) => {
        loadConfigOrExit();
        try {
            confirmReplacement(loadWallet()?.viewPrivateKey !== undefined, Boolean(opts.force));
            const wallet = setViewKey(opts.key);
            console.log("View key stored");
            console.log(`  Account: ${wallet.address}`);
            printNextSteps();
        } catch (e: unknown) {
            console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
            process.exit(1);
        }
    });

keyCommand
    .command("forget")
    .description("Delete the local viewing key; the signing key resumes that role")
    .action(() => {
        loadConfigOrExit();
        try {
            if (loadWallet()?.viewPrivateKey === undefined) {
                console.log("No view key stored; the signing key is already the viewing key.");
                return;
            }
            removeViewKey();
            console.log("View key deleted. The signing key is the viewing key again.");
            console.log("Re-register so the registry matches:");
            console.log("  smartclaws key register");
        } catch (e: unknown) {
            console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
            process.exit(1);
        }
    });

keyCommand
    .command("register")
    .description("Register the active viewing public key (required before paid disclosure)")
    .action(async () => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        try {
            const result = await registerActiveViewKey(config, wallet);
            console.log("Public key registered");
            console.log(`  Account:  ${wallet.address}`);
            console.log(`  Key:      ${wallet.viewPrivateKey ? "view key" : "signing key"}`);
            console.log(`  Registry: ${result.registry}`);
            console.log(`  Tx:       ${result.txHash}`);
        } catch (e: unknown) {
            console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
            process.exit(1);
        }
    });

keyCommand
    .command("show")
    .description("Show the registered public key and whether this wallet's view key opens it")
    .action(async () => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        try {
            const status = await getViewKeyStatus(config, wallet);
            console.log(`  Account:   ${status.account}`);
            console.log(`  Registry:  ${status.registry}`);
            console.log(`  View key:  ${status.usesSigningKey ? "signing key" : "separate"}`);

            if (!status.registered) {
                console.log("  Registered: no");
                console.log("");
                console.log("Register it with:");
                console.log("  smartclaws key register");
                return;
            }

            console.log("  Registered: yes");
            console.log(`  X:         ${status.registeredPublicKey?.x}`);
            console.log(`  Y:         ${status.registeredPublicKey?.y}`);

            if (status.matchesViewKey) {
                console.log("  Opens:     yes — disclosures decrypt with this wallet's view key");
                return;
            }
            // Nothing on the paid path can catch this: requestMessages uses whatever is
            // registered, and unauthenticated ECIES makes a wrong key look like corrupt data.
            console.log("  Opens:     NO — the registered key is not the one stored here");
            console.log("");
            console.log("Disclosures will succeed on-chain, cost the fee, and come back");
            console.log("unreadable. Register the key this wallet actually holds:");
            console.log("  smartclaws key register");
        } catch (e: unknown) {
            console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
            process.exit(1);
        }
    });

keyCommand
    .command("remove")
    .description("Remove this wallet's public key from PublicKeyRegistry (keeps the local key)")
    .action(async () => {
        const config = loadConfigOrExit();
        const wallet = loadWalletOrExit(config);
        try {
            const result = await removeRegisteredPublicKey(config, wallet);
            console.log("Public key removed");
            console.log(`  Account:  ${wallet.address}`);
            console.log(`  Registry: ${result.registry}`);
            console.log(`  Tx:       ${result.txHash}`);
        } catch (e: unknown) {
            console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
            process.exit(1);
        }
    });
