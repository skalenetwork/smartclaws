/**
 * THROWAWAY DIAGNOSTIC — not part of deploy/verify.
 *
 * Measures the real cost of SmartClawsChannelEncrypted's BITE callbacks against a
 * live BITE-enabled chain, and checks the callback-gas constants read directly
 * from the deployed contract.
 *
 * Why this measures the truth: the callback gas *limit* handed to submitCTX is the
 * quoted value itself (`_submitCTX(..., getPublishCallbackGas(len))`) — msg.value only
 * has to *cover* it and cannot raise it. So:
 *   - CTX succeeds  -> ctxReceipt.gasUsed IS the exact cost; headroom = quoted - gasUsed.
 *   - CTX runs out  -> the constant is too low for that size (gasUsed pinned at the limit).
 * Both outcomes are informative, and no modified probe contract is needed.
 *
 * Experimental design (so each constant is isolated rather than co-fitted):
 *   Phase 1  publish a sweep of payload sizes        -> fit PUBLISH base + per-byte
 *   Phase 2  read count=1 at three different sizes   -> fit READ  base + per-byte
 *   Phase 3  read count=1..3 over equal-sized msgs   -> derive READ per-message
 *
 * It also checks that the refund queue remains armed after every successful callback.
 * Base testnet does not deposit callback-gas refunds yet, so a zero channel balance is
 * expected and is not treated as a failure. The contract settles (and pops) the prior
 * payer even at zero balance, then queues the current payer for a future protocol refund.
 *
 * Usage (needs ONE funded account):
 *   cd smart-contracts
 *   SKALE_RPC_URL=https://...  DEPLOYER_PRIVATE_KEY=0x... \
 *     npx hardhat run scripts/probe-encrypted-gas.ts --network baseTestnet
 *
 * Optional env:
 *   BITE_RPC_URL         BITE JSON-RPC endpoint         (default: SKALE_RPC_URL)
 *   PROBE_SIZES          publish payload sizes, bytes   (default: 1,64,256,1024,2048,4096)
 *   PROBE_READ_COUNTS    batch sizes for phase 3        (default: 1,2,3)
 *   PROBE_EQUAL_SIZE     payload size used in phase 3   (default: 256)
 *   PROBE_CAPACITY       channel capacity, bytes        (default: 16777216)
 *   PROBE_SKIP_READS     "1" to run phase 1 only
 *   PROBE_TIMEOUT_MS     per-CTX wait budget            (default: 180000)
 *   PROBE_MINE_TIMEOUT_MS  origin-receipt wait budget   (default: 120000)
 *   PROBE_TX_GAS_LIMIT   force an origin-tx gas limit   (default: estimate)
 *
 * Deletion is the expected end state: this file, and the @skalenetwork/bite devDependency
 * it needs, can both be dropped once the constants are settled.
 */

import { createDecipheriv, createECDH, createHash } from "node:crypto";
import { BITE } from "@skalenetwork/bite";
import { ethers as ethersLib } from "ethers";
import hre from "hardhat";

// --- Env / knobs ---

const numberList = (value: string | undefined, fallback: number[]): number[] =>
    value
        ? value
              .split(",")
              .map((entry) => Number(entry.trim()))
              .filter((entry) => Number.isSafeInteger(entry) && entry > 0)
        : fallback;

const RPC_URL = process.env.SKALE_RPC_URL ?? "";
const BITE_RPC_URL = process.env.BITE_RPC_URL ?? RPC_URL;
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const SIZES = numberList(process.env.PROBE_SIZES, [1, 64, 256, 1024, 2048, 4096]);
const READ_COUNTS = numberList(process.env.PROBE_READ_COUNTS, [1, 2, 3]);
const EQUAL_SIZE = Number(process.env.PROBE_EQUAL_SIZE ?? 256);
const CAPACITY = BigInt(process.env.PROBE_CAPACITY ?? 16 * 1024 * 1024);
const SKIP_READS = process.env.PROBE_SKIP_READS === "1";
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 180_000);
/**
 * Optional origin-tx gas limit. Left unset by default: estimation measured fine on
 * base-testnet (139,244 used against a 141,400 estimate). Set it only if a run shows
 * origin txs reverting or failing to mine.
 */
const TX_GAS_LIMIT = process.env.PROBE_TX_GAS_LIMIT
    ? BigInt(process.env.PROBE_TX_GAS_LIMIT)
    : undefined;
/** Hard cap on waiting for an origin receipt, so a stuck tx cannot hang the run. */
const MINE_TIMEOUT_MS = Number(process.env.PROBE_MINE_TIMEOUT_MS ?? 120_000);

// --- Small helpers ---

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Per-step progress. Every stage here can block on the network, so each one announces
 * itself — a silent stall is indistinguishable from a slow one otherwise.
 */
function step(message: string, since?: number): void {
    const elapsed = since === undefined ? "" : ` (${((Date.now() - since) / 1000).toFixed(1)}s)`;
    console.log(`      ${message}${elapsed}`);
}

function pct(part: bigint, whole: bigint): string {
    if (whole === 0n) return "n/a";
    return `${(Number((part * 10_000n) / whole) / 100).toFixed(1)}%`;
}

/** Least-squares fit of y = intercept + slope*x. */
function linearFit(points: { x: number; y: number }[]): { slope: number; intercept: number } {
    const n = points.length;
    if (n < 2) return { slope: Number.NaN, intercept: Number.NaN };
    const sumX = points.reduce((acc, p) => acc + p.x, 0);
    const sumY = points.reduce((acc, p) => acc + p.y, 0);
    const sumXY = points.reduce((acc, p) => acc + p.x * p.y, 0);
    const sumXX = points.reduce((acc, p) => acc + p.x * p.x, 0);
    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) return { slope: Number.NaN, intercept: Number.NaN };
    const slope = (n * sumXY - sumX * sumY) / denominator;
    return { slope, intercept: (sumY - slope * sumX) / n };
}

async function biteRpc(method: string, params: unknown[]): Promise<unknown> {
    const response = await fetch(BITE_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    });
    const { result, error } = (await response.json()) as {
        result?: unknown;
        error?: { message: string };
    };
    if (error) throw new Error(`${method}: ${error.message}`);
    return result;
}

/** "does not exist" just means the CTX has not been crafted yet; anything else is real. */
function isPendingCtxError(error: unknown): boolean {
    return /does not exist|not found/i.test((error as Error)?.message ?? "");
}

/**
 * `bite_getCraftedCtxs` returns a loosely-structured result, so scrape 32-byte hashes
 * out of whatever shape comes back rather than assuming a schema.
 *
 * Observed on skalenodes base-testnet: `{"result":["e8d1…562f"]}` — the hashes come back
 * WITHOUT a 0x prefix, so the prefix must be optional here and re-added afterwards.
 * The \b guards stop a 64-char window from being pulled out of a longer hex blob.
 */
function scrapeHashes(result: unknown): string[] {
    const matches = JSON.stringify(result ?? "").match(/\b(?:0x)?[0-9a-fA-F]{64}\b/g) ?? [];
    return [
        ...new Set(
            matches.map((hash) => (hash.startsWith("0x") ? hash : `0x${hash}`).toLowerCase()),
        ),
    ];
}

/** Wait for the CTX(s) an origin tx crafted, then for their receipts. */
async function resolveCtxReceipts(provider: any, originHash: string): Promise<any[]> {
    const deadline = Date.now() + TIMEOUT_MS;
    let hashes: string[] = [];

    while (Date.now() < deadline) {
        try {
            hashes = scrapeHashes(await biteRpc("bite_getCraftedCtxs", [originHash]));
        } catch (error) {
            // Only "not yet crafted" is retryable — a method/transport error should
            // surface immediately rather than burn the whole timeout in silence.
            if (!isPendingCtxError(error)) throw error;
        }
        if (hashes.length > 0) break;
        await sleep(1_000);
    }
    if (hashes.length === 0) {
        throw new Error(
            `no CTX crafted by ${originHash} within ${TIMEOUT_MS}ms ` +
                `(check: curl -s -X POST $SKALE_RPC_URL -d '{"jsonrpc":"2.0","method":"bite_getCraftedCtxs","params":["${originHash}"],"id":1}')`,
        );
    }

    const receipts: any[] = [];
    for (const hash of hashes) {
        let receipt = null;
        while (Date.now() < deadline && receipt === null) {
            receipt = await provider.getTransactionReceipt(hash);
            if (receipt === null) await sleep(1_000);
        }
        if (receipt === null) throw new Error(`no receipt for CTX ${hash} within ${TIMEOUT_MS}ms`);
        receipts.push(receipt);
    }
    return receipts;
}

function parseLogs(contract: any, receipt: any, name: string): any[] {
    return receipt.logs
        .map((log: any) => {
            try {
                return contract.interface.parseLog({ topics: [...log.topics], data: log.data });
            } catch {
                return null;
            }
        })
        .filter((parsed: any) => parsed?.name === name);
}

/** ECIES layout: IV(16) ‖ ephemeralPubKey(33) ‖ AES-256-CBC ciphertext, key = SHA-256(ECDH). */
function eciesDecrypt(privateKeyHex: string, encryptedHex: string): Uint8Array {
    const encrypted = Buffer.from(encryptedHex.replace(/^0x/, ""), "hex");
    const iv = encrypted.subarray(0, 16);
    const ephemeralPublicKey = encrypted.subarray(16, 49);
    const ciphertext = encrypted.subarray(49);

    const ecdh = createECDH("secp256k1");
    ecdh.setPrivateKey(Buffer.from(privateKeyHex.replace(/^0x/, ""), "hex"));
    const key = createHash("sha256").update(ecdh.computeSecret(ephemeralPublicKey)).digest();

    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    try {
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
        // Fall back to unpadded in case the on-chain side emits exact-block output.
        const raw = createDecipheriv("aes-256-cbc", key, iv);
        raw.setAutoPadding(false);
        return Buffer.concat([raw.update(ciphertext), raw.final()]);
    }
}

// --- Measurement records ---

interface PublishSample {
    payloadBytes: number;
    ciphertextBytes: number;
    quoted: bigint;
    gasUsed: bigint;
    ok: boolean;
    /** Channel offset the message landed at; -1 when the callback did not store it. */
    offset: number;
    note: string;
}

interface ReadSample {
    count: number;
    storedBytes: number;
    quoted: bigint;
    gasUsed: bigint;
    disclosed: number;
    ok: boolean;
    note: string;
}

interface RefundQueueObservation {
    label: string;
    ctxBlock: number;
    channelBalanceAfter: bigint;
    queuePending: boolean;
}

async function main() {
    if (!RPC_URL) throw new Error("SKALE_RPC_URL is required.");
    if (!PRIVATE_KEY) throw new Error("DEPLOYER_PRIVATE_KEY is required.");

    const { ethers } = await hre.network.create();
    const [deployer] = await ethers.getSigners();
    const provider = ethers.provider;
    const bite = new BITE(BITE_RPC_URL);

    // Informational only — each tx re-reads the gas price so the fee can't be
    // computed against a stale value.
    const initialGasPrice = (await provider.getFeeData()).gasPrice as bigint;
    if (!initialGasPrice) throw new Error("Could not read gasPrice from the network.");

    const totalTxs = SIZES.length + (SKIP_READS ? 0 : READ_COUNTS.length + 3 + READ_COUNTS.length);
    console.log("SmartClawsChannelEncrypted — callback gas probe");
    console.log(`  Account:    ${deployer.address}`);
    console.log(
        `  Balance:    ${ethersLib.formatEther(await provider.getBalance(deployer.address))}`,
    );
    console.log(`  Gas price:  ${initialGasPrice} wei`);
    console.log(`  Sizes:      ${SIZES.join(", ")} bytes`);
    console.log(
        `  Reads:      ${SKIP_READS ? "skipped" : READ_COUNTS.join(", ") + ` (equal size ${EQUAL_SIZE}B)`}`,
    );
    console.log(`  Roughly ${totalTxs} origin txs, each followed by one CTX.`);

    // Preflight: prove the BITE endpoint answers before spending anything.
    const committees = (await biteRpc("bite_getCommitteesInfo", [])) as { epochId: number }[];
    console.log(
        `  BITE:       ${BITE_RPC_URL === RPC_URL ? "same endpoint" : BITE_RPC_URL}, ` +
            `${committees.length} committee(s), epoch ${committees.map((c) => c.epochId).join("/")}\n`,
    );

    // --- Deploy an isolated channel ---
    // `registry_` only gates onlyOwnerOrRegistry, so the deployer stands in for it here.

    const publicKeyRegistry = await (await ethers.getContractFactory("PublicKeyRegistry")).deploy();
    await publicKeyRegistry.waitForDeployment();
    const publicKeyRegistryAddress = await publicKeyRegistry.getAddress();

    const channel = await (await ethers.getContractFactory("SmartClawsChannelEncrypted")).deploy(
        deployer.address,
        CAPACITY,
        deployer.address,
        publicKeyRegistryAddress,
    );
    await channel.waitForDeployment();
    const channelAddress = await channel.getAddress();
    const configured = {
        maxReadBatch: Number(await channel.MAX_READ_BATCH()),
        publishBase: await channel.PUBLISH_CALLBACK_BASE_GAS(),
        publishPerByte: await channel.PUBLISH_CALLBACK_GAS_PER_BYTE(),
        readBase: await channel.READ_CALLBACK_BASE_GAS(),
        readPerByte: await channel.READ_CALLBACK_GAS_PER_BYTE(),
        readPerMessage: await channel.READ_CALLBACK_GAS_PER_MESSAGE(),
    };

    console.log(`PublicKeyRegistry: ${publicKeyRegistryAddress}`);
    console.log(`Channel:           ${channelAddress}\n`);

    // --- Register the reader public key + reader authorization (needed for phases 2-3) ---

    if (!SKIP_READS) {
        const uncompressed = ethersLib.SigningKey.computePublicKey(PRIVATE_KEY, false);
        const publicKey = {
            x: `0x${uncompressed.slice(4, 68)}`,
            y: `0x${uncompressed.slice(68, 132)}`,
        };
        await (await publicKeyRegistry.registerPublicKey(publicKey)).wait();
        await (await channel.addReader(deployer.address)).wait();
        console.log(`Registered reader public key for ${deployer.address}\n`);
    }

    const abi = ethersLib.AbiCoder.defaultAbiCoder();
    let readVerified = false;
    const refundQueueLog: RefundQueueObservation[] = [];
    const executionErrors: string[] = [];

    /**
     * Observe the public refund-queue state after a callback. A successful callback
     * must leave its own payer queued regardless of whether the protocol deposited
     * any gas residue. Queue advancement at zero balance is covered by unit tests;
     * the public contract surface intentionally exposes only pending/not-pending.
     */
    async function observeRefundQueue(label: string, ctxReceipt: any): Promise<void> {
        try {
            const block = Number(ctxReceipt.blockNumber);
            const [channelBalance, queuePending] = await Promise.all([
                provider.getBalance(channelAddress, block),
                channel.hasToRefund({ blockTag: block }) as Promise<boolean>,
            ]);
            refundQueueLog.push({
                label,
                ctxBlock: block,
                channelBalanceAfter: channelBalance,
                queuePending,
            });
        } catch (error) {
            const message = `${label}: ${(error as Error).message}`;
            executionErrors.push(`refund queue observation ${message}`);
            console.log(`  [refund queue] could not measure: ${message}`);
        }
    }

    /** Encrypt `size` bytes bound to this channel and this publisher, then publish. */
    async function publish(size: number, label: string): Promise<PublishSample> {
        const payload = ethersLib.randomBytes(size);
        const plaintext = abi.encode(["address", "bytes"], [deployer.address, payload]);

        const encryptStart = Date.now();
        const ciphertext = await bite.encryptMessageForCTX(plaintext, channelAddress);
        const ciphertextBytes = ethersLib.getBytes(ciphertext).length;
        step(`encrypted -> ${ciphertextBytes}B ciphertext`, encryptStart);

        // Read the gas price per tx: the contract compares msg.value against
        // callbackGas * tx.gasprice, so a stale snapshot could underfund the fee.
        const gasPrice = (await provider.getFeeData()).gasPrice as bigint;
        const quoted = (await channel.getPublishCallbackGas(ciphertextBytes)) as bigint;
        const countBefore = (await channel.getMessageCount()) as bigint;
        step(`quoted ${quoted} gas, fee ${quoted * gasPrice} wei @ ${gasPrice}`);

        const sendStart = Date.now();
        const tx = await channel.publishMessage(ciphertext, {
            value: quoted * gasPrice,
            gasPrice,
            ...(TX_GAS_LIMIT ? { gasLimit: TX_GAS_LIMIT } : {}),
        });
        step(`origin tx ${tx.hash}`);
        const originReceipt = await tx.wait(1, MINE_TIMEOUT_MS);
        if (!originReceipt)
            throw new Error(`origin tx ${tx.hash} not mined in ${MINE_TIMEOUT_MS}ms`);
        step(`origin mined in block ${originReceipt.blockNumber}`, sendStart);

        const ctxStart = Date.now();
        const [ctxReceipt] = await resolveCtxReceipts(provider, originReceipt.hash);
        step(`ctx ${ctxReceipt.hash} in block ${ctxReceipt.blockNumber}`, ctxStart);
        await observeRefundQueue(label, ctxReceipt);

        const countAfter = (await channel.getMessageCount()) as bigint;
        const stored = countAfter > countBefore;
        const gasUsed = ctxReceipt.gasUsed as bigint;
        const pinned = gasUsed >= (quoted * 995n) / 1000n;

        return {
            payloadBytes: size,
            ciphertextBytes,
            quoted,
            gasUsed,
            ok: stored && ctxReceipt.status === 1,
            // No pruning at these capacities, so startOffset stays 0 and the
            // pre-publish count is the offset the message landed at.
            offset: stored ? Number(countBefore) : -1,
            note: stored
                ? ""
                : pinned
                  ? "OUT OF GAS at the quoted limit — constant too low"
                  : `callback failed (status ${ctxReceipt.status})`,
        };
    }

    /** Disclose `count` messages from `fromOffset` and measure the read callback. */
    async function read(fromOffset: number, count: number, label: string): Promise<ReadSample> {
        const [payloads] = (await channel.readMessages(fromOffset, count)) as [string[], bigint[]];
        const storedBytes = payloads.reduce(
            (total, payload) => total + ethersLib.getBytes(payload).length,
            0,
        );

        const gasPrice = (await provider.getFeeData()).gasPrice as bigint;
        const quoted = (await channel.getReadCallbackGas(storedBytes, count)) as bigint;
        step(`${count} msg(s), ${storedBytes}B stored, quoted ${quoted} gas`);

        const sendStart = Date.now();
        const tx = await channel.requestMessages(fromOffset, count, {
            value: quoted * gasPrice,
            gasPrice,
            ...(TX_GAS_LIMIT ? { gasLimit: TX_GAS_LIMIT } : {}),
        });
        step(`origin tx ${tx.hash}`);
        const originReceipt = await tx.wait(1, MINE_TIMEOUT_MS);
        if (!originReceipt)
            throw new Error(`origin tx ${tx.hash} not mined in ${MINE_TIMEOUT_MS}ms`);
        step(`origin mined in block ${originReceipt.blockNumber}`, sendStart);

        const ctxStart = Date.now();
        const [ctxReceipt] = await resolveCtxReceipts(provider, originReceipt.hash);
        step(`ctx ${ctxReceipt.hash} in block ${ctxReceipt.blockNumber}`, ctxStart);
        await observeRefundQueue(label, ctxReceipt);

        const disclosures = parseLogs(channel, ctxReceipt, "MessageDisclosed");
        const gasUsed = ctxReceipt.gasUsed as bigint;
        const pinned = gasUsed >= (quoted * 995n) / 1000n;

        // Prove the disclosure is actually usable, once.
        if (disclosures.length > 0 && !readVerified) {
            try {
                const plain = eciesDecrypt(PRIVATE_KEY, disclosures[0].args.encryptedPayload);
                console.log(`  [ecies] round-trip OK — recovered ${plain.length} plaintext bytes`);
                readVerified = true;
            } catch (error) {
                console.log(`  [ecies] decrypt FAILED: ${(error as Error).message}`);
            }
        }

        return {
            count,
            storedBytes,
            quoted,
            gasUsed,
            disclosed: disclosures.length,
            ok: disclosures.length === count && ctxReceipt.status === 1,
            note:
                disclosures.length === count
                    ? ""
                    : pinned
                      ? "OUT OF GAS at the quoted limit — constant too low"
                      : `disclosed ${disclosures.length}/${count} (status ${ctxReceipt.status})`,
        };
    }

    // --- Phase 1: publish sweep ---

    console.log("Phase 1 — publish sweep");
    const publishSamples: PublishSample[] = [];
    for (const size of SIZES) {
        console.log(`  ${size}B payload`);
        try {
            const sample = await publish(size, `publish ${size}B`);
            publishSamples.push(sample);
            console.log(
                `    -> quoted=${sample.quoted} used=${sample.gasUsed} ` +
                    `headroom=${pct(sample.quoted - sample.gasUsed, sample.quoted)} ` +
                    `${sample.ok ? "STORED" : `FAIL (${sample.note})`}`,
            );
        } catch (error) {
            const message = (error as Error).message;
            executionErrors.push(`publish ${size}B: ${message}`);
            console.log(`    -> ERROR: ${message}`);
        }
    }

    const readSamplesBySize: ReadSample[] = [];
    const readSamplesByCount: ReadSample[] = [];

    if (!SKIP_READS && publishSamples.length > 0) {
        // --- Phase 2: vary bytes at count=1 -> READ base + per-byte ---

        // Only stored messages have an offset — a failed publish shifts everything
        // after it, so drive this off the recorded offsets rather than the loop index.
        console.log("\nPhase 2 — read, count=1, varying size");
        for (const stored of publishSamples.filter((sample) => sample.ok)) {
            console.log(`  offset ${stored.offset} (${stored.payloadBytes}B payload)`);
            try {
                const sample = await read(stored.offset, 1, `read 1x${stored.payloadBytes}B`);
                readSamplesBySize.push(sample);
                console.log(
                    `    -> quoted=${sample.quoted} used=${sample.gasUsed} ` +
                        `headroom=${pct(sample.quoted - sample.gasUsed, sample.quoted)} ` +
                        `${sample.ok ? "DISCLOSED" : `FAIL (${sample.note})`}`,
                );
            } catch (error) {
                const message = (error as Error).message;
                executionErrors.push(`read 1x${stored.payloadBytes}B: ${message}`);
                console.log(`    -> ERROR: ${message}`);
            }
        }

        // --- Phase 3: equal-sized messages, varying count -> READ per-message ---
        // Equal sizes keep the per-byte term proportional to count, so the slope over
        // count isolates perMessage once perByte is known from phase 2.

        const maxCount = Math.min(Math.max(...READ_COUNTS), configured.maxReadBatch);
        console.log(`\nPhase 3 — publishing ${maxCount} equal ${EQUAL_SIZE}B messages`);
        const equalOffsets: number[] = [];
        for (let i = 0; i < maxCount; i += 1) {
            console.log(`  equal message ${i + 1}/${maxCount}`);
            try {
                const sample = await publish(EQUAL_SIZE, `publish equal ${EQUAL_SIZE}B`);
                if (sample.ok) equalOffsets.push(sample.offset);
                console.log(`    -> ${sample.ok ? "STORED" : `FAIL (${sample.note})`}`);
            } catch (error) {
                const message = (error as Error).message;
                executionErrors.push(`publish equal ${EQUAL_SIZE}B: ${message}`);
                console.log(`    -> ERROR: ${message}`);
            }
        }

        // requestMessages needs a contiguous run, so stop at the first gap.
        let contiguous = 0;
        while (
            contiguous < equalOffsets.length &&
            equalOffsets[contiguous] === equalOffsets[0] + contiguous
        ) {
            contiguous += 1;
        }

        console.log("\nPhase 3 — read, varying count");
        for (const count of READ_COUNTS) {
            if (count > configured.maxReadBatch) {
                console.log(
                    `  count=${count} skipped (MAX_READ_BATCH=${configured.maxReadBatch})`,
                );
                continue;
            }
            if (count > contiguous) {
                console.log(
                    `  count=${count} skipped (only ${contiguous} contiguous equal messages)`,
                );
                continue;
            }
            console.log(`  count ${count}`);
            try {
                const sample = await read(equalOffsets[0], count, `read ${count}x${EQUAL_SIZE}B`);
                readSamplesByCount.push(sample);
                console.log(
                    `    -> quoted=${sample.quoted} used=${sample.gasUsed} ` +
                        `headroom=${pct(sample.quoted - sample.gasUsed, sample.quoted)} ` +
                        `${sample.ok ? "DISCLOSED" : `FAIL (${sample.note})`}`,
                );
            } catch (error) {
                const message = (error as Error).message;
                executionErrors.push(`read ${count}x${EQUAL_SIZE}B: ${message}`);
                console.log(`    -> ERROR: ${message}`);
            }
        }
    }

    // --- Verdict ---

    console.log(`\n${"=".repeat(78)}`);
    console.log("MEASURED vs CONFIGURED");
    console.log("=".repeat(78));

    const okPublish = publishSamples.filter((sample) => sample.ok);
    if (okPublish.length >= 2) {
        const fit = linearFit(
            okPublish.map((sample) => ({ x: sample.ciphertextBytes, y: Number(sample.gasUsed) })),
        );
        console.log("\nPUBLISH  (gas = base + perByte * submitted ciphertext bytes)");
        console.log(
            `  configured   base=${configured.publishBase}   perByte=${configured.publishPerByte}`,
        );
        console.log(
            `  measured     base=${fit.intercept.toFixed(0)}   perByte=${fit.slope.toFixed(1)}`,
        );
        const worst = okPublish.reduce((acc, s) =>
            ((s.quoted - s.gasUsed) * 1000n) / s.quoted <
            ((acc.quoted - acc.gasUsed) * 1000n) / acc.quoted
                ? s
                : acc,
        );
        console.log(
            `  tightest headroom  ${pct(worst.quoted - worst.gasUsed, worst.quoted)} ` +
                `at ${worst.payloadBytes}B payload (${worst.ciphertextBytes}B ciphertext)`,
        );
    } else {
        console.log("\nPUBLISH  not enough successful samples to fit.");
    }

    if (readSamplesBySize.filter((sample) => sample.ok).length >= 2) {
        const okBySize = readSamplesBySize.filter((sample) => sample.ok);
        const fit = linearFit(okBySize.map((s) => ({ x: s.storedBytes, y: Number(s.gasUsed) })));
        console.log("\nREAD  (gas = base + perByte * stored bytes + perMessage * count)");
        console.log(
            `  configured   base=${configured.readBase}   perByte=${configured.readPerByte}   perMessage=${configured.readPerMessage}`,
        );
        // At count=1 the intercept absorbs perMessage, so it is base+perMessage —
        // not base. Phase 3 separates them.
        console.log(
            `  measured     perByte=${fit.slope.toFixed(1)}   base+perMessage=${fit.intercept.toFixed(0)}`,
        );

        const okByCount = readSamplesByCount.filter((sample) => sample.ok);
        if (okByCount.length >= 2) {
            const countFit = linearFit(
                okByCount.map((s) => ({ x: s.count, y: Number(s.gasUsed) })),
            );
            const perMessageBytes = okByCount[0].storedBytes / okByCount[0].count;
            const perMessage = countFit.slope - fit.slope * perMessageBytes;
            console.log(
                `  measured     perMessage=${perMessage.toFixed(0)}   base=${(fit.intercept - perMessage).toFixed(0)}`,
            );
            console.log(
                `               (count slope ${countFit.slope.toFixed(0)} minus ` +
                    `${fit.slope.toFixed(1)}/B * ${perMessageBytes.toFixed(0)}B per message)`,
            );
        } else {
            console.log(
                "  perMessage/base: not enough successful varying-count samples to separate.",
            );
        }
    } else {
        console.log("\nREAD  not enough successful samples to fit.");
    }

    // --- Refund queue ---

    console.log("\nREFUND QUEUE  (protocol refunds are not expected on base testnet yet)");
    const missingQueue = refundQueueLog.filter((entry) => !entry.queuePending);
    if (refundQueueLog.length === 0) {
        console.log("  no CTX blocks were measured.");
    } else {
        console.log("   #  callback                 ctx block   channel balance after   queued");
        refundQueueLog.forEach((entry, index) => {
            console.log(
                `  ${String(index + 1).padStart(2)}  ${entry.label.padEnd(22)} ` +
                    `${String(entry.ctxBlock).padStart(9)}   ` +
                    `${String(entry.channelBalanceAfter).padStart(20)}   ${entry.queuePending ? "Y" : "N"}`,
            );
        });

        if (missingQueue.length === 0) {
            console.log("\n  PASS: a refund recipient remained pending after every callback.");
        } else {
            console.log(
                `\n  FAIL: ${missingQueue.length} callback(s) left no refund recipient queued.`,
            );
        }

        const observedBalance = refundQueueLog.some((entry) => entry.channelBalanceAfter > 0n);
        if (observedBalance) {
            console.log(
                "  INFO: a non-zero channel balance was observed; protocol refunds may now be live\n" +
                    "        or the channel may have received funds from another source.",
            );
        } else {
            console.log(
                "  INFO: no protocol refund was observed, as expected on current base testnet.",
            );
        }
    }

    const failures = [...publishSamples, ...readSamplesBySize, ...readSamplesByCount].filter(
        (sample) => !sample.ok,
    );
    console.log(`\n${"=".repeat(78)}`);
    const allSucceeded =
        failures.length === 0 && executionErrors.length === 0 && missingQueue.length === 0;
    if (allSucceeded) {
        console.log("VERDICT: every callback fit inside its quoted gas. Constants are adequate");
        console.log("         for the sizes tested — check the headroom above for overcharging.");
    } else {
        console.log("VERDICT: the probe encountered failures:");
        for (const failure of failures) console.log(`  - ${failure.note}`);
        for (const error of executionErrors) console.log(`  - ${error}`);
        for (const entry of missingQueue) {
            console.log(`  - ${entry.label}: no refund recipient remained queued`);
        }
    }
    console.log(`Channel left deployed at ${channelAddress} for follow-up inspection.`);
    if (!allSucceeded) throw new Error("Probe did not complete successfully.");
    console.log("ALL succeeded");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
