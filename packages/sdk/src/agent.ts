import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentFile } from "@smartclaws/core/types";
import { getConfigDir } from "./config.js";

export type { AgentFile };

function agentsDir(homeDir?: string): string {
  return join(getConfigDir(homeDir), "agents");
}

function agentPath(name: string, homeDir?: string): string {
  return join(agentsDir(homeDir), `${name}.json`);
}

export function saveAgent(agent: AgentFile, homeDir?: string): void {
  const dir = agentsDir(homeDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(agentPath(agent.name, homeDir), `${JSON.stringify(agent, null, 2)}\n`);
}

export function getAgentPath(name: string, homeDir?: string): string {
  return agentPath(name, homeDir);
}

export function loadAgent(name: string, homeDir?: string): AgentFile | null {
  const path = agentPath(name, homeDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as AgentFile;
}

export function listAgents(homeDir?: string): AgentFile[] {
  const dir = agentsDir(homeDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as AgentFile);
}
