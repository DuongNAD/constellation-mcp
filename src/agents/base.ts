/**
 * Base interfaces and helpers for agent configuration managers.
 */
import { AgentName, AgentServerConfig, DiffEntry, DoctorIssue, ServerEntry } from "../types.js";
import { deepEqual, isSecretKey, maskSecretsInEnv } from "../util.js";

export interface AgentManager {
  readonly name: AgentName;
  readonly displayName: string;
  getConfigPaths(): string[];
  readServers(): Promise<Map<string, AgentServerConfig>>;
  register(servers: ServerEntry | ServerEntry[], dryRun: boolean): Promise<DiffEntry[]>;
  unregister(serverNames: string | string[], dryRun: boolean): Promise<DiffEntry[]>;
  checkDrift(server: ServerEntry): Promise<DoctorIssue[]>;
}

export function buildServerEntryConfig(
  server: ServerEntry,
  existingConfig?: AgentServerConfig,
): AgentServerConfig {
  const result: AgentServerConfig = {
    command: server.command,
    args: [...server.args],
  };

  if (server.env && Object.keys(server.env).length > 0) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(server.env)) {
      if (isSecretKey(k) && v.startsWith("${secret:") && existingConfig?.env?.[k]) {
        // Keep existing secret in agent config if present
        env[k] = existingConfig.env[k];
      } else {
        env[k] = v;
      }
    }
    result.env = env;
  } else if (existingConfig?.env && Object.keys(existingConfig.env).length > 0) {
    // Preserve existing env if not specified in server
    result.env = existingConfig.env;
  }

  return result;
}

/** `type: "stdio"` is the default transport; Claude Code writes it, other agents and the manifest omit it. */
function comparable(entry: object): Record<string, unknown> {
  const { type, ...rest } = entry as Record<string, unknown>;
  return type === undefined || type === "stdio" ? rest : { type, ...rest };
}

/** An empty env block and a missing one mean the same thing to every agent. */
function normalizeEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
  return env && Object.keys(env).length > 0 ? env : undefined;
}

export function compareServerConfigs(
  manifestServer: ServerEntry,
  agentServer: AgentServerConfig,
): { matches: boolean; differences: string[] } {
  const differences: string[] = [];

  if (manifestServer.command !== agentServer.command) {
    differences.push(`command differs: manifest='${manifestServer.command}' vs agent='${agentServer.command}'`);
  }

  if (!deepEqual(manifestServer.args, agentServer.args)) {
    differences.push(`args differ: manifest=[${manifestServer.args.join(", ")}] vs agent=[${agentServer.args.join(", ")}]`);
  }

  if (manifestServer.env) {
    const agentEnv = agentServer.env ?? {};
    for (const [k, v] of Object.entries(manifestServer.env)) {
      if (isSecretKey(k)) {
        if (!(k in agentEnv)) {
          differences.push(`missing secret env var '${k}' in agent config`);
        }
      } else {
        if (agentEnv[k] !== v) {
          differences.push(`env '${k}' differs: manifest='${v}' vs agent='${agentEnv[k] ?? "<missing>"}'`);
        }
      }
    }
  }

  return {
    matches: differences.length === 0,
    differences,
  };
}

export function formatConfigDiff(
  agentName: string,
  filePath: string,
  serverName: string,
  before: AgentServerConfig | undefined,
  after: AgentServerConfig | undefined,
): DiffEntry {
  const changes: string[] = [];

  if (!before && after) {
    const maskedAfter = {
      ...after,
      env: normalizeEnv(maskSecretsInEnv(after.env)),
    };
    changes.push(`+ Add server '${serverName}': ${JSON.stringify(maskedAfter)}`);
    return {
      agent: agentName,
      file: filePath,
      action: "create",
      after: JSON.stringify(maskedAfter, null, 2),
      changes,
    };
  }

  if (before && !after) {
    const maskedBefore = {
      ...before,
      env: normalizeEnv(maskSecretsInEnv(before.env)),
    };
    changes.push(`- Remove server '${serverName}'`);
    return {
      agent: agentName,
      file: filePath,
      action: "delete",
      before: JSON.stringify(maskedBefore, null, 2),
      changes,
    };
  }

  if (before && after) {
    const maskedBefore = {
      ...before,
      env: normalizeEnv(maskSecretsInEnv(before.env)),
    };
    const maskedAfter = {
      ...after,
      env: normalizeEnv(maskSecretsInEnv(after.env)),
    };

    if (deepEqual(comparable(maskedBefore), comparable(maskedAfter))) {
      return {
        agent: agentName,
        file: filePath,
        action: "noop",
        changes: [`No change for server '${serverName}'`],
      };
    }

    changes.push(`~ Update server '${serverName}'`);
    if (before.command !== after.command) {
      changes.push(`  command: '${before.command}' -> '${after.command}'`);
    }
    if (!deepEqual(before.args, after.args)) {
      changes.push(`  args: [${before.args.join(", ")}] -> [${after.args.join(", ")}]`);
    }
    if (!deepEqual(maskedBefore.env, maskedAfter.env)) {
      changes.push(`  env: ${JSON.stringify(maskedBefore.env)} -> ${JSON.stringify(maskedAfter.env)}`);
    }

    return {
      agent: agentName,
      file: filePath,
      action: "update",
      before: JSON.stringify(maskedBefore, null, 2),
      after: JSON.stringify(maskedAfter, null, 2),
      changes,
    };
  }

  return {
    agent: agentName,
    file: filePath,
    action: "noop",
    changes: [],
  };
}
