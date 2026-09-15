import { explorerUrl } from "@/config/wagmi";

/** GET against the block explorer's (Blockscout) v2 API, which allows cross-origin reads. */
export async function fetchExplorer<T>(path: string): Promise<T> {
    if (!explorerUrl) throw new Error("No block explorer configured for this network");
    const response = await fetch(`${explorerUrl}/api/v2${path}`);
    if (!response.ok) throw new Error(`Explorer responded ${response.status}`);
    return (await response.json()) as T;
}
