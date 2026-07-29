import {
    assertHomeWallet,
    type Config,
    loadConfig,
    loadWallet,
    type WalletFile,
} from "@smartclaws/sdk";

export function loadConfigOrExit(): Config {
    const config = loadConfig();
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
