import { explorerUrl } from "@/config/wagmi";

export function getExplorerAddressUrl(address: string): string | null {
    if (!explorerUrl) return null;
    return `${explorerUrl}/address/${address}`;
}

export function getExplorerTxUrl(txHash: string): string | null {
    if (!explorerUrl) return null;
    return `${explorerUrl}/tx/${txHash}`;
}
