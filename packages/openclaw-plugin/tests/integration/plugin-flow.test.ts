import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWallet } from "@smartclaws/sdk";
import { parseEther } from "viem";
import { deployRegistry, publicClient, walletClient } from "../../../cli/tests/setup.ts";
import { attachTool } from "../../src/tools/attach.ts";
import { configureTool } from "../../src/tools/configure.ts";
import { discoverTool } from "../../src/tools/discover.ts";
import { initializeTool } from "../../src/tools/initialize.ts";
import { listLocalTool } from "../../src/tools/list-local.ts";
import { registerAgentTool } from "../../src/tools/register-agent.ts";
import { registerDeviceTool } from "../../src/tools/register-device.ts";
import { registerGroupTool } from "../../src/tools/register-group.ts";
import { roleGrantTool, roleRevokeTool } from "../../src/tools/roles.ts";
import { setupStatusTool } from "../../src/tools/setup-status.ts";

const ANVIL_RPC = "http://127.0.0.1:8545";

function toolFactory(spec: unknown): unknown {
    return spec;
}

type ToolSpec = {
    execute: (
        params: Record<string, unknown>,
        config: Record<string, unknown>,
        context: { signal?: AbortSignal },
    ) => Promise<unknown>;
};

async function anvilReady(): Promise<boolean> {
    try {
        const response = await fetch(ANVIL_RPC, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        });
        return response.ok;
    } catch {
        return false;
    }
}

const ready = await anvilReady();

describe.skipIf(!ready)("plugin anvil flow", () => {
    let home: string;
    let registryAddress: string;
    const pluginConfig = (): Record<string, unknown> => ({
        smartclawsHome: home,
        allowPrivateRpc: true,
    });

    async function run(
        create: (factory: typeof toolFactory) => unknown,
        params: Record<string, unknown> = {},
    ) {
        const spec = create(toolFactory) as ToolSpec;
        return spec.execute(params, pluginConfig(), {});
    }

    beforeAll(async () => {
        home = mkdtempSync(join(tmpdir(), "smartclaws-plugin-"));
        registryAddress = await deployRegistry();
    });

    afterAll(() => {
        rmSync(home, { recursive: true, force: true });
    });

    test("fresh initialize, configure, register, attach, list, and discover", async () => {
        const initialized = (await run(initializeTool, {
            mode: "controller",
            network: "base-testnet",
        })) as { walletAddress: string; fingerprint: string };
        expect(initialized.walletAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(JSON.stringify(initialized)).not.toContain("privateKey");
        expect(JSON.stringify(initialized)).not.toContain(home);

        const configured = (await run(configureTool, {
            expectedFingerprint: initialized.fingerprint,
            rpcUrl: ANVIL_RPC,
            chainId: 31337,
            registryAddress,
        })) as { fingerprint: string; status: string };
        expect(configured.status).toBe("updated");

        const wallet = loadWallet(home);
        expect(wallet).toBeTruthy();
        const fundHash = await walletClient.sendTransaction({
            to: wallet?.address as `0x${string}`,
            value: parseEther("10"),
        });
        await publicClient.waitForTransactionReceipt({ hash: fundHash });

        const group = (await run(registerGroupTool, {
            name: "plugin-group",
            attach: false,
        })) as { status: string; txHash: string; group: { address: string }; attached: boolean };
        expect(group.status).toBe("confirmed");
        expect(group.attached).toBe(false);
        expect(group.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);

        const status = (await run(setupStatusTool)) as { home: { fingerprint: string } };
        const attached = (await run(attachTool, {
            expectedFingerprint: status.home.fingerprint,
            group: group.group.address,
        })) as { status: string; group: { address: string } };
        expect(attached.status).toBe("attached");
        expect(attached.group.address.toLowerCase()).toBe(group.group.address.toLowerCase());

        const device = (await run(registerDeviceTool, {
            name: "plugin-sensor",
            capacityBytes: "1048576",
        })) as {
            status: string;
            device: { address: string; incomingChannel: string; outgoingChannel: string };
            attached: boolean;
        };
        expect(device.status).toBe("confirmed");
        expect(device.attached).toBe(true);
        expect(device.device.incomingChannel).toMatch(/^0x/);

        const agent = (await run(registerAgentTool, {
            name: "plugin-agent",
            attach: false,
        })) as { status: string; agent: { address: string }; attached: boolean };
        expect(agent.status).toBe("confirmed");
        expect(agent.attached).toBe(false);

        const local = (await run(listLocalTool, { kind: "all" })) as {
            groups: unknown[];
            devices: unknown[];
            agents: unknown[];
        };
        expect(local.groups.length).toBeGreaterThan(0);
        expect(local.devices.length).toBeGreaterThan(0);
        expect(local.agents.length).toBeGreaterThan(0);
        expect(JSON.stringify(local)).not.toContain(home);

        const discovered = (await run(discoverTool, {
            kind: "group",
            offset: 0,
            limit: 10,
        })) as { total: number; items: Array<{ address: string }> };
        expect(discovered.total).toBeGreaterThan(0);
        expect(
            discovered.items.some(
                (item) => item.address.toLowerCase() === group.group.address.toLowerCase(),
            ),
        ).toBe(true);

        const other = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
        const granted = (await run(roleGrantTool, {
            kind: "device",
            target: device.device.address,
            role: "publisher",
            account: other,
        })) as { status: string; txHash: string };
        expect(granted.status).toBe("confirmed");
        const revoked = (await run(roleRevokeTool, {
            kind: "device",
            target: device.device.address,
            role: "publisher",
            account: other,
        })) as { status: string };
        expect(revoked.status).toBe("confirmed");
    });
});
