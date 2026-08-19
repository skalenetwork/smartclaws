import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HardhatError } from "@nomicfoundation/hardhat-errors";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import type { CompilerInput } from "hardhat/types/solidity";

const HARDHAT_VERIFY_INTERNAL = join(
    dirname(fileURLToPath(import.meta.url)),
    "../node_modules/@nomicfoundation/hardhat-verify/dist/src/internal",
);

const { createVerificationProviderInstance } = await import(
    join(HARDHAT_VERIFY_INTERNAL, "verification.js")
);
const { Bytecode } = await import(join(HARDHAT_VERIFY_INTERNAL, "bytecode.js"));
const { ContractInformationResolver } = await import(join(HARDHAT_VERIFY_INTERNAL, "contract.js"));
const { encodeConstructorArgs } = await import(join(HARDHAT_VERIFY_INTERNAL, "constructor-args.js"));
const { resolveLibraryInformation } = await import(join(HARDHAT_VERIFY_INTERNAL, "libraries.js"));
const { filterVersionsByRange, resolveSupportedSolcVersions } = await import(
    join(HARDHAT_VERIFY_INTERNAL, "solc-versions.js"),
);

type VerificationProvider = {
    name: string;
    url: string;
    apiUrl: string;
    getContractUrl(address: string): string;
    isVerified(address: string): Promise<boolean>;
    verify(args: {
        contractAddress: string;
        compilerInput: CompilerInput;
        contractName: string;
        compilerVersion: string;
        constructorArguments: string;
    }): Promise<string>;
};

type ContractInformation = {
    compilerInput: CompilerInput;
    solcLongVersion: string;
    sourceName: string;
    userFqn: string;
    inputFqn: string;
    compilerOutputContract: { abi: unknown };
};

export interface VerificationTarget {
    address: string;
    constructorArgs: unknown[];
    contract: string;
    label: string;
    force?: boolean;
}

const SUBMIT_STAGGER_MS = 1000;
const HTTP_TIMEOUT_MS = 20 * 1000;
const INDEX_POLL_INTERVAL_MS = 2 * 1000;
const INDEX_TIMEOUT_MS = 20 * 1000;
const INDEX_SETTLE_MS = 2 * 1000;
const VERIFICATION_POLL_TIMEOUT_MS = 5 * 60 * 1000;
const VERIFICATION_POLL_INTERVAL_MS = 3 * 1000;

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

type VerificationItemStatus = "pending" | "indexing" | "waiting" | "done" | "failed" | "unconfirmed";

class VerificationProgress {
    private readonly statuses: VerificationItemStatus[];
    private lineCount = 0;
    private readonly interactive: boolean;
    private renderMutex = Promise.resolve();

    constructor(private readonly labels: readonly string[]) {
        this.statuses = labels.map(() => "pending");
        this.interactive = Boolean(process.stdout.isTTY);
    }

    private icon(status: VerificationItemStatus): string {
        switch (status) {
            case "done":
                return `${GREEN}✓${RESET}`;
            case "indexing":
                return `${YELLOW}◌${RESET}`;
            case "waiting":
                return `${YELLOW}…${RESET}`;
            case "failed":
                return `${RED}✗${RESET}`;
            case "unconfirmed":
                return `${YELLOW}?${RESET}`;
            default:
                return `${DIM}○${RESET}`;
        }
    }

    private buildLines(): string[] {
        const done = this.statuses.filter((status) => status === "done").length;
        const waiting = this.statuses.filter(
            (status) => status === "waiting" || status === "indexing" || status === "unconfirmed",
        ).length;
        const header = `Verifying on Blockscout (confirmed ${done}/${this.labels.length}, in flight ${waiting})`;
        return [
            header,
            ...this.labels.map((label, index) => `  ${this.icon(this.statuses[index])} ${label}`),
        ];
    }

    private renderNow(): void {
        const lines = this.buildLines();
        if (!this.interactive) {
            return;
        }

        if (this.lineCount > 0) {
            process.stdout.write(`\x1b[${this.lineCount}A`);
        }
        for (const line of lines) {
            process.stdout.write(`\x1b[2K${line}\n`);
        }
        this.lineCount = lines.length;
    }

    private scheduleRender(): void {
        this.renderMutex = this.renderMutex.then(() => {
            this.renderNow();
        });
    }

    start(): void {
        if (this.interactive) {
            process.stdout.write("\x1b[?25l");
        } else {
            console.log(`Verifying ${this.labels.length} contracts on Blockscout...`);
        }
        this.scheduleRender();
    }

    setIndexing(index: number): void {
        this.statuses[index] = "indexing";
        this.scheduleRender();
    }

    setWaiting(index: number): void {
        this.statuses[index] = "waiting";
        this.scheduleRender();
    }

    setDone(index: number): void {
        this.statuses[index] = "done";
        if (this.interactive) {
            this.scheduleRender();
            return;
        }

        const done = this.statuses.filter((status) => status === "done").length;
        console.log(`  ✓ ${this.labels[index]} (${done}/${this.labels.length})`);
    }

    setFailed(index: number): void {
        this.statuses[index] = "failed";
        this.scheduleRender();
    }

    setUnconfirmed(index: number): void {
        this.statuses[index] = "unconfirmed";
        this.scheduleRender();
    }

    async finish(): Promise<void> {
        await this.renderMutex;
        if (!this.interactive) {
            return;
        }

        process.stdout.write("\x1b[?25h\n");
    }
}

interface BlockscoutStatusResponse {
    status: string;
    result: string;
}

type PollOutcome = "success" | "failure" | "timeout";

async function delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

interface BlockscoutAddressResponse {
    is_contract?: boolean;
    is_verified?: boolean;
}

async function isIndexedAsContract(explorerUrl: string, address: string): Promise<boolean> {
    const url = `${explorerUrl.replace(/\/$/, "")}/api/v2/addresses/${address}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!response.ok) {
        return false;
    }

    const body = (await response.json()) as BlockscoutAddressResponse;
    return body.is_contract === true;
}

async function warmExplorerAddressPage(explorerUrl: string, address: string): Promise<void> {
    const url = `${explorerUrl.replace(/\/$/, "")}/address/${address}`;
    try {
        await fetch(url, {
            signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
            headers: { Accept: "text/html" },
        });
    } catch {
        // Warming is best-effort; indexing may still happen via the API poll.
    }
}

async function waitUntilIndexedAsContract(
    explorerUrl: string,
    address: string,
): Promise<boolean> {
    await warmExplorerAddressPage(explorerUrl, address);
    const deadline = Date.now() + INDEX_TIMEOUT_MS;

    while (Date.now() < deadline) {
        try {
            if (await isIndexedAsContract(explorerUrl, address)) {
                await delay(INDEX_SETTLE_MS);
                return true;
            }
        } catch {
            // Explorer not ready yet; keep polling until the deadline.
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            break;
        }
        await delay(Math.min(INDEX_POLL_INTERVAL_MS, remaining));
    }

    return false;
}

async function hasOnChainCode(hre: HardhatRuntimeEnvironment, address: string): Promise<boolean> {
    const connection = await hre.network.connect();
    const code = await connection.provider.request({
        method: "eth_getCode",
        params: [address, "latest"],
    });
    return typeof code === "string" && code !== "0x" && code !== "0x0";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
    }
}

async function checkVerificationStatus(
    apiUrl: string,
    guid: string,
): Promise<PollOutcome | "pending"> {
    const url = new URL(apiUrl);
    url.searchParams.set("module", "contract");
    url.searchParams.set("action", "checkverifystatus");
    url.searchParams.set("guid", guid);

    const response = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    const body = (await response.json()) as BlockscoutStatusResponse;
    const result = String(body.result ?? "");

    if (result === "Pending in queue") {
        return "pending";
    }
    if (result === "Pass - Verified" || result.toLowerCase().includes("already verified")) {
        return "success";
    }
    if (result === "Fail - Unable to verify") {
        return "failure";
    }

    return Number(body.status) === 1 ? "success" : "failure";
}

async function pollVerificationGuid(provider: VerificationProvider, guid: string): Promise<PollOutcome> {
    const deadline = Date.now() + VERIFICATION_POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
        try {
            const status = await checkVerificationStatus(provider.apiUrl, guid);
            if (status === "success" || status === "failure") {
                return status;
            }
        } catch {
            // Transient explorer/network errors: keep polling until the deadline.
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            break;
        }
        await delay(Math.min(VERIFICATION_POLL_INTERVAL_MS, remaining));
    }

    return "timeout";
}

function isAlreadyVerifiedError(error: unknown): boolean {
    if (
        HardhatError.isHardhatError(
            error,
            HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL.CONTRACT_ALREADY_VERIFIED,
        )
    ) {
        return true;
    }

    const message = error instanceof Error ? error.message : String(error);
    return /already verified/i.test(message);
}

async function createBlockscoutProvider(
    hre: HardhatRuntimeEnvironment,
): Promise<{ provider: VerificationProvider; networkName: string }> {
    const { config, network } = hre;
    const connection = await network.connect();
    const { networkName, provider: chainProvider } = connection;

    const verificationProvider = (await createVerificationProviderInstance({
        provider: chainProvider,
        networkName,
        chainDescriptors: config.chainDescriptors,
        verificationProviderName: "blockscout",
        verificationProvidersConfig: config.verify,
    })) as VerificationProvider;

    return { provider: verificationProvider, networkName };
}

async function resolveVerificationContext(
    hre: HardhatRuntimeEnvironment,
    verificationProvider: VerificationProvider,
    target: VerificationTarget,
    networkName: string,
    buildProfileName: string,
) {
    const { artifacts, config, network } = hre;
    const buildProfile = config.solidity.profiles[buildProfileName];
    if (buildProfile === undefined) {
        throw new Error(`Build profile '${buildProfileName}' not found`);
    }

    if (
        !target.force &&
        (await withTimeout(
            verificationProvider.isVerified(target.address),
            HTTP_TIMEOUT_MS,
            `${target.label} isVerified`,
        ))
    ) {
        return { alreadyVerified: true as const };
    }

    const connection = await network.connect();
    const deployedBytecode = await Bytecode.getDeployedContractBytecode(
        connection.provider,
        target.address,
        networkName,
    );

    const supportedSolcVersions = await resolveSupportedSolcVersions(buildProfile);
    const compatibleSolcVersions = await filterVersionsByRange(
        supportedSolcVersions,
        deployedBytecode.solcVersion,
    );
    if (compatibleSolcVersions.length === 0) {
        throw new Error(
            `Solidity version mismatch for ${target.label}: deployed ${deployedBytecode.solcVersion}`,
        );
    }

    const contractInformationResolver = new ContractInformationResolver(
        artifacts,
        compatibleSolcVersions,
        networkName,
    );
    const contractInformation = (await contractInformationResolver.resolve(
        target.contract,
        deployedBytecode,
    )) as ContractInformation;

    const libraryInformation = resolveLibraryInformation(contractInformation, {});
    const encodedConstructorArgs = await encodeConstructorArgs(
        contractInformation.compilerOutputContract.abi,
        target.constructorArgs,
        contractInformation.userFqn,
    );

    return {
        alreadyVerified: false as const,
        contractInformation,
        encodedConstructorArgs,
        compilerInput: {
            ...contractInformation.compilerInput,
            settings: {
                ...contractInformation.compilerInput.settings,
                libraries: libraryInformation.libraries,
            },
        },
    };
}

async function submitVerification(
    verificationProvider: VerificationProvider,
    target: VerificationTarget,
    contractInformation: ContractInformation,
    encodedConstructorArgs: string,
    compilerInput: CompilerInput,
): Promise<string> {
    return withTimeout(
        verificationProvider.verify({
            contractAddress: target.address,
            compilerInput,
            contractName: contractInformation.inputFqn,
            compilerVersion: `v${contractInformation.solcLongVersion}`,
            constructorArguments: encodedConstructorArgs,
        }),
        HTTP_TIMEOUT_MS,
        `${target.label} submit`,
    );
}

export async function verifyAllContracts(
    hre: HardhatRuntimeEnvironment,
    targets: VerificationTarget[],
): Promise<void> {
    const buildProfileName = hre.globalOptions.buildProfile ?? "production";
    const { provider: verificationProvider, networkName } = await createBlockscoutProvider(hre);

    const progress = new VerificationProgress(targets.map((target) => target.label));
    progress.start();

    const hardFailures: string[] = [];
    const unconfirmed: string[] = [];
    const polls: Promise<void>[] = [];

    const settlePoll = async (index: number, target: VerificationTarget, guid: string): Promise<void> => {
        try {
            const outcome = await pollVerificationGuid(verificationProvider, guid);

            if (outcome === "success") {
                progress.setDone(index);
                return;
            }

            if (outcome === "timeout") {
                let verified = false;
                try {
                    verified = await withTimeout(
                        verificationProvider.isVerified(target.address),
                        HTTP_TIMEOUT_MS,
                        `${target.label} isVerified`,
                    );
                } catch {
                    verified = false;
                }

                if (verified) {
                    progress.setDone(index);
                    return;
                }

                progress.setUnconfirmed(index);
                unconfirmed.push(`${target.label} (${target.address})`);
                return;
            }

            progress.setFailed(index);
            const message = "Blockscout returned Fail - Unable to verify";
            hardFailures.push(`${target.label} (${target.address}): ${message}`);
        } catch (error) {
            progress.setFailed(index);
            const message = error instanceof Error ? error.message : String(error);
            hardFailures.push(`${target.label} (${target.address}): ${message}`);
        }
    };

    for (let index = 0; index < targets.length; index++) {
        if (index > 0) {
            await delay(SUBMIT_STAGGER_MS);
        }

        const target = targets[index];
        try {
            progress.setIndexing(index);
            const indexed = await waitUntilIndexedAsContract(
                verificationProvider.url,
                target.address,
            );
            if (!indexed && !(await hasOnChainCode(hre, target.address))) {
                throw new Error(
                    `${target.label} has no on-chain bytecode and was not indexed as a contract on Blockscout`,
                );
            }

            const context = await resolveVerificationContext(
                hre,
                verificationProvider,
                target,
                networkName,
                buildProfileName,
            );

            if (context.alreadyVerified) {
                progress.setDone(index);
                continue;
            }

            const guid = await submitVerification(
                verificationProvider,
                target,
                context.contractInformation,
                context.encodedConstructorArgs,
                context.compilerInput,
            );

            progress.setWaiting(index);
            polls.push(settlePoll(index, target, guid));
        } catch (error) {
            if (isAlreadyVerifiedError(error)) {
                progress.setDone(index);
                continue;
            }

            progress.setFailed(index);
            const message = error instanceof Error ? error.message : String(error);
            hardFailures.push(`${target.label} (${target.address}): ${message}`);
        }
    }

    await Promise.all(polls);

    await progress.finish();

    if (hardFailures.length > 0) {
        console.error(`\n${RED}✗${RESET} Blockscout verification issues:`);
        for (const failure of hardFailures) {
            console.error(`  - ${failure}`);
        }
        console.error(
            "  On-chain contracts are still deployed. Explorer indexing/partial-verify can fail independently.",
        );
    }

    if (unconfirmed.length > 0) {
        console.warn(
            `\n${YELLOW}⚠${RESET} Submitted but not confirmed within ${VERIFICATION_POLL_TIMEOUT_MS / 60_000}m (may still verify on Blockscout):`,
        );
        for (const entry of unconfirmed) {
            console.warn(`  - ${entry}`);
        }
    }

    const failed = hardFailures.length + unconfirmed.length;
    const confirmed = targets.length - failed;
    if (failed === 0) {
        console.log(`${GREEN}✓${RESET} Verified all ${targets.length} contracts on Blockscout`);
        return;
    }

    console.log(
        `${YELLOW}⚠${RESET} Confirmed ${confirmed}/${targets.length} contracts on Blockscout (${failed} not fully verified)`,
    );
}
