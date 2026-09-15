import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { type Address, BaseError, type Hex } from "viem";
import { useAccount, useReadContract, useReadContracts, useSignMessage } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { abis } from "@/config/contracts";
import { chain, config, registryAddress } from "@/config/wagmi";
import {
    type DiscloseStage,
    describeRevert,
    discloseMessage,
    isUserRejection,
} from "@/lib/viewer/disclose";
import { sessionRecords } from "@/lib/viewer/session-records";
import { samePublicKey, viewKey, viewKeyMessage } from "@/lib/viewer/view-key";

export type ViewKeyStatus =
    | "disconnected"
    | "wrong-chain"
    /** Connected, but this tab has not derived a key yet. */
    | "locked"
    | "checking"
    /** Key derived, nothing registered on-chain. */
    | "unregistered"
    /** Key derived, but the registry holds a different one. */
    | "mismatch"
    | "ready";

function errorMessage(error: unknown): string {
    if (error instanceof BaseError) return error.shortMessage;
    return error instanceof Error ? error.message : String(error);
}

/**
 * The connected wallet's viewing-key lifecycle: derive it by signing, register its public
 * half, and report whether the registry agrees with what this tab holds.
 */
export function useViewKey() {
    const { address, chainId, isConnected } = useAccount();
    const snapshot = useSyncExternalStore(viewKey.subscribe, viewKey.getSnapshot);
    const key =
        snapshot && address && snapshot.owner.toLowerCase() === address.toLowerCase()
            ? snapshot
            : null;
    const [busy, setBusy] = useState<"signing" | "registering" | null>(null);
    const { signMessageAsync } = useSignMessage();

    const { data: keyRegistry } = useReadContract({
        address: registryAddress,
        abi: abis.registry,
        functionName: "publicKeyRegistry",
        chainId: chain.id,
        query: { staleTime: Number.POSITIVE_INFINITY },
    });
    const registry = keyRegistry as Address | undefined;

    const { data: registered, refetch } = useReadContracts({
        contracts: [
            {
                address: registry,
                abi: abis.publicKeyRegistry,
                functionName: "hasPublicKey",
                args: [address],
                chainId: chain.id,
            },
            {
                address: registry,
                abi: abis.publicKeyRegistry,
                functionName: "getPublicKey",
                args: [address],
                chainId: chain.id,
            },
        ],
        query: { enabled: !!address && !!registry, staleTime: 15_000 },
    });
    const hasRegisteredKey = registered?.[0]?.result as boolean | undefined;
    const registeredKey = registered?.[1]?.result as { x: Hex; y: Hex } | undefined;

    let status: ViewKeyStatus;
    if (!isConnected || !address) status = "disconnected";
    else if (chainId !== chain.id) status = "wrong-chain";
    else if (!key) status = "locked";
    else if (hasRegisteredKey === undefined) status = "checking";
    else if (!hasRegisteredKey) status = "unregistered";
    else if (registeredKey && samePublicKey(registeredKey, key.publicKey)) status = "ready";
    else status = "mismatch";

    const unlock = useCallback(async () => {
        if (!address || !registry) return;
        setBusy("signing");
        try {
            const signature = await signMessageAsync({
                message: viewKeyMessage({ owner: address, chainId: chain.id, registry }),
            });
            await viewKey.adopt(address, signature);
        } catch (error) {
            if (!isUserRejection(error)) {
                toast.error("Could not create the viewing key", {
                    description: errorMessage(error),
                });
            }
        } finally {
            setBusy(null);
        }
    }, [address, registry, signMessageAsync]);

    const register = useCallback(async () => {
        if (!key || !registry) return;
        setBusy("registering");
        try {
            const hash = await writeContract(config, {
                address: registry,
                abi: abis.publicKeyRegistry,
                functionName: "registerPublicKey",
                args: [key.publicKey],
                chainId: chain.id,
            });
            const receipt = await waitForTransactionReceipt(config, { hash, chainId: chain.id });
            if (receipt.status === "reverted") throw new Error("Registration reverted");
            await refetch();
            toast.success("Viewing key registered");
        } catch (error) {
            if (!isUserRejection(error)) {
                toast.error("Could not register the viewing key", {
                    description: errorMessage(error),
                });
            }
        } finally {
            setBusy(null);
        }
    }, [key, registry, refetch]);

    return {
        status,
        busy,
        /** Whether the registry holds any key for this wallet, whether or not it is this tab's. */
        hasRegisteredKey,
        unlock,
        register,
    };
}

/** Keeps the key and records for the connected wallet loaded; mount once, near the root. */
export function useRestoreViewer() {
    const { address } = useAccount();
    useEffect(() => {
        if (!address) return;
        void viewKey.restore(address);
        void sessionRecords.load(address);
    }, [address]);
}

export function useSessionRecords(reader: Address | undefined) {
    return useSyncExternalStore(sessionRecords.subscribe, () => sessionRecords.get(reader));
}

/**
 * Per-channel disclose action. Tracks which offsets are in flight and turns each outcome
 * into a toast; the access log is refreshed afterwards so the new row shows at once.
 */
export function useDisclose(channel: Address) {
    const { address: reader } = useAccount();
    const { status } = useViewKey();
    const queryClient = useQueryClient();
    const [stages, setStages] = useState<Record<number, DiscloseStage>>({});

    const setStage = useCallback((offset: number, stage: DiscloseStage | null) => {
        setStages((current) => {
            const next = { ...current };
            if (stage) next[offset] = stage;
            else delete next[offset];
            return next;
        });
    }, []);

    const disclose = useCallback(
        async (offset: number, storedBytes: number) => {
            if (!reader || status === "disconnected") {
                toast("Connect a wallet to request a disclosure", {
                    description: "Use the Connect wallet button in the header.",
                });
                return;
            }
            if (status === "wrong-chain") {
                toast.error(`Switch your wallet to ${chain.name}`);
                return;
            }
            if (status !== "ready") {
                toast("Set up your viewing key first", {
                    description: "Open the wallet menu in the header.",
                });
                return;
            }

            setStage(offset, "confirm");
            try {
                const outcome = await discloseMessage({
                    channel,
                    offset,
                    storedBytes,
                    reader,
                    onStage: (stage) => setStage(offset, stage),
                });
                if (outcome.status === "decrypted") {
                    toast.success(`Message #${offset} decrypted`, {
                        description: "Readable in this tab only.",
                    });
                } else if (outcome.status === "pending") {
                    toast("Disclosure requested", {
                        description:
                            "The callback has not landed yet. It decrypts once the access log sees it.",
                    });
                } else {
                    toast.error(
                        outcome.status === "rejected"
                            ? "Disclosure rejected"
                            : "Disclosure callback failed",
                        {
                            description: `${outcome.reason}. The failed attempt is recorded on-chain.`,
                        },
                    );
                }
            } catch (error) {
                if (isUserRejection(error)) toast("Request cancelled");
                else {
                    toast.error("Disclosure failed", {
                        description: describeRevertOrMessage(error),
                    });
                }
            } finally {
                setStage(offset, null);
                const channelKey = channel.toLowerCase();
                void queryClient.invalidateQueries({
                    queryKey: ["disclosure-log", chain.id, channelKey],
                });
                void queryClient.invalidateQueries({
                    queryKey: ["failed-read-attempts", chain.id, channelKey],
                });
            }
        },
        [channel, reader, status, queryClient, setStage],
    );

    return { disclose, stages };
}

function describeRevertOrMessage(error: unknown): string {
    const message = errorMessage(error);
    const match = /reverted with the following reason:\s*(\w+)/i.exec(message);
    return match ? describeRevert(match[1]) : message;
}
