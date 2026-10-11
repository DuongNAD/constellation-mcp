/**
 * Base interfaces and helpers for agent configuration managers.
 */
import { AgentName, AgentServerConfig, DiffEntry, DoctorIssue, ServerEntry } from "../types.js";
import { resolveServerEnv } from "../manifest.js";
import { deepEqual, extractSecretName, isSecretKey, isSecretReference, maskSecretsInEnv } from "../util.js";

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

  const env: Record<string, string> = {};

  if (server.env && Object.keys(server.env).length > 0) {
    const resolved = resolveServerEnv(server);
    for (const [k, v] of Object.entries(server.env)) {
      if (isSecretReference(v)) {
        // Agents need the real value: the secret store (env or ~/.constellation/secrets.json) wins, then the
        // value the agent already has. Writing the ${secret:...} placeholder would hand the server a bogus key.
        const value = resolved[k] || existingConfig?.env?.[k];
        if (!value || isSecretReference(value)) {
          throw new Error(
            `Secret '${extractSecretName(v) ?? k}' for server '${server.name}' is not set: add it to ~/.constellation/secrets.json or the environment.`,
          );
        }
        env[k] = value;
      } else {
        env[k] = v;
      }
    }
  }

  // Preserve and merge any env keys that exist in agent config but not in manifest
  if (existingConfig?.env && Object.keys(existingConfig.env).length > 0) {
    for (const [k, v] of Object.entries(existingConfig.env)) {
      if (!(k in env)) {
        env[k] = v;
      }
    }
  }

  if (Object.keys(env).length > 0) {
    result.env = env;
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
): { matches: boolean; differences: string[]; extraEnvKeys: string[] } {
  const differences: string[] = [];

  if (manifestServer.command !== agentServer.command) {
    differences.push(`command differs: manifest='${manifestServer.command}' vs agent='${agentServer.command}'`);
  }

  if (!deepEqual(manifestServer.args, agentServer.args)) {
    differences.push(`args differ: manifest=[${manifestServer.args.join(", ")}] vs agent=[${agentServer.args.join(", ")}]`);
  }

  const agentEnv = agentServer.env ?? {};
  if (manifestServer.env) {
    const resolved = resolveServerEnv(manifestServer);
    for (const [k, v] of Object.entries(manifestServer.env)) {
      if (isSecretKey(k) || isSecretReference(v)) {
        if (!(k in agentEnv)) {
          differences.push(`missing secret env var '${k}' in agent config`);
        } else if (isSecretReference(agentEnv[k] ?? "")) {
          differences.push(`env '${k}' holds the unresolved placeholder instead of the secret; run register to write it`);
        } else if (isSecretReference(v) && resolved[k] && agentEnv[k] !== resolved[k]) {
          differences.push(`secret env '${k}' differs from the secret store (values hidden); run register to update it`);
        }
      } else {
        if (agentEnv[k] !== v) {
          differences.push(`env '${k}' differs: manifest='${v}' vs agent='${agentEnv[k] ?? "<missing>"}'`);
        }
      }
    }
  }

  // Detect env keys in agent config that are NOT in manifest
  const manifestEnv = manifestServer.env ?? {};
  const extraEnvKeys = Object.keys(agentEnv).filter((k) => !(k in manifestEnv));

  return {
    matches: differences.length === 0 && extraEnvKeys.length === 0,
    differences,
    extraEnvKeys,
  };
}

export function formatConfigDiff(
  agentName: string,
  filePath: string,
  serverName: string,
  before: AgentServerConfig | undefined,
  after: AgentServerConfig | undefined,
  manifestServer?: ServerEntry,
): DiffEntry {
  const changes: string[] = [];
  const manifestEnv = manifestServer?.env ?? {};
  const unmanagedKeys = Object.keys(after?.env ?? {}).filter((k) => !(k in manifestEnv));
  const unmanagedNotes: string[] = [];
  if (unmanagedKeys.length > 0) {
    for (const k of unmanagedKeys) {
      const maskedVal = isSecretKey(k) ? "***" : (after?.env?.[k] ?? "***");
      unmanagedNotes.push(`kept unmanaged env key '${k}' (${maskedVal})`);
    }
  }

  if (!before && after) {
    const maskedAfter = {
      ...after,
      env: normalizeEnv(maskSecretsInEnv(after.env)),
    };
    changes.push(`+ Add server '${serverName}': ${JSON.stringify(maskedAfter)}`);
    unmanagedNotes.forEach((n) => changes.push(`  ${n}`));
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

    // Decide on the real values (masked ones hide a rotated key or a leftover ${secret:...} placeholder),
    // show only masked ones.
    const rawBefore = { ...before, env: normalizeEnv(before.env) };
    const rawAfter = { ...after, env: normalizeEnv(after.env) };
    if (deepEqual(comparable(rawBefore), comparable(rawAfter))) {
      return {
        agent: agentName,
        file: filePath,
        action: "noop",
        changes: unmanagedNotes.length > 0 ? unmanagedNotes : [`No change for server '${serverName}'`],
      };
    }
    const updatedSecretKeys = Object.keys(after.env ?? {}).filter(
      (k) => isSecretKey(k) && before.env?.[k] !== undefined && before.env[k] !== after.env?.[k],
    );

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
    if (updatedSecretKeys.length > 0) {
      changes.push(`  env: updated secret value for ${updatedSecretKeys.map((k) => `'${k}'`).join(", ")} (values hidden)`);
    }
    unmanagedNotes.forEach((n) => changes.push(`  ${n}`));

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
