import {
    assertHomeWallet,
    type Config,
    loadConfig,
    loadWallet,
    SmartClawsError,
    type WalletFile,
} from "@smartclaws/sdk";

export function loadConfigOrExit(): Config {
    let config: Config | null;
    try {
        config = loadConfig();
    } catch (error) {
        // A stale HOME is not an uninitialized one, and the difference decides what the
        // user should do next. Without this branch the raw error escapes commander and
        // prints a stack trace over the guidance.
        if (error instanceof SmartClawsError && error.code === "CONFIG_VERSION_UNSUPPORTED") {
            console.error(
                "This SmartClaws HOME was created by an older version and cannot be loaded.",
            );
            console.error(
                "Run 'smartclaws init' to re-create it. A backup is saved first and your wallet is preserved.",
            );
            process.exit(1);
        }
        throw error;
    }
    if (!config) {
        console.error("Not initialized. Run 'smartclaws init' first.");
        process.exit(1);
    }
    return config;
}

export function loadWalletOrExit(config: Config): WalletFile {
    const wallet = loadWallet();
    if (!wallet) {
        console.error("No wallet found. Run 'smartclaws init' first.");
        process.exit(1);
    }
    assertHomeWallet(config, wallet);
    return wallet;
}

export function loadOptionalWalletOrExit(config: Config): WalletFile | undefined {
    const wallet = loadWallet() ?? undefined;
    if (wallet) assertHomeWallet(config, wallet);
    return wallet;
}
