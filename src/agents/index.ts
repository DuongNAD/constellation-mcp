/**
 * Unified Agent Registry for Constellation MCP.
 */
import { AgentName } from "../types.js";
import { antigravityAgent, antigravityCliAgent } from "./antigravity.js";
import { AgentManager } from "./base.js";
import { claudeAgent } from "./claude.js";
import { codexAgent } from "./codex.js";
import { cursorAgent } from "./cursor.js";

export * from "./base.js";
export * from "./antigravity.js";
export * from "./claude.js";
export * from "./cursor.js";
export * from "./codex.js";

export const ALL_AGENTS: AgentManager[] = [
  claudeAgent,
  antigravityAgent,
  antigravityCliAgent,
  cursorAgent,
  codexAgent,
];

export const AGENT_MAP: Record<AgentName, AgentManager> = {
  claude: claudeAgent,
  antigravity: antigravityAgent,
  "antigravity-cli": antigravityCliAgent,
  cursor: cursorAgent,
  codex: codexAgent,
};

export function getAgent(name: string): AgentManager | undefined {
  const norm = name.toLowerCase().trim() as AgentName;
  return AGENT_MAP[norm];
}

export function getAgents(names?: AgentName[]): AgentManager[] {
  if (!names || names.length === 0) {
    return ALL_AGENTS;
  }
  return names.map((n) => AGENT_MAP[n]).filter((a): a is AgentManager => Boolean(a));
}
