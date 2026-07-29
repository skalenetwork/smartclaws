import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentFile } from "@smartclaws/core/types";
import { getAddress, isAddress } from "viem";
import { getConfigDir } from "./config.js";

export type { AgentFile };

function agentsDir(homeDir?: string): string {
    return join(getConfigDir(homeDir), "agents");
}

function recordFileName(value: string): string {
    return isAddress(value) ? getAddress(value) : encodeURIComponent(value);
}

function agentPath(address: string, homeDir?: string): string {
    return join(agentsDir(homeDir), `${recordFileName(address)}.json`);
}

export function saveAgent(agent: AgentFile, homeDir?: string): void {
    const dir = agentsDir(homeDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(agentPath(agent.agentContract, homeDir), `${JSON.stringify(agent, null, 2)}\n`);
}

export function getAgentPath(addressOrName: string, homeDir?: string): string {
    return isAddress(addressOrName)
        ? agentPath(addressOrName, homeDir)
        : join(agentsDir(homeDir), `${recordFileName(addressOrName)}.json`);
}

export function loadAgent(addressOrName: string, homeDir?: string): AgentFile | null {
    if (isAddress(addressOrName)) {
        const path = agentPath(addressOrName, homeDir);
        if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8")) as AgentFile;
    }
    return (
        listAgents(homeDir).find(
            (agent) =>
                agent.name === addressOrName ||
                agent.agentId === addressOrName ||
                agent.agentContract.toLowerCase() === addressOrName.toLowerCase(),
        ) ?? null
    );
}

export function listAgents(homeDir?: string): AgentFile[] {
    const dir = agentsDir(homeDir);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as AgentFile);
}
