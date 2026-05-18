import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentFile } from "@smartclaws/core/types";
import { getConfigDir } from "./config.ts";

export type { AgentFile };

function agentsDir(): string {
  return join(getConfigDir(), "agents");
}

function agentPath(name: string): string {
  return join(agentsDir(), `${name}.json`);
}

export function saveAgent(agent: AgentFile): void {
  const dir = agentsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(agentPath(agent.name), `${JSON.stringify(agent, null, 2)}\n`);
}

export function getAgentPath(name: string): string {
  return agentPath(name);
}

export function loadAgent(name: string): AgentFile | null {
  const path = agentPath(name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as AgentFile;
}

export function listAgents(): AgentFile[] {
  const dir = agentsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as AgentFile);
}
