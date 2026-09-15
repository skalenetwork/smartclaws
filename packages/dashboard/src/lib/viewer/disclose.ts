import {
    type Abi,
    type Address,
    BaseError,
    ContractFunctionRevertedError,
    type Hex,
    parseEventLogs,
    UserRejectedRequestError,
} from "viem";
import {
    getGasPrice,
    getPublicClient,
    readContract,
    simulateContract,
    waitForTransactionReceipt,
    writeContract,
} from "wagmi/actions";
import { abis } from "@/config/contracts";
import { chain, config } from "@/config/wagmi";
import { openDisclosure, sessionRecords } from "./session-records";

// A rejected request reverts on its first check, long before the BITE precompile. The limit
// is set by hand because gas estimation fails for a call that reverts, and the point of
// sending it is to leave the failed attempt on-chain.
const REJECTED_REQUEST_GAS = 200_000n;

// The SDK measured the CTX landing in the block after its origin. Poll for up to ~30s
// before handing the result over to the access log.
const CTX_POLL_ATTEMPTS = 20;
const CTX_POLL_DELAY_MS = 1_500;

// Errors a read can hit: the channel's own, plus the registry's, which reverts inside
// `requestMessages` when the reader has no key registered.
const revertAbi = [...abis.channelEncrypted, ...abis.publicKeyRegistry] as Abi;

const REVERT_REASONS: Record<string, string> = {
    ReaderNotAuthorized: "Not an authorised reader",
    PublicKeyNotRegistered: "No viewing key registered",
    MessagePruned: "Message is no longer stored",
    InvalidOffset: "Message does not exist",
    InsufficientCallbackFee: "Callback deposit too low",
};

export function describeRevert(errorName: string | undefined): string {
    if (!errorName) return "Transaction reverted";
    return REVERT_REASONS[errorName] ?? errorName;
}

export { revertAbi };

function revertName(error: unknown): string | undefined {
    if (!(error instanceof BaseError)) return undefined;
    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (!(reverted instanceof ContractFunctionRevertedError)) return undefined;
    return reverted.data?.errorName ?? reverted.reason ?? "reverted";
}

export function isUserRejection(error: unknown): boolean {
    return (
        error instanceof BaseError &&
        error.walk((cause) => cause instanceof UserRejectedRequestError) instanceof
            UserRejectedRequestError
    );
}

const HASH = /^(?:0x)?[0-9a-f]{64}$/i;

function collectHashes(value: unknown, into = new Set<Hex>()): Set<Hex> {
    if (typeof value === "string" && HASH.test(value)) {
        into.add(`0x${value.replace(/^0x/i, "").toLowerCase()}`);
    } else if (Array.isArray(value)) {
        for (const item of value) collectHashes(item, into);
    } else if (value && typeof value === "object") {
        for (const item of Object.values(value)) collectHashes(item, into);
    }
    return into;
}

type RawRequest = (args: { method: string; params: unknown[] }) => Promise<unknown>;

async function waitForCtx(origin: Hex): Promise<Hex[]> {
    const client = getPublicClient(config, { chainId: chain.id });
    if (!client) throw new Error(`No RPC client for ${chain.name}`);
    const request = client.request as unknown as RawRequest;
    for (let attempt = 0; attempt < CTX_POLL_ATTEMPTS; attempt += 1) {
        try {
            const hashes = collectHashes(
                await request({ method: "bite_getCraftedCtxs", params: [origin] }),
            );
            if (hashes.size > 0) return [...hashes];
        } catch (error) {
            // Only the node's "not crafted yet" answer is worth polling through.
            if (!/not found|not yet|unknown transaction/i.test(String(error))) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, CTX_POLL_DELAY_MS));
    }
    return [];
}

export type DiscloseStage = "confirm" | "requesting" | "decrypting";

export type DiscloseOutcome =
    | { status: "decrypted"; offset: number }
    | { status: "rejected"; reason: string; txHash: Hex }
    | { status: "callback-failed"; reason: string; txHash: Hex }
    /** The request landed but no CTX was seen in time; the access log will pick it up. */
    | { status: "pending"; txHash: Hex };

/**
 * Requests a disclosure of one message to `reader`, waits for the BITE callback, and opens
 * the result with this tab's viewing key.
 *
 * A request the contract will reject is still sent, with a fixed gas limit: the rejected
 * transaction is the on-chain proof that access was refused.
 */
export async function discloseMessage(params: {
    channel: Address;
    offset: number;
    /** Stored ciphertext length; the callback deposit is priced on it. */
    storedBytes: number;
    reader: Address;
    onStage: (stage: DiscloseStage) => void;
}): Promise<DiscloseOutcome> {
    const { channel, offset, storedBytes, reader, onStage } = params;

    // One gas price for both the deposit and the transaction: the contract checks
    // `msg.value >= callbackGas * tx.gasprice`, so a re-estimate could underfund it.
    const [gasPrice, callbackGas] = await Promise.all([
        getGasPrice(config, { chainId: chain.id }),
        readContract(config, {
            address: channel,
            abi: abis.channelEncrypted,
            functionName: "getReadCallbackGas",
            args: [BigInt(storedBytes), 1n],
            chainId: chain.id,
        }) as Promise<bigint>,
    ]);

    const request = {
        address: channel,
        abi: abis.channelEncrypted,
        functionName: "requestMessages",
        args: [BigInt(offset), 1n],
        value: callbackGas * gasPrice,
        gasPrice,
        chainId: chain.id,
        account: reader,
    } as const;

    let expectedRevert: string | undefined;
    let willRevert = false;
    try {
        await simulateContract(config, request);
    } catch (error) {
        willRevert = true;
        expectedRevert = revertName(error);
    }

    onStage("confirm");
    const txHash = await writeContract(config, {
        ...request,
        gas: willRevert ? REJECTED_REQUEST_GAS : undefined,
    });

    onStage("requesting");
    const receipt = await waitForTransactionReceipt(config, { hash: txHash, chainId: chain.id });
    if (receipt.status === "reverted") {
        const reason = describeRevert(expectedRevert);
        sessionRecords.addAttempt({
            txHash,
            channel,
            reader,
            offset,
            stage: "request",
            reason,
            blockNumber: receipt.blockNumber.toString(),
            timestamp: Math.floor(Date.now() / 1000),
        });
        return { status: "rejected", reason, txHash };
    }

    onStage("decrypting");
    const ctxHashes = await waitForCtx(txHash);
    if (ctxHashes.length === 0) return { status: "pending", txHash };

    const ctxReceipts = await Promise.all(
        ctxHashes.map((hash) => waitForTransactionReceipt(config, { hash, chainId: chain.id })),
    );
    const failed = ctxReceipts.find((ctx) => ctx.status === "reverted");
    if (failed) {
        // The request passed its checks but the callback re-checks them, so access revoked
        // in between lands here.
        const reason = "Callback reverted — access may have changed after the request";
        sessionRecords.addAttempt({
            txHash: failed.transactionHash,
            channel,
            reader,
            offset,
            stage: "callback",
            reason,
            blockNumber: failed.blockNumber.toString(),
            timestamp: Math.floor(Date.now() / 1000),
        });
        return { status: "callback-failed", reason, txHash: failed.transactionHash };
    }

    const disclosed = parseEventLogs({
        abi: abis.channelEncrypted,
        logs: ctxReceipts.flatMap((ctx) => ctx.logs),
        eventName: "MessageDisclosed",
    }).find((log) => {
        const args = log.args as { channel?: Address; reader?: Address; offset?: bigint };
        return (
            args.channel?.toLowerCase() === channel.toLowerCase() &&
            args.reader?.toLowerCase() === reader.toLowerCase() &&
            args.offset === BigInt(offset)
        );
    });
    if (!disclosed) {
        return {
            status: "callback-failed",
            reason: "The callback emitted no disclosure for this message",
            txHash: ctxReceipts[0].transactionHash,
        };
    }

    await openDisclosure({
        reader,
        channel,
        offset,
        payload: (disclosed.args as { encryptedPayload: Hex }).encryptedPayload,
        txHash: disclosed.transactionHash,
    });
    return { status: "decrypted", offset };
}
