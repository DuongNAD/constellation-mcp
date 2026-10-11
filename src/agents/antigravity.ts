/**
 * Google Antigravity agent managers.
 * - AntigravityAgentManager ("antigravity"): keeps ~/.gemini/antigravity, ~/.gemini/config,
 *   and ~/.gemini/antigravity-ide mcp_config.json in sync.
 * - AntigravityCliAgentManager ("antigravity-cli"): manages ~/.gemini/antigravity-cli/mcp_config.json.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AgentServerConfig, DiffEntry, DoctorIssue, ServerEntry } from "../types.js";
import {
  atomicWriteFile,
  createRollingBackup,
  deepEqual,
  detectLineEnding,
  getHomeDir,
  readJsonFile,
} from "../util.js";
import {
  AgentManager,
  buildServerEntryConfig,
  compareServerConfigs,
  formatConfigDiff,
} from "./base.js";

interface RawJsonConfigResult {
  data: { mcpServers?: Record<string, AgentServerConfig>; [key: string]: unknown };
  lineEnding: "\r\n" | "\n";
  exists: boolean;
  hasBom: boolean;
  parseError?: Error;
}

function loadRawJsonConfig(filePath: string): RawJsonConfigResult {
  const res = readJsonFile<Record<string, unknown>>(filePath);
  if (!res.exists) {
    return {
      data: { mcpServers: {} },
      lineEnding: res.lineEnding,
      exists: false,
      hasBom: false,
    };
  }
  if (res.parseError) {
    return {
      data: { mcpServers: {} },
      lineEnding: res.lineEnding,
      exists: true,
      hasBom: res.hasBom,
      parseError: res.parseError,
    };
  }
  const data = res.data && typeof res.data === "object" && !Array.isArray(res.data) ? res.data : { mcpServers: {} };
  return {
    data,
    lineEnding: res.lineEnding,
    exists: true,
    hasBom: res.hasBom,
  };
}

export class AntigravityAgentManager implements AgentManager {
  readonly name = "antigravity" as const;
  readonly displayName = "Google Antigravity";

  getConfigPaths(): string[] {
    const home = getHomeDir();
    return [
      join(home, ".gemini", "antigravity", "mcp_config.json"),
      join(home, ".gemini", "config", "mcp_config.json"),
      join(home, ".gemini", "antigravity-ide", "mcp_config.json"),
    ];
  }

  getTargetConfigPaths(forWriting = false): string[] {
    const paths = this.getConfigPaths();
    if (forWriting) {
      const existing = paths.filter((p) => existsSync(p));
      return existing.length > 0 ? existing : [paths[0]!];
    }
    return paths;
  }

  async readServers(): Promise<Map<string, AgentServerConfig>> {
    const servers = new Map<string, AgentServerConfig>();
    for (const p of this.getConfigPaths()) {
      if (existsSync(p)) {
        const { data, parseError } = loadRawJsonConfig(p);
        if (parseError) continue;
        if (data.mcpServers && typeof data.mcpServers === "object") {
          for (const [name, cfg] of Object.entries(data.mcpServers)) {
            if (cfg && typeof cfg === "object" && cfg.command && Array.isArray(cfg.args)) {
              if (!servers.has(name)) {
                servers.set(name, cfg);
              }
            }
          }
        }
      }
    }
    return servers;
  }

  async register(servers: ServerEntry | ServerEntry[], dryRun: boolean): Promise<DiffEntry[]> {
    const serverList = Array.isArray(servers) ? servers : [servers];
    const diffs: DiffEntry[] = [];
    const targetPaths = this.getTargetConfigPaths(true);

    for (const filePath of targetPaths) {
      const { data, lineEnding, hasBom } = loadRawJsonConfig(filePath);
      const mcpServers = (data.mcpServers ?? {}) as Record<string, AgentServerConfig>;
      let fileChanged = hasBom;

      if (hasBom) {
        diffs.push({
          agent: this.displayName,
          file: filePath,
          action: "update",
          changes: ["Rewrite file without UTF-8 BOM"],
        });
      }

      for (const server of serverList) {
        const existing = mcpServers[server.name];
        const newConfig = buildServerEntryConfig(server, existing);
        const diff = formatConfigDiff(this.displayName, filePath, server.name, existing, newConfig, server);
        diffs.push(diff);

        if (diff.action !== "noop") {
          fileChanged = true;
          mcpServers[server.name] = newConfig;
        }
      }

      if (!dryRun && fileChanged) {
        createRollingBackup(filePath);
        data.mcpServers = mcpServers;
        const rawJson = JSON.stringify(data, null, 2);
        const formatted = lineEnding === "\r\n" ? rawJson.replace(/\n/g, "\r\n") + "\r\n" : rawJson + "\n";
        atomicWriteFile(filePath, formatted);
      }
    }

    return diffs;
  }

  async unregister(serverNames: string | string[], dryRun: boolean): Promise<DiffEntry[]> {
    const namesList = Array.isArray(serverNames) ? serverNames : [serverNames];
    const diffs: DiffEntry[] = [];
    const targetPaths = this.getTargetConfigPaths(false);

    for (const filePath of targetPaths) {
      if (!existsSync(filePath)) continue;
      const { data, lineEnding } = loadRawJsonConfig(filePath);
      const mcpServers = (data.mcpServers ?? {}) as Record<string, AgentServerConfig>;
      let fileChanged = false;

      for (const serverName of namesList) {
        const existing = mcpServers[serverName];
        if (!existing) {
          diffs.push({
            agent: this.displayName,
            file: filePath,
            action: "noop",
            changes: [`Server '${serverName}' not present in ${filePath}`],
          });
          continue;
        }

        const diff = formatConfigDiff(this.displayName, filePath, serverName, existing, undefined);
        diffs.push(diff);

        if (diff.action !== "noop") {
          fileChanged = true;
          delete mcpServers[serverName];
        }
      }

      if (!dryRun && fileChanged) {
        createRollingBackup(filePath);
        data.mcpServers = mcpServers;
        const rawJson = JSON.stringify(data, null, 2);
        const formatted = lineEnding === "\r\n" ? rawJson.replace(/\n/g, "\r\n") + "\r\n" : rawJson + "\n";
        atomicWriteFile(filePath, formatted);
      }
    }

    return diffs;
  }

  async checkDrift(server: ServerEntry): Promise<DoctorIssue[]> {
    const issues: DoctorIssue[] = [];
    const paths = this.getConfigPaths().filter((p) => existsSync(p));

    if (paths.length === 0) {
      issues.push({
        severity: "warning",
        category: "drift",
        agent: this.displayName,
        server: server.name,
        message: `No Antigravity config files found (expected in ~/.gemini/antigravity/mcp_config.json)`,
        fix: `Run 'eco_register' or 'constellation register ${server.name}'`,
      });
      return issues;
    }

    // Check each file against manifest
    const fileConfigs = new Map<string, AgentServerConfig | undefined>();
    for (const p of paths) {
      const { data, parseError } = loadRawJsonConfig(p);
      if (parseError) {
        // Skip drift check for broken config file; doctor reports single parse error
        continue;
      }
      const cfg = data.mcpServers?.[server.name];
      fileConfigs.set(p, cfg);

      if (!cfg) {
        issues.push({
          severity: "error",
          category: "drift",
          agent: this.displayName,
          server: server.name,
          file: p,
          message: `Server '${server.name}' is missing in ${p}`,
          fix: `Run 'eco_register' to sync across all Antigravity configs`,
        });
      } else {
        const { matches, differences, extraEnvKeys } = compareServerConfigs(server, cfg);
        if (!matches) {
          if (differences.length > 0) {
            issues.push({
              severity: "error",
              category: "drift",
              agent: this.displayName,
              server: server.name,
              file: p,
              message: `Server '${server.name}' in ${p} differs from manifest: ${differences.join("; ")}`,
              fix: `Run 'eco_register' to update agent config from manifest`,
            });
          }
          if (extraEnvKeys && extraEnvKeys.length > 0) {
            for (const key of extraEnvKeys) {
              issues.push({
                severity: "error",
                category: "drift",
                agent: this.displayName,
                server: server.name,
                file: p,
                message: `Server '${server.name}' in ${p} has extra env key '${key}' not in manifest`,
                fix: `add \${secret:${key}} to the server's env in ecosystem.json and the value to ~/.constellation/secrets.json or the process environment`,
              });
            }
          }
        }
      }
    }

    // Check consistency between different Antigravity files
    const entries = Array.from(fileConfigs.entries()).filter(([_, cfg]) => cfg !== undefined);
    if (entries.length > 1) {
      const [firstPath, firstCfg] = entries[0]!;
      for (let i = 1; i < entries.length; i++) {
        const [otherPath, otherCfg] = entries[i]!;
        if (!deepEqual(firstCfg, otherCfg)) {
          issues.push({
            severity: "error",
            category: "antigravity_drift",
            agent: this.displayName,
            server: server.name,
            file: otherPath,
            message: `Antigravity config mismatch: '${server.name}' in ${otherPath} differs from ${firstPath}`,
            fix: `Run 'eco_register' to reconcile Antigravity config files`,
          });
        }
      }
    }

    return issues;
  }
}

export class AntigravityCliAgentManager implements AgentManager {
  readonly name = "antigravity-cli" as const;
  readonly displayName = "Antigravity CLI";

  getConfigFile(): string {
    const home = getHomeDir();
    return join(home, ".gemini", "antigravity-cli", "mcp_config.json");
  }

  getConfigPaths(): string[] {
    return [this.getConfigFile()];
  }

  getTargetConfigPaths(forWriting = false): string[] {
    const filePath = this.getConfigFile();
    if (forWriting) {
      return [filePath];
    }
    return existsSync(filePath) ? [filePath] : [];
  }

  async readServers(): Promise<Map<string, AgentServerConfig>> {
    const servers = new Map<string, AgentServerConfig>();
    const filePath = this.getConfigFile();
    if (existsSync(filePath)) {
      const { data, parseError } = loadRawJsonConfig(filePath);
      if (parseError) return servers;
      if (data.mcpServers && typeof data.mcpServers === "object") {
        for (const [name, cfg] of Object.entries(data.mcpServers)) {
          if (cfg && typeof cfg === "object" && cfg.command && Array.isArray(cfg.args)) {
            servers.set(name, cfg);
          }
        }
      }
    }
    return servers;
  }

  async register(servers: ServerEntry | ServerEntry[], dryRun: boolean): Promise<DiffEntry[]> {
    const serverList = Array.isArray(servers) ? servers : [servers];
    const diffs: DiffEntry[] = [];
    const filePath = this.getConfigFile();
    const { data, lineEnding, hasBom } = loadRawJsonConfig(filePath);
    const mcpServers = (data.mcpServers ?? {}) as Record<string, AgentServerConfig>;
    let fileChanged = hasBom;

    if (hasBom) {
      diffs.push({
        agent: this.displayName,
        file: filePath,
        action: "update",
        changes: ["Rewrite file without UTF-8 BOM"],
      });
    }

    for (const server of serverList) {
      const existing = mcpServers[server.name];
      const newConfig = buildServerEntryConfig(server, existing);
      const diff = formatConfigDiff(this.displayName, filePath, server.name, existing, newConfig, server);
      diffs.push(diff);

      if (diff.action !== "noop") {
        fileChanged = true;
        mcpServers[server.name] = newConfig;
      }
    }

    if (!dryRun && fileChanged) {
      createRollingBackup(filePath);
      data.mcpServers = mcpServers;
      const rawJson = JSON.stringify(data, null, 2);
      const formatted = lineEnding === "\r\n" ? rawJson.replace(/\n/g, "\r\n") + "\r\n" : rawJson + "\n";
      atomicWriteFile(filePath, formatted);
    }

    return diffs;
  }

  async unregister(serverNames: string | string[], dryRun: boolean): Promise<DiffEntry[]> {
    const namesList = Array.isArray(serverNames) ? serverNames : [serverNames];
    const diffs: DiffEntry[] = [];
    const filePath = this.getConfigFile();

    if (!existsSync(filePath)) {
      for (const serverName of namesList) {
        diffs.push({
          agent: this.displayName,
          file: filePath,
          action: "noop",
          changes: [`Server '${serverName}' not present in ${filePath}`],
        });
      }
      return diffs;
    }

    const { data, lineEnding } = loadRawJsonConfig(filePath);
    const mcpServers = (data.mcpServers ?? {}) as Record<string, AgentServerConfig>;
    let fileChanged = false;

    for (const serverName of namesList) {
      const existing = mcpServers[serverName];
      if (!existing) {
        diffs.push({
          agent: this.displayName,
          file: filePath,
          action: "noop",
          changes: [`Server '${serverName}' not present in ${filePath}`],
        });
        continue;
      }

      const diff = formatConfigDiff(this.displayName, filePath, serverName, existing, undefined);
      diffs.push(diff);

      if (diff.action !== "noop") {
        fileChanged = true;
        delete mcpServers[serverName];
      }
    }

    if (!dryRun && fileChanged) {
      createRollingBackup(filePath);
      data.mcpServers = mcpServers;
      const rawJson = JSON.stringify(data, null, 2);
      const formatted = lineEnding === "\r\n" ? rawJson.replace(/\n/g, "\r\n") + "\r\n" : rawJson + "\n";
      atomicWriteFile(filePath, formatted);
    }

    return diffs;
  }

  async checkDrift(server: ServerEntry): Promise<DoctorIssue[]> {
    const issues: DoctorIssue[] = [];
    const filePath = this.getConfigFile();

    if (!existsSync(filePath)) {
      issues.push({
        severity: "warning",
        category: "drift",
        agent: this.displayName,
        server: server.name,
        file: filePath,
        message: `Antigravity CLI config file ~/.gemini/antigravity-cli/mcp_config.json not found`,
        fix: `Run 'eco_register' or 'constellation register ${server.name}'`,
      });
      return issues;
    }

    const { data, parseError } = loadRawJsonConfig(filePath);
    if (parseError) {
      return issues;
    }
    const cfg = data.mcpServers?.[server.name];

    if (!cfg) {
      issues.push({
        severity: "error",
        category: "drift",
        agent: this.displayName,
        server: server.name,
        file: filePath,
        message: `Server '${server.name}' is missing in ${filePath}`,
        fix: `Run 'eco_register' to sync Antigravity CLI config`,
      });
    } else {
      const { matches, differences, extraEnvKeys } = compareServerConfigs(server, cfg);
      if (!matches) {
        if (differences.length > 0) {
          issues.push({
            severity: "error",
            category: "drift",
            agent: this.displayName,
            server: server.name,
            file: filePath,
            message: `Server '${server.name}' in ${filePath} differs from manifest: ${differences.join("; ")}`,
            fix: `Run 'eco_register' to update agent config from manifest`,
          });
        }
        if (extraEnvKeys && extraEnvKeys.length > 0) {
          for (const key of extraEnvKeys) {
            issues.push({
              severity: "error",
              category: "drift",
              agent: this.displayName,
              server: server.name,
              file: filePath,
              message: `Server '${server.name}' in ${filePath} has extra env key '${key}' not in manifest`,
              fix: `add \${secret:${key}} to the server's env in ecosystem.json and the value to ~/.constellation/secrets.json or the process environment`,
            });
          }
        }
      }
    }

    return issues;
  }
}

export const antigravityAgent = new AntigravityAgentManager();
export const antigravityCliAgent = new AntigravityCliAgentManager();
