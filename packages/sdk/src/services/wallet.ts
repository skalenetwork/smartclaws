import { NETWORKS } from "@smartclaws/core/networks";
import type { Config, WalletFile } from "@smartclaws/core/types";
import { type Address, formatEther } from "viem";
import { createClient } from "../client.js";
import { SmartClawsError } from "../errors.js";

export interface WalletInfo {
    address: string;
    /** Balance in wei, as a decimal string (JSON-safe; bigint is not). */
    balanceWei: string;
    /** Balance formatted in the native currency. */
    balance: string;
    symbol: string;
}

/**
 * Return the configured wallet's address and on-chain balance. Read-only: the
 * private key is never read for signing and never returned. Throws
 * `SmartClawsError` with code `NO_RPC` if no RPC is configured, or
 * `BALANCE_FETCH_FAILED` if the balance lookup fails.
 */
export async function getWalletInfo(config: Config, wallet: WalletFile): Promise<WalletInfo> {
    if (!config.rpcUrl) {
        throw new SmartClawsError("NO_RPC", "No RPC URL configured.", { address: wallet.address });
    }

    const symbol = NETWORKS[config.network]?.nativeCurrency.symbol ?? "sFUEL";

    try {
        const client = createClient(config);
        const balance = await client.getBalance({ address: wallet.address as Address });
        return {
            address: wallet.address,
            balanceWei: balance.toString(),
            balance: formatEther(balance),
            symbol,
        };
    } catch (e: unknown) {
        throw new SmartClawsError("BALANCE_FETCH_FAILED", (e as Error).message, {
            address: wallet.address,
        });
    }
}
