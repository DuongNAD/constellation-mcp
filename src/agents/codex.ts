/**
 * OpenAI Codex agent manager.
 * Manages ~/.codex/config.toml with minimal, careful TOML edits for [mcp_servers.<name>] tables.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentServerConfig, DiffEntry, DoctorIssue, ServerEntry } from "../types.js";
import {
  atomicWriteFile,
  createRollingBackup,
  detectLineEnding,
  getHomeDir,
  unescapeTomlString,
} from "../util.js";
import {
  AgentManager,
  buildServerEntryConfig,
  compareServerConfigs,
  formatConfigDiff,
} from "./base.js";

interface TomlSectionRange {
  name: string;
  startLine: number; // 0-indexed
  endLine: number; // 0-indexed, exclusive
}

export class CodexAgentManager implements AgentManager {
  readonly name = "codex" as const;
  readonly displayName = "OpenAI Codex";

  getConfigFile(): string {
    const home = getHomeDir();
    return join(home, ".codex", "config.toml");
  }

  getConfigPaths(): string[] {
    return [this.getConfigFile()];
  }

  private parseTomlServers(content: string): Map<string, AgentServerConfig> {
    const servers = new Map<string, AgentServerConfig>();
    const lines = content.split(/\r?\n/);

    let currentServer: string | null = null;
    let inEnvSubtable = false;
    let currentConfig: Partial<AgentServerConfig> = {};

    const commitCurrent = () => {
      if (currentServer && currentConfig.command && Array.isArray(currentConfig.args)) {
        servers.set(currentServer, {
          command: currentConfig.command,
          args: currentConfig.args,
          env: currentConfig.env && Object.keys(currentConfig.env).length > 0 ? currentConfig.env : undefined,
        });
      }
      currentServer = null;
      inEnvSubtable = false;
      currentConfig = {};
    };

    let i = 0;
    while (i < lines.length) {
      const line = lines[i]!.trim();
      if (!line || line.startsWith("#")) {
        i++;
        continue;
      }

      // Check section headers
      const sectionMatch = /^\[([^\]]+)\]/.exec(line);
      if (sectionMatch) {
        const fullSection = sectionMatch[1]!.trim();
        if (fullSection.startsWith("mcp_servers.")) {
          const rest = fullSection.slice("mcp_servers.".length);
          if (rest.endsWith(".env")) {
            const serverName = rest.slice(0, -4).replace(/^"|"$/g, "");
            if (currentServer === serverName) {
              inEnvSubtable = true;
            } else {
              commitCurrent();
              currentServer = serverName;
              inEnvSubtable = true;
            }
          } else {
            commitCurrent();
            currentServer = rest.replace(/^"|"$/g, "");
            inEnvSubtable = false;
          }
        } else {
          commitCurrent();
        }
        i++;
        continue;
      }

      if (currentServer) {
        if (inEnvSubtable) {
          const kvMatch = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
          if (kvMatch) {
            const key = kvMatch[1]!;
            let val = kvMatch[2]!.trim();
            if (val.startsWith('"') && val.endsWith('"')) {
              val = unescapeTomlString(val.slice(1, -1));
            } else if (val.startsWith("'") && val.endsWith("'")) {
              val = val.slice(1, -1);
            }
            currentConfig.env = currentConfig.env ?? {};
            currentConfig.env[key] = val;
          }
        } else {
          if (line.startsWith("command")) {
            const m = /^command\s*=\s*"([^"]*(?:\\.[^"]*)*)"/.exec(line) || /^command\s*=\s*'([^']*)'/.exec(line);
            if (m) {
              currentConfig.command = m[1] !== undefined ? unescapeTomlString(m[1]) : (m[2] ?? "");
            }
          } else if (line.startsWith("args")) {
            // Can be single line or multiline args = ["a", "b"]
            let combined = line;
            while (!combined.includes("]") && i + 1 < lines.length) {
              i++;
              combined += " " + lines[i]!.trim();
            }
            const argsMatch = /args\s*=\s*\[(.*)\]/s.exec(combined);
            if (argsMatch) {
              const rawItems = argsMatch[1]!;
              const parsedArgs: string[] = [];
              const itemRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
              let itemMatch;
              while ((itemMatch = itemRegex.exec(rawItems)) !== null) {
                if (itemMatch[1] !== undefined) {
                  parsedArgs.push(unescapeTomlString(itemMatch[1]));
                } else if (itemMatch[2] !== undefined) {
                  parsedArgs.push(itemMatch[2]);
                }
              }
              currentConfig.args = parsedArgs;
            }
          } else if (line.startsWith("env")) {
            // Inline table env = { KEY = "val", ... }
            const envMatch = /env\s*=\s*\{(.*)\}/.exec(line);
            if (envMatch) {
              const rawPairs = envMatch[1]!;
              const parsedEnv: Record<string, string> = {};
              const pairRegex = /([A-Za-z0-9_]+)\s*=\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)')/g;
              let pairMatch;
              while ((pairMatch = pairRegex.exec(rawPairs)) !== null) {
                const k = pairMatch[1]!;
                const v = pairMatch[2] !== undefined ? unescapeTomlString(pairMatch[2]) : (pairMatch[3] ?? "");
                parsedEnv[k] = v;
              }
              currentConfig.env = parsedEnv;
            }
          }
        }
      }

      i++;
    }

    commitCurrent();
    return servers;
  }

  private findServerSectionRange(lines: string[], serverName: string): TomlSectionRange | null {
    let startLine = -1;
    let endLine = -1;
    const targetHeader = `[mcp_servers.${serverName}]`;
    const targetHeaderQuoted = `[mcp_servers."${serverName}"]`;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (line === targetHeader || line === targetHeaderQuoted) {
        startLine = i;
        break;
      }
    }

    if (startLine === -1) return null;

    // Find the end: until next top-level section that is NOT a subtable of this server
    for (let j = startLine + 1; j < lines.length; j++) {
      const line = lines[j]!.trim();
      if (line.startsWith("[") && line.endsWith("]")) {
        const header = line.slice(1, -1).trim();
        if (
          header === `mcp_servers.${serverName}.env` ||
          header === `mcp_servers."${serverName}".env`
        ) {
          // It's a subtable of the same server
          continue;
        }
        endLine = j;
        break;
      }
    }

    if (endLine === -1) {
      endLine = lines.length;
    }

    return { name: serverName, startLine, endLine };
  }

  private serializeServerToml(serverName: string, cfg: AgentServerConfig): string {
    const formattedArgs = JSON.stringify(cfg.args);
    const lines: string[] = [
      `[mcp_servers.${serverName}]`,
      `command = ${JSON.stringify(cfg.command)}`,
      `args = ${formattedArgs}`,
    ];

    if (cfg.env && Object.keys(cfg.env).length > 0) {
      const envPairs = Object.entries(cfg.env)
        .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
        .join(", ");
      lines.push(`env = { ${envPairs} }`);
    }

    return lines.join("\n");
  }

  async readServers(): Promise<Map<string, AgentServerConfig>> {
    const filePath = this.getConfigFile();
    if (!existsSync(filePath)) {
      return new Map();
    }
    try {
      const content = readFileSync(filePath, "utf8");
      return this.parseTomlServers(content);
    } catch {
      return new Map();
    }
  }

  async register(servers: ServerEntry | ServerEntry[], dryRun: boolean): Promise<DiffEntry[]> {
    const serverList = Array.isArray(servers) ? servers : [servers];
    const diffs: DiffEntry[] = [];
    const filePath = this.getConfigFile();
    const existingServers = await this.readServers();

    const content = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
    const lineEnding = detectLineEnding(content);
    let lines = content ? content.split(/\r?\n/) : [];
    let fileChanged = false;

    for (const server of serverList) {
      const existing = existingServers.get(server.name);
      const newConfig = buildServerEntryConfig(server, existing);
      const diff = formatConfigDiff(this.displayName, filePath, server.name, existing, newConfig);
      diffs.push(diff);

      if (diff.action !== "noop") {
        fileChanged = true;
        const sectionRange = this.findServerSectionRange(lines, server.name);
        const newSectionStr = this.serializeServerToml(server.name, newConfig);
        const newSectionLines = newSectionStr.split("\n");

        if (sectionRange) {
          lines = [
            ...lines.slice(0, sectionRange.startLine),
            ...newSectionLines,
            ...lines.slice(sectionRange.endLine),
          ];
        } else {
          if (lines.length > 0 && lines[lines.length - 1] !== "") {
            lines = [...lines, "", ...newSectionLines];
          } else {
            lines = [...lines, ...newSectionLines];
          }
        }
        existingServers.set(server.name, newConfig);
      }
    }

    if (!dryRun && fileChanged) {
      createRollingBackup(filePath);
      const finalContent =
        lineEnding === "\r\n"
          ? lines.join("\r\n") + "\r\n"
          : lines.join("\n") + "\n";
      atomicWriteFile(filePath, finalContent);
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
          changes: [`Config file ${filePath} not found`],
        });
      }
      return diffs;
    }

    const content = readFileSync(filePath, "utf8");
    const lineEnding = detectLineEnding(content);
    let lines = content.split(/\r?\n/);
    const existingServers = this.parseTomlServers(content);
    let fileChanged = false;

    for (const serverName of namesList) {
      const sectionRange = this.findServerSectionRange(lines, serverName);
      if (!sectionRange) {
        diffs.push({
          agent: this.displayName,
          file: filePath,
          action: "noop",
          changes: [`Server '${serverName}' not found in ${filePath}`],
        });
        continue;
      }

      const existing = existingServers.get(serverName);
      const diff = formatConfigDiff(this.displayName, filePath, serverName, existing, undefined);
      diffs.push(diff);

      if (diff.action !== "noop") {
        fileChanged = true;
        lines = [
          ...lines.slice(0, sectionRange.startLine),
          ...lines.slice(sectionRange.endLine),
        ];
        existingServers.delete(serverName);
      }
    }

    if (!dryRun && fileChanged) {
      // Trim trailing extra blank lines
      while (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }

      createRollingBackup(filePath);
      const finalContent =
        lineEnding === "\r\n"
          ? lines.join("\r\n") + "\r\n"
          : lines.join("\n") + "\n";
      atomicWriteFile(filePath, finalContent);
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
        message: `Codex config file ~/.codex/config.toml not found`,
        fix: `Run 'eco_register' to create Codex MCP configuration`,
      });
      return issues;
    }

    const servers = await this.readServers();
    const cfg = servers.get(server.name);

    if (!cfg) {
      issues.push({
        severity: "error",
        category: "drift",
        agent: this.displayName,
        server: server.name,
        file: filePath,
        message: `Server '${server.name}' is missing in ~/.codex/config.toml`,
        fix: `Run 'eco_register' to register '${server.name}' in Codex`,
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
          message: `Server '${server.name}' in ~/.codex/config.toml differs from manifest: ${differences.join("; ")}`,
          fix: `Run 'eco_register' to update Codex configuration`,
        });
      }
    }

    return issues;
  }
}

export const codexAgent = new CodexAgentManager();
