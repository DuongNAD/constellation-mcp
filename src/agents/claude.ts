/**
 * Claude Code agent manager.
 * Interacts with Claude Code CLI (or CONSTELLATION_CLAUDE_CMD) and ~/.claude.json.
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { AgentServerConfig, DiffEntry, DoctorIssue, ServerEntry } from "../types.js";
import {
  atomicWriteFile,
  createRollingBackup,
  detectLineEnding,
  errMsg,
  getHomeDir,
  parseCommandString,
} from "../util.js";
import {
  AgentManager,
  buildServerEntryConfig,
  compareServerConfigs,
  formatConfigDiff,
} from "./base.js";

const execFileAsync = promisify(execFile);

export class ClaudeAgentManager implements AgentManager {
  readonly name = "claude" as const;
  readonly displayName = "Claude Code";

  getConfigFile(): string {
    const home = getHomeDir();
    return join(home, ".claude.json");
  }

  getConfigPaths(): string[] {
    return [this.getConfigFile()];
  }

  private getClaudeCommand(): { cmd: string; baseArgs: string[] } | null {
    if (process.env.CONSTELLATION_CLAUDE_CMD) {
      const { cmd, args } = parseCommandString(process.env.CONSTELLATION_CLAUDE_CMD);
      return { cmd, baseArgs: args };
    }
    return { cmd: "claude", baseArgs: [] };
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

  async register(server: ServerEntry, dryRun: boolean): Promise<DiffEntry[]> {
    const filePath = this.getConfigFile();
    const { data, lineEnding } = this.loadRawConfigFile();
    const mcpServers = (data.mcpServers ?? {}) as Record<string, AgentServerConfig>;
    const existing = mcpServers[server.name];
    const newConfig = buildServerEntryConfig(server, existing);

    const diff = formatConfigDiff(this.displayName, filePath, server.name, existing, newConfig);

    if (dryRun || diff.action === "noop") {
      return [diff];
    }

    // Try CLI command if available / configured
    const claudeCmd = this.getClaudeCommand();
    let cliExecuted = false;
    if (claudeCmd) {
      try {
        const args = [...claudeCmd.baseArgs, "mcp", "add", "--scope", "user", server.name, server.command, ...server.args];
        if (newConfig.env) {
          for (const [k, v] of Object.entries(newConfig.env)) {
            args.push("-e", `${k}=${v}`);
          }
        }
        execFileSync(claudeCmd.cmd, args, { stdio: "pipe" });
        cliExecuted = true;
      } catch (e) {
        // Fallback to direct file update if CLI is not present or failed
      }
    }

    // Direct JSON file update
    createRollingBackup(filePath);
    data.mcpServers = {
      ...mcpServers,
      [server.name]: newConfig,
    };
    const rawJson = JSON.stringify(data, null, 2);
    const formatted = lineEnding === "\r\n" ? rawJson.replace(/\n/g, "\r\n") + "\r\n" : rawJson + "\n";
    atomicWriteFile(filePath, formatted);

    return [diff];
  }

  async unregister(serverName: string, dryRun: boolean): Promise<DiffEntry[]> {
    const filePath = this.getConfigFile();
    const { data, lineEnding, exists } = this.loadRawConfigFile();
    const mcpServers = (data.mcpServers ?? {}) as Record<string, AgentServerConfig>;
    const existing = mcpServers[serverName];

    if (!existing && !exists) {
      return [
        {
          agent: this.displayName,
          file: filePath,
          action: "noop",
          changes: [`Server '${serverName}' not present in Claude config`],
        },
      ];
    }

    const diff = formatConfigDiff(this.displayName, filePath, serverName, existing, undefined);

    if (dryRun || diff.action === "noop") {
      return [diff];
    }

    const claudeCmd = this.getClaudeCommand();
    if (claudeCmd) {
      try {
        const args = [...claudeCmd.baseArgs, "mcp", "remove", "--scope", "user", serverName];
        execFileSync(claudeCmd.cmd, args, { stdio: "pipe" });
      } catch {
        // Fallback to direct file update
      }
    }

    if (exists && existing) {
      createRollingBackup(filePath);
      delete mcpServers[serverName];
      data.mcpServers = mcpServers;
      const rawJson = JSON.stringify(data, null, 2);
      const formatted = lineEnding === "\r\n" ? rawJson.replace(/\n/g, "\r\n") + "\r\n" : rawJson + "\n";
      atomicWriteFile(filePath, formatted);
    }

    return [diff];
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
        message: `Claude config file ~/.claude.json not found`,
        fix: `Run 'eco_register' or 'claude mcp add'`,
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
        message: `Server '${server.name}' is missing in ~/.claude.json`,
        fix: `Run 'eco_register' to register '${server.name}' in Claude Code`,
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
          message: `Server '${server.name}' in ~/.claude.json differs from manifest: ${differences.join("; ")}`,
          fix: `Run 'eco_register' to update Claude Code configuration`,
        });
      }
    }

    return issues;
  }
}

export const claudeAgent = new ClaudeAgentManager();
