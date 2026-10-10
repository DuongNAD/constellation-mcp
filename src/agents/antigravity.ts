/**
 * Google Antigravity multi-config agent manager.
 * Keeps ~/.gemini/antigravity, ~/.gemini/config, ~/.gemini/antigravity-ide,
 * and ~/.gemini/antigravity-cli mcp_config.json in sync.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentServerConfig, DiffEntry, DoctorIssue, ServerEntry } from "../types.js";
import {
  atomicWriteFile,
  createRollingBackup,
  deepEqual,
  detectLineEnding,
  getHomeDir,
} from "../util.js";
import {
  AgentManager,
  buildServerEntryConfig,
  compareServerConfigs,
  formatConfigDiff,
} from "./base.js";

export class AntigravityAgentManager implements AgentManager {
  readonly name = "antigravity" as const;
  readonly displayName = "Google Antigravity";

  getConfigPaths(): string[] {
    const home = getHomeDir();
    const paths = [
      join(home, ".gemini", "antigravity", "mcp_config.json"),
      join(home, ".gemini", "config", "mcp_config.json"),
      join(home, ".gemini", "antigravity-ide", "mcp_config.json"),
    ];

    const cliPath = join(home, ".gemini", "antigravity-cli", "mcp_config.json");
    if (existsSync(cliPath)) {
      paths.push(cliPath);
    }
    return paths;
  }

  getTargetConfigPaths(forWriting = false): string[] {
    const paths = this.getConfigPaths();
    if (forWriting) {
      // If none of the directories exist, ensure at least the primary path is targeted
      const existing = paths.filter((p) => existsSync(p));
      return existing.length > 0 ? existing : [paths[0]!];
    }
    return paths;
  }

  private loadRawConfig(filePath: string): {
    data: { mcpServers?: Record<string, AgentServerConfig>; [key: string]: unknown };
    lineEnding: "\r\n" | "\n";
    exists: boolean;
  } {
    if (!existsSync(filePath)) {
      return {
        data: { mcpServers: {} },
        lineEnding: process.platform === "win32" ? "\r\n" : "\n",
        exists: false,
      };
    }
    try {
      const content = readFileSync(filePath, "utf8");
      const lineEnding = detectLineEnding(content);
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { data: parsed, lineEnding, exists: true };
      }
    } catch {
      // ignore
    }
    return {
      data: { mcpServers: {} },
      lineEnding: process.platform === "win32" ? "\r\n" : "\n",
      exists: false,
    };
  }

  async readServers(): Promise<Map<string, AgentServerConfig>> {
    const servers = new Map<string, AgentServerConfig>();
    for (const p of this.getConfigPaths()) {
      if (existsSync(p)) {
        const { data } = this.loadRawConfig(p);
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

  async register(server: ServerEntry, dryRun: boolean): Promise<DiffEntry[]> {
    const diffs: DiffEntry[] = [];
    const targetPaths = this.getTargetConfigPaths(true);

    for (const filePath of targetPaths) {
      const { data, lineEnding } = this.loadRawConfig(filePath);
      const mcpServers = (data.mcpServers ?? {}) as Record<string, AgentServerConfig>;
      const existing = mcpServers[server.name];
      const newConfig = buildServerEntryConfig(server, existing);

      const diff = formatConfigDiff(this.displayName, filePath, server.name, existing, newConfig);
      diffs.push(diff);

      if (!dryRun && diff.action !== "noop") {
        createRollingBackup(filePath);
        data.mcpServers = {
          ...mcpServers,
          [server.name]: newConfig,
        };
        const rawJson = JSON.stringify(data, null, 2);
        const formatted = lineEnding === "\r\n" ? rawJson.replace(/\n/g, "\r\n") + "\r\n" : rawJson + "\n";
        atomicWriteFile(filePath, formatted);
      }
    }

    return diffs;
  }

  async unregister(serverName: string, dryRun: boolean): Promise<DiffEntry[]> {
    const diffs: DiffEntry[] = [];
    const targetPaths = this.getTargetConfigPaths(false);

    for (const filePath of targetPaths) {
      if (!existsSync(filePath)) continue;
      const { data, lineEnding } = this.loadRawConfig(filePath);
      const mcpServers = (data.mcpServers ?? {}) as Record<string, AgentServerConfig>;
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

      if (!dryRun) {
        createRollingBackup(filePath);
        delete mcpServers[serverName];
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
      const { data } = this.loadRawConfig(p);
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
        const { matches, differences } = compareServerConfigs(server, cfg);
        if (!matches) {
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

export const antigravityAgent = new AntigravityAgentManager();
