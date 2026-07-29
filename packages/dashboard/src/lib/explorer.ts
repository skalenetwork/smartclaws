import { explorerUrl } from "@/config/wagmi";

export function getExplorerAddressUrl(address: string): string | null {
    if (!explorerUrl) return null;
    return `${explorerUrl}/address/${address}`;
}
