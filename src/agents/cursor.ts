/**
 * Cursor IDE agent manager.
 * Manages ~/.cursor/mcp.json.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentServerConfig, DiffEntry, DoctorIssue, ServerEntry } from "../types.js";
import {
  atomicWriteFile,
  createRollingBackup,
  detectLineEnding,
  getHomeDir,
} from "../util.js";
import {
  AgentManager,
  buildServerEntryConfig,
  compareServerConfigs,
  formatConfigDiff,
} from "./base.js";

export class CursorAgentManager implements AgentManager {
  readonly name = "cursor" as const;
  readonly displayName = "Cursor IDE";

  getConfigFile(): string {
    const home = getHomeDir();
    return join(home, ".cursor", "mcp.json");
  }

  getConfigPaths(): string[] {
    return [this.getConfigFile()];
  }

  private loadRawConfigFile(): {
    data: { mcpServers?: Record<string, AgentServerConfig>; [key: string]: unknown };
    lineEnding: "\r\n" | "\n";
    exists: boolean;
  } {
    const filePath = this.getConfigFile();
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
    const filePath = this.getConfigFile();
    if (existsSync(filePath)) {
      const { data } = this.loadRawConfigFile();
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
    const { data, lineEnding } = this.loadRawConfigFile();
    const mcpServers = (data.mcpServers ?? {}) as Record<string, AgentServerConfig>;
    let fileChanged = false;

    for (const server of serverList) {
      const existing = mcpServers[server.name];
      const newConfig = buildServerEntryConfig(server, existing);
      const diff = formatConfigDiff(this.displayName, filePath, server.name, existing, newConfig);
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
    const { data, lineEnding, exists } = this.loadRawConfigFile();
    const mcpServers = (data.mcpServers ?? {}) as Record<string, AgentServerConfig>;
    let fileChanged = false;

    for (const serverName of namesList) {
      const existing = mcpServers[serverName];
      if (!existing && !exists) {
        diffs.push({
          agent: this.displayName,
          file: filePath,
          action: "noop",
          changes: [`Server '${serverName}' not present in Cursor config`],
        });
        continue;
      }

      if (!existing) {
        diffs.push({
          agent: this.displayName,
          file: filePath,
          action: "noop",
          changes: [`Server '${serverName}' not present in Cursor config`],
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

    if (!dryRun && fileChanged && exists) {
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
        message: `Cursor config file ~/.cursor/mcp.json not found`,
        fix: `Run 'eco_register' to create Cursor MCP configuration`,
      });
      return issues;
    }

    const { data } = this.loadRawConfigFile();
    const cfg = data.mcpServers?.[server.name];

    if (!cfg) {
      issues.push({
        severity: "error",
        category: "drift",
        agent: this.displayName,
        server: server.name,
        file: filePath,
        message: `Server '${server.name}' is missing in ~/.cursor/mcp.json`,
        fix: `Run 'eco_register' to register '${server.name}' in Cursor`,
      });
    } else {
      const { matches, differences } = compareServerConfigs(server, cfg);
      if (!matches) {
        issues.push({
          severity: "error",
          category: "drift",
          agent: this.displayName,
          server: server.name,
          file: filePath,
          message: `Server '${server.name}' in ~/.cursor/mcp.json differs from manifest: ${differences.join("; ")}`,
          fix: `Run 'eco_register' to update Cursor MCP configuration`,
        });
      }
    }

    return issues;
  }
}

export const cursorAgent = new CursorAgentManager();
