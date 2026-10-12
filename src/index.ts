/**
 * Constellation MCP: Ecosystem Control Plane MCP Server (stdio) + CLI.
 */
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { AGENT_MAP, ALL_AGENTS, getAgents } from "./agents/index.js";
import { listContracts, showContract, validateContract, validationSummary } from "./contracts/index.js";
import { runDoctor } from "./doctor.js";
import { getGuideTopic, TOPICS } from "./guide.js";
import { checkAllHealth, checkServerHealth } from "./health.js";
import {
  getManifestPath,
  loadManifest,
  saveManifest,
} from "./manifest.js";
import {
  AgentName,
  AgentServerConfig,
  DiffEntry,
  Manifest,
  ServerEntry,
} from "./types.js";
import { getGitRepoState, updateAllServers } from "./update.js";
import {
  errMsg,
  formatTable,
  isSecretKey,
  maskSecretsInEnv,
  maskSecretsInObject,
  VERSION,
} from "./util.js";

export * from "./types.js";
export * from "./util.js";
export * from "./manifest.js";
export * from "./agents/index.js";
export * from "./health.js";
export * from "./doctor.js";
export * from "./update.js";
export * from "./contracts/index.js";
export * from "./guide.js";

type Content = { type: "text"; text: string };
type ToolResult = { content: Content[]; isError?: boolean };

const text = (t: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError: true } : {}),
});

async function safe(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    return text(errMsg(e), true);
  }
}

const INSTRUCTIONS = `Constellation MCP manages the learner's MCP ecosystem — manifest, registration into coding agents, health checks, drift doctor, safe updates, and shared contracts.

Ecosystem members (all by DuongNAD): Polaris (course architect), Aurora Slides (decks), Vega (FSRS memory), Orion (practice labs), Sirius (execution loop), Mira (code tracing), SmartDrive-OS (SSD governance), mcp-agy (Antigravity delegation).

Workflow:
1. eco_status to inspect registered servers and agent sync status.
2. eco_import to bootstrap manifest from existing agent configs.
3. eco_register { dry_run: true } to preview changes, then eco_register to apply with rolling backups.
4. eco_health to verify server connectivity over stdio and list tools.
5. eco_doctor to detect drift between agent configs, check missing paths, and inspect Antigravity copies.
6. eco_update to safely pull (ff-only) and build git-backed servers.
7. eco_contracts to inspect and validate shared ecosystem contracts (aurora-progress-event.v1, vega-card-inbox.v1, mira-embed.v1, personal-data).

Rules:
- Safety first: dry run before writes, never leak secrets (env values matching KEY/TOKEN/SECRET/PASSWORD/AUTH are masked with '***').
- Rolling backups (*.bak.constellation) are created before modifying any agent config.
- Antigravity: open a new conversation 1-2 minutes after restarting the app to ensure tools bind properly.
- Never run recursive scans of D:; open paths directly.

Done when:
Ecosystem manifest is in sync with agent configs, health checks pass, and no drift is detected.`;

export async function getStatusReport(manifest: Manifest, targetServer?: string): Promise<string> {
  const servers = targetServer
    ? manifest.servers.filter((s) => s.name === targetServer)
    : manifest.servers;

  if (servers.length === 0) {
    return targetServer
      ? `Server '${targetServer}' not found in manifest.`
      : `No servers registered in ecosystem manifest (${getManifestPath()}). Run 'eco_import' to import existing servers.`;
  }

  const agentServersMap = new Map<AgentName, Map<string, AgentServerConfig>>();
  for (const agent of ALL_AGENTS) {
    try {
      const sMap = await agent.readServers();
      agentServersMap.set(agent.name, sMap);
    } catch {
      agentServersMap.set(agent.name, new Map());
    }
  }

  const headers = ["Server", "Claude", "Antigravity", "AG CLI", "Cursor", "Codex", "Git Repo", "Command"];
  const rows: string[][] = [];

  for (const server of servers) {
    const agentStatuses = (["claude", "antigravity", "antigravity-cli", "cursor", "codex"] as AgentName[]).map((agentName) => {
      const targetAgents = server.agents ?? ["claude", "antigravity", "antigravity-cli", "cursor", "codex"];
      if (!targetAgents.includes(agentName)) return "-";
      const map = agentServersMap.get(agentName);
      if (!map || !map.has(server.name)) return "MISSING";
      const cfg = map.get(server.name)!;
      if (cfg.command !== server.command || cfg.args.length !== server.args.length) {
        return "DRIFT";
      }
      return "OK";
    });

    const gitState = getGitRepoState(server.path);
    let gitSummary = "-";
    if (gitState.isRepo) {
      gitSummary = `${gitState.branch ?? "git"}${gitState.dirty ? " (dirty)" : " (clean)"}`;
    }

    const cmdStr = `${server.command} ${server.args.slice(0, 1).join(" ")}`;

    rows.push([server.name, ...agentStatuses, gitSummary, cmdStr]);
  }

  const tableStr = formatTable(headers, rows);
  return [
    `Constellation Ecosystem Status (${servers.length} server(s)):`,
    "",
    tableStr,
    "",
    `Manifest: ${getManifestPath()}`,
  ].join("\n");
}

export async function importFromAgents(dryRun = false): Promise<{
  manifest: Manifest;
  added: ServerEntry[];
  summary: string;
}> {
  const currentManifest = loadManifest();
  const existingMap = new Map(currentManifest.servers.map((s) => [s.name, s]));
  const importedMap = new Map<string, ServerEntry>();

  for (const agent of ALL_AGENTS) {
    try {
      const servers = await agent.readServers();
      for (const [name, cfg] of servers.entries()) {
        const existing = importedMap.get(name) ?? existingMap.get(name);
        const agentsList: AgentName[] = existing?.agents ? [...existing.agents] : [];
        if (!agentsList.includes(agent.name)) {
          agentsList.push(agent.name);
        }

        // Clean env: mask or reference secrets
        const cleanEnv: Record<string, string> = {};
        if (cfg.env) {
          for (const [k, v] of Object.entries(cfg.env)) {
            if (isSecretKey(k)) {
              cleanEnv[k] = `\${secret:${k}}`;
            } else {
              cleanEnv[k] = v;
            }
          }
        }

        const entry: ServerEntry = {
          name,
          transport: "stdio",
          command: cfg.command,
          args: cfg.args,
          ...(Object.keys(cleanEnv).length > 0 ? { env: cleanEnv } : {}),
          agents: agentsList,
          description: existing?.description,
          repo: existing?.repo,
          path: existing?.path,
          build: existing?.build,
          test: existing?.test,
          health: existing?.health,
        };
        importedMap.set(name, entry);
      }
    } catch {
      // ignore
    }
  }

  const newServers = Array.from(importedMap.values());
  const added = newServers.filter((s) => !existingMap.has(s.name));

  const updatedManifest: Manifest = {
    version: currentManifest.version || "1",
    servers: newServers,
  };

  if (!dryRun) {
    saveManifest(updatedManifest);
  }

  const lines = [
    dryRun
      ? `Import preview (dry run): Discovered ${newServers.length} server(s) across agent configs.`
      : `Import complete: Saved ${newServers.length} server(s) to ${getManifestPath()}.`,
    "",
    `New servers added (${added.length}):`,
    ...added.map((s) => `  + [${s.name}] ${s.command} ${s.args.join(" ")} (agents: ${s.agents?.join(", ")})`),
  ];

  return {
    manifest: updatedManifest,
    added,
    summary: lines.join("\n"),
  };
}

export async function registerServers(
  serverNames?: string[],
  agentNames?: AgentName[],
  dryRun = false,
): Promise<{ diffs: DiffEntry[]; summary: string }> {
  const manifest = loadManifest();
  const servers = serverNames && serverNames.length > 0
    ? manifest.servers.filter((s) => serverNames.includes(s.name))
    : manifest.servers;

  if (servers.length === 0) {
    return {
      diffs: [],
      summary: serverNames
        ? `None of the requested servers (${serverNames.join(", ")}) found in manifest.`
        : `No servers defined in manifest.`,
    };
  }

  const allDiffs: DiffEntry[] = [];
  const lines: string[] = [
    dryRun ? "Register preview (dry run):" : "Registering servers in coding agents:",
  ];

  const targetAgents = getAgents(agentNames);
  for (const agent of targetAgents) {
    const serversForAgent = servers.filter((s) => {
      if (agentNames && agentNames.length > 0) {
        return agentNames.includes(agent.name);
      }
      const sAgents = s.agents ?? ["claude", "antigravity", "antigravity-cli", "cursor", "codex"];
      return sAgents.includes(agent.name);
    });

    if (serversForAgent.length === 0) continue;

    const diffs = await agent.register(serversForAgent, dryRun);
    allDiffs.push(...diffs);
    for (const d of diffs) {
      if (d.action !== "noop" || d.changes.some((c) => c.toLowerCase().includes("unmanaged"))) {
        lines.push(`[${agent.displayName}] ${d.file}:`);
        d.changes.forEach((c) => lines.push(`  ${c}`));
      }
    }
  }

  const mutatedDiffs = allDiffs.filter(
    (d) => d.action !== "noop" || d.changes.some((c) => c.toLowerCase().includes("unmanaged")),
  );
  if (mutatedDiffs.length === 0) {
    lines.push("All agent configurations are already up to date. No changes required.");
  } else if (!dryRun) {
    lines.push("", "Successfully updated configurations with rolling backups (*.bak.constellation).");
  }

  return { diffs: allDiffs, summary: lines.join("\n") };
}

export async function unregisterServers(
  serverNames: string | string[],
  agentNames?: AgentName[],
  dryRun = false,
  forget = false,
): Promise<{ diffs: DiffEntry[]; summary: string }> {
  const names = Array.isArray(serverNames) ? serverNames : [serverNames];
  if (names.length === 0) {
    return {
      diffs: [],
      summary: "No servers specified to unregister.",
    };
  }

  const targetAgents = getAgents(agentNames);
  const allDiffs: DiffEntry[] = [];
  const namesStr = names.map((n) => `'${n}'`).join(", ");
  const lines: string[] = [
    dryRun
      ? `Unregister preview (dry run) for ${namesStr}:`
      : `Unregistering ${namesStr} from coding agents:`,
  ];

  let manifestChanged = false;
  if (forget) {
    const manifest = loadManifest();
    const manifestPath = getManifestPath();
    const remainingServers = manifest.servers.filter((s) => !names.includes(s.name));
    const removedServers = manifest.servers.filter((s) => names.includes(s.name));

    if (removedServers.length > 0) {
      manifestChanged = true;
      if (dryRun) {
        lines.push(`[Manifest] Would remove ${removedServers.map((s) => `'${s.name}'`).join(", ")} from ${manifestPath}`);
      } else {
        saveManifest({
          ...manifest,
          servers: remainingServers,
        });
        lines.push(`[Manifest] Removed ${removedServers.map((s) => `'${s.name}'`).join(", ")} from ${manifestPath}`);
      }
    } else {
      lines.push(`[Manifest] None of the specified servers were present in manifest (${manifestPath})`);
    }
  }

  for (const agent of targetAgents) {
    const diffs = await agent.unregister(names, dryRun);
    allDiffs.push(...diffs);
    for (const d of diffs) {
      if (d.action !== "noop") {
        lines.push(`[${agent.displayName}] ${d.file}:`);
        d.changes.forEach((c) => lines.push(`  ${c}`));
      }
    }
  }

  const mutatedDiffs = allDiffs.filter((d) => d.action !== "noop");
  if (mutatedDiffs.length === 0 && !manifestChanged) {
    lines.push(`None of the servers (${names.join(", ")}) were present in the targeted agents.`);
  } else if (!dryRun && (mutatedDiffs.length > 0 || manifestChanged)) {
    lines.push("", "Successfully removed server entries with rolling backups.");
  }

  return { diffs: allDiffs, summary: lines.join("\n") };
}

export const unregisterServer = unregisterServers;

/* ───────── MCP Server ───────── */

export async function startMcp(): Promise<void> {
  const server = new McpServer(
    { name: "constellation", version: VERSION },
    { instructions: INSTRUCTIONS },
  );

  /* 1. eco_guide */
  server.registerTool(
    "eco_guide",
    {
      title: "Constellation Ecosystem Guide",
      description:
        "READ FIRST. Architecture and operations guide for the MCP ecosystem control plane: manifest, agents, health checks, drift doctor, safe updates, contracts, and rules.",
      inputSchema: {
        topic: z.enum(TOPICS).optional().describe(`One of: ${TOPICS.join(" | ")}`),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ topic }) => safe(async () => text(await getGuideTopic(topic))),
  );

  /* 2. eco_status */
  server.registerTool(
    "eco_status",
    {
      title: "Ecosystem server registration and sync status",
      description:
        "Overview table of all MCP servers: registration across Claude Code, Antigravity, Cursor, and Codex, git repository status, and commands.",
      inputSchema: {
        server: z.string().optional().describe("Filter by specific server name"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ server: targetServer }) =>
      safe(async () => {
        const manifest = loadManifest();
        const rep = await getStatusReport(manifest, targetServer);
        return text(rep);
      }),
  );

  /* 3. eco_import */
  server.registerTool(
    "eco_import",
    {
      title: "Import servers from agent configs",
      description:
        "Bootstrap or refresh the ecosystem manifest from existing coding agent configurations (Claude, Antigravity, Cursor, Codex). Masks secrets into references.",
      inputSchema: {
        dry_run: z.boolean().default(false).optional().describe("Preview imported servers without saving"),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ dry_run }) =>
      safe(async () => {
        const res = await importFromAgents(dry_run ?? false);
        return text(res.summary);
      }),
  );

  /* 4. eco_register */
  server.registerTool(
    "eco_register",
    {
      title: "Register MCP servers in coding agents",
      description:
        "Register manifest servers into coding agents (Claude Code, Antigravity, Antigravity CLI, Cursor, Codex). Creates rolling backups (*.bak.constellation) and performs atomic writes.",
      inputSchema: {
        servers: z.array(z.string()).optional().describe("Specific server names to register (defaults to all)"),
        agents: z.array(z.enum(["claude", "antigravity", "antigravity-cli", "cursor", "codex"])).optional().describe("Target agents (defaults to server's configured agents)"),
        dry_run: z.boolean().default(false).optional().describe("Preview exact diffs without modifying files"),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ servers, agents, dry_run }) =>
      safe(async () => {
        const res = await registerServers(servers, agents as AgentName[] | undefined, dry_run ?? false);
        return text(res.summary);
      }),
  );

  /* 5. eco_unregister */
  server.registerTool(
    "eco_unregister",
    {
      title: "Unregister MCP servers from coding agents",
      description:
        "Remove one or more MCP servers from coding agent configurations (and optionally from ecosystem manifest). Creates rolling backups and performs atomic writes.",
      inputSchema: {
        server: z.string().optional().describe("Single server name to unregister (or use servers)"),
        servers: z.array(z.string()).optional().describe("Server names to unregister"),
        agents: z.array(z.enum(["claude", "antigravity", "antigravity-cli", "cursor", "codex"])).optional().describe("Target agents (defaults to all)"),
        dry_run: z.boolean().default(false).optional().describe("Preview diffs without modifying files"),
        forget: z.boolean().default(false).optional().describe("Also remove server entries from ecosystem manifest"),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ server: singleServer, servers: multiServers, agents, dry_run, forget }) =>
      safe(async () => {
        const names = multiServers && multiServers.length > 0
          ? multiServers
          : singleServer
            ? [singleServer]
            : [];
        if (names.length === 0) {
          return text("No server specified to unregister.", true);
        }
        const res = await unregisterServers(
          names,
          agents as AgentName[] | undefined,
          dry_run ?? false,
          forget ?? false,
        );
        return text(res.summary);
      }),
  );

  /* 6. eco_health */
  server.registerTool(
    "eco_health",
    {
      title: "Check MCP server health over stdio",
      description:
        "Start servers over stdio using MCP SDK client, initialize, list tools, and report latency, tool counts, and errors.",
      inputSchema: {
        servers: z.array(z.string()).optional().describe("Specific servers to check (defaults to all in manifest)"),
        timeout_ms: z.number().int().min(1000).max(120000).optional().describe("Per-server timeout in milliseconds (default: 20000)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ servers: serverNames, timeout_ms }) =>
      safe(async () => {
        const manifest = loadManifest();
        const targets = serverNames && serverNames.length > 0
          ? manifest.servers.filter((s) => serverNames.includes(s.name))
          : manifest.servers;

        if (targets.length === 0) {
          return text("No matching servers found in manifest to check.");
        }

        const results = await checkAllHealth(targets, timeout_ms);
        const headers = ["Server", "Status", "Version", "Tools", "Time", "Details"];
        const rows = results.map((r) => [
          r.name,
          r.status.toUpperCase(),
          r.version ?? "-",
          r.toolCount !== undefined ? String(r.toolCount) : "-",
          `${r.durationMs}ms`,
          r.status === "ok" ? `${(r.tools ?? []).slice(0, 5).join(", ")}${r.tools && r.tools.length > 5 ? "..." : ""}` : (r.error ?? "Failed"),
        ]);

        const table = formatTable(headers, rows);
        const passed = results.filter((r) => r.status === "ok").length;
        const summary = [
          `MCP Health Checks: ${passed}/${results.length} passed.`,
          "",
          table,
        ].join("\n");

        return text(summary, passed < results.length);
      }),
  );

  /* 7. eco_doctor */
  server.registerTool(
    "eco_doctor",
    {
      title: "Ecosystem doctor and drift diagnostic",
      description:
        "Check config drift across agent files and multiple Antigravity copies, verify script and executable paths, detect unmanaged servers, and audit secrets.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      safe(async () => {
        const manifest = loadManifest();
        const report = await runDoctor(manifest);

        const lines: string[] = [report.summary, ""];

        if (report.issues.length > 0) {
          lines.push("Issues Detected:");
          for (const iss of report.issues) {
            if (iss.category === "unmanaged" || (iss.file && iss.message.includes(iss.file))) {
              lines.push(`  [${iss.severity.toUpperCase()}] (${iss.category}) ${iss.message}`);
            } else {
              const loc = iss.file ?? iss.agent ?? iss.server ?? "general";
              lines.push(`  [${iss.severity.toUpperCase()}] (${iss.category}) at ${loc}: ${iss.message}`);
            }
            if (iss.fix) {
              lines.push(`    Fix: ${iss.fix}`);
            }
          }
          lines.push("");
        }

        if (report.recommendations.length > 0) {
          lines.push("Recommendations:");
          report.recommendations.forEach((r) => lines.push(`  - ${r}`));
        }

        return text(lines.join("\n"), !report.ok);
      }),
  );

  /* 8. eco_update */
  server.registerTool(
    "eco_update",
    {
      title: "Update, build, and test git-backed MCP servers",
      description:
        "Safely updates git repositories with 'git pull --ff-only' (only on clean trees), runs manifest build commands, and runs tests. Never force-pushes or resets.",
      inputSchema: {
        servers: z.array(z.string()).optional().describe("Specific servers to update (defaults to all)"),
        pull: z.boolean().default(true).optional().describe("Run git pull --ff-only"),
        build: z.boolean().default(true).optional().describe("Run server build command"),
        test: z.boolean().default(true).optional().describe("Run server test command"),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ servers: serverNames, pull, build, test }) =>
      safe(async () => {
        const manifest = loadManifest();
        const targets = serverNames && serverNames.length > 0
          ? manifest.servers.filter((s) => serverNames.includes(s.name))
          : manifest.servers;

        if (targets.length === 0) {
          return text("No matching servers found in manifest.");
        }

        const results = await updateAllServers(targets, {
          pull: pull ?? true,
          build: build ?? true,
          test: test ?? true,
        });

        const lines: string[] = [`Update Results for ${targets.length} server(s):`];
        for (const res of results) {
          lines.push(`[${res.server}] Step '${res.step}': ${res.status.toUpperCase()}`);
          if (res.output) {
            lines.push(`  ${res.output.split("\n").join("\n  ")}`);
          }
          if (res.error) {
            lines.push(`  ERROR: ${res.error}`);
          }
        }

        const hasErrors = results.some((r) => r.status === "error");
        return text(lines.join("\n"), hasErrors);
      }),
  );

  /* 9. eco_contracts */
  server.registerTool(
    "eco_contracts",
    {
      title: "Manage and validate shared ecosystem contracts",
      description:
        "List shared contracts, view specifications, or validate data files against contract schemas (aurora-progress-event.v1, vega-card-inbox.v1, mira-embed.v1 and personal-data have validators).",
      inputSchema: {
        action: z.enum(["list", "show", "validate"]).describe("Contract operation to perform"),
        name: z.string().optional().describe("Contract name (e.g. 'aurora-progress-event.v1', 'vega-card-inbox.v1', 'mira-embed.v1', 'personal-data')"),
        file: z.string().optional().describe("Path to data file to validate when action is 'validate'"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ action, name, file }) =>
      safe(async () => {
        if (action === "list") {
          const list = listContracts();
          const headers = ["Contract", "Type", "Title", "Validator"];
          const rows = list.map((c) => [c.name, c.type, c.title, c.hasValidator ? "Yes" : "No"]);
          return text(`Shared Ecosystem Contracts:\n\n${formatTable(headers, rows)}`);
        }

        if (action === "show") {
          if (!name) {
            return text("Missing required 'name' argument for action 'show'.", true);
          }
          return text(showContract(name));
        }

        if (action === "validate") {
          if (!name || !file) {
            return text("Both 'name' and 'file' are required for action 'validate'.", true);
          }
          const res = validateContract(name, resolve(file));
          if (res.ok) {
            return text(`Contract validation PASSED for '${name}': ${validationSummary(res, "mcp")} in ${res.file}`);
          }
          const errLines = res.errors.map((e) =>
            e.line != null ? `  - Line ${e.line}: ${e.message}` : `  - ${e.message}`,
          );
          return text(
            `Contract validation FAILED for '${name}' in ${res.file} (${validationSummary(res, "mcp")}):\n${errLines.join("\n")}`,
            true,
          );
        }

        return text(`Unknown action '${action}'`, true);
      }),
  );

  /* ───────── Prompts ───────── */

  server.registerPrompt(
    "ecosystem_setup",
    {
      title: "Bootstrap and setup MCP ecosystem",
      description: "Guided workflow to import existing agent configs, review, register with dry-run, and run health checks",
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Set up and synchronize the learner's MCP ecosystem:",
              "1. Run `eco_guide` to review architecture and safety rules.",
              "2. Run `eco_import { dry_run: true }` to inspect detected servers from Claude, Antigravity, Cursor, and Codex.",
              "3. Run `eco_import` to save the unified manifest to ~/.constellation/ecosystem.json.",
              "4. Run `eco_register { dry_run: true }` to preview config changes, then `eco_register` to apply them.",
              "5. Run `eco_health` to verify all servers over stdio.",
              "6. Run `eco_doctor` to ensure 0 drift and verify Antigravity copies.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "ecosystem_doctor",
    {
      title: "Diagnose ecosystem health and drift",
      description: "Comprehensive diagnostic to check config drift across agents, check Antigravity consistency, and test health",
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Run a full diagnostic on the MCP ecosystem:",
              "1. Run `eco_doctor` to check drift across all agent configs and verify Antigravity copies.",
              "2. Run `eco_health` to test connectivity and tool registration for every server.",
              "3. If drift is detected, run `eco_register` to reconcile configurations.",
              "4. If git repositories are clean, run `eco_update` to build bundles.",
              "5. Confirm that 0 errors remain.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/* ───────── CLI ───────── */

const HELP = `Constellation MCP ${VERSION}
Control plane for the learner's MCP ecosystem.

Usage: constellation [command] [options]

Commands:
  (no command) | mcp            Run the MCP server on stdio
  status [server]               View server registration and agent sync status
  import [--dry-run]            Bootstrap manifest from existing agent configs
  register [servers...]         Register servers in coding agents
  unregister <servers...>       Unregister servers from coding agents
  health [servers...]           Run stdio health checks and tool discovery
  doctor                        Check config drift, path validity, and Antigravity sync
  update [servers...]           Safely pull (--ff-only), build, and test servers
  contracts <action> [name]     Manage/validate contracts (list | show <name> | validate <name> <file>)
  guide [topic]                 View guide documentation
  version | --version | -v      Print version
  help | --help | -h            Print this help

Options:
  --dry-run                     Preview file modifications without writing
  --forget                      Also remove server entries from manifest
  --json                        Output structured JSON
  --agents=a,b                  Target specific agents (claude, antigravity, antigravity-cli, cursor, codex)
  --timeout=ms                  Health check timeout in milliseconds
  --no-pull                     Skip git pull in update
  --no-build                    Skip build in update
  --no-test                     Skip test in update`;

export async function cli(rawArgs: string[]): Promise<number> {
  const isJson = rawArgs.includes("--json");
  const dryRun = rawArgs.includes("--dry-run");
  const forget = rawArgs.includes("--forget");
  const args = rawArgs.filter((a) => a !== "--json" && a !== "--dry-run" && a !== "--forget");

  const cmd = args[0] || "mcp";
  const target = args[1];

  switch (cmd) {
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;

    case "version":
    case "--version":
    case "-v":
      if (isJson) {
        console.log(JSON.stringify({ version: VERSION }));
      } else {
        console.log(VERSION);
      }
      return 0;

    case "guide": {
      const doc = await getGuideTopic(target);
      console.log(doc);
      return 0;
    }

    case "status": {
      const manifest = loadManifest();
      if (isJson) {
        console.log(JSON.stringify(maskSecretsInObject(manifest), null, 2));
      } else {
        const rep = await getStatusReport(manifest, target);
        console.log(rep);
      }
      return 0;
    }

    case "import": {
      const res = await importFromAgents(dryRun);
      if (isJson) {
        console.log(JSON.stringify(maskSecretsInObject(res), null, 2));
      } else {
        console.log(res.summary);
      }
      return 0;
    }

    case "register": {
      const serverNames = target ? args.slice(1).filter((a) => !a.startsWith("--")) : undefined;
      let agentNames: AgentName[] | undefined;
      const agentsArg = rawArgs.find((a) => a.startsWith("--agents="));
      if (agentsArg) {
        agentNames = agentsArg.slice("--agents=".length).split(",") as AgentName[];
      }
      const res = await registerServers(serverNames, agentNames, dryRun);
      if (isJson) {
        console.log(JSON.stringify(maskSecretsInObject(res), null, 2));
      } else {
        console.log(res.summary);
      }
      return 0;
    }

    case "unregister": {
      const serverNames = args.slice(1).filter((a) => !a.startsWith("--"));
      if (serverNames.length === 0) {
        console.error("Usage: constellation unregister <servers...> [--forget] [--agents=...]");
        return 1;
      }
      let agentNames: AgentName[] | undefined;
      const agentsArg = rawArgs.find((a) => a.startsWith("--agents="));
      if (agentsArg) {
        agentNames = agentsArg.slice("--agents=".length).split(",") as AgentName[];
      }
      const res = await unregisterServers(serverNames, agentNames, dryRun, forget);
      if (isJson) {
        console.log(JSON.stringify(maskSecretsInObject(res), null, 2));
      } else {
        console.log(res.summary);
      }
      return 0;
    }

    case "health": {
      const manifest = loadManifest();
      const serverNames = target ? args.slice(1).filter((a) => !a.startsWith("--")) : undefined;
      const targets = serverNames && serverNames.length > 0
        ? manifest.servers.filter((s) => serverNames.includes(s.name))
        : manifest.servers;

      let timeoutOverride: number | undefined;
      const timeoutArg = rawArgs.find((a) => a.startsWith("--timeout="));
      if (timeoutArg) {
        timeoutOverride = parseInt(timeoutArg.slice("--timeout=".length), 10);
      }

      const results = await checkAllHealth(targets, timeoutOverride);
      if (isJson) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        const headers = ["Server", "Status", "Version", "Tools", "Time", "Details"];
        const rows = results.map((r) => [
          r.name,
          r.status.toUpperCase(),
          r.version ?? "-",
          r.toolCount !== undefined ? String(r.toolCount) : "-",
          `${r.durationMs}ms`,
          r.status === "ok" ? `${(r.tools ?? []).slice(0, 5).join(", ")}${r.tools && r.tools.length > 5 ? "..." : ""}` : (r.error ?? "Failed"),
        ]);
        console.log(formatTable(headers, rows));
      }
      const allPassed = results.every((r) => r.status === "ok");
      return allPassed ? 0 : 1;
    }

    case "doctor": {
      const manifest = loadManifest();
      const report = await runDoctor(manifest);
      if (isJson) {
        console.log(JSON.stringify(maskSecretsInObject(report), null, 2));
      } else {
        console.log(report.summary);
        if (report.issues.length > 0) {
          console.log("\nIssues:");
          for (const iss of report.issues) {
            console.log(`  [${iss.severity.toUpperCase()}] ${iss.message}`);
            if (iss.fix) console.log(`    Fix: ${iss.fix}`);
          }
        }
        if (report.recommendations.length > 0) {
          console.log("\nRecommendations:");
          report.recommendations.forEach((r) => console.log(`  - ${r}`));
        }
      }
      return report.ok ? 0 : 1;
    }

    case "update": {
      const manifest = loadManifest();
      const serverNames = target ? args.slice(1).filter((a) => !a.startsWith("--")) : undefined;
      const targets = serverNames && serverNames.length > 0
        ? manifest.servers.filter((s) => serverNames.includes(s.name))
        : manifest.servers;

      const pull = !rawArgs.includes("--no-pull");
      const build = !rawArgs.includes("--no-build");
      const test = !rawArgs.includes("--no-test");

      const results = await updateAllServers(targets, { pull, build, test });
      if (isJson) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        for (const res of results) {
          console.log(`[${res.server}] ${res.step}: ${res.status.toUpperCase()}`);
          if (res.output) console.log(`  ${res.output}`);
          if (res.error) console.error(`  ERROR: ${res.error}`);
        }
      }
      const hasErrors = results.some((r) => r.status === "error");
      return hasErrors ? 1 : 0;
    }

    case "contracts": {
      const action = target || "list";
      const contractName = args[2];
      const filePath = args[3];

      if (action === "list") {
        const list = listContracts();
        if (isJson) {
          console.log(JSON.stringify(list, null, 2));
        } else {
          const headers = ["Contract", "Type", "Title", "Validator"];
          const rows = list.map((c) => [c.name, c.type, c.title, c.hasValidator ? "Yes" : "No"]);
          console.log(formatTable(headers, rows));
        }
        return 0;
      }

      if (action === "show") {
        if (!contractName) {
          console.error("Usage: constellation contracts show <name>");
          return 1;
        }
        console.log(showContract(contractName));
        return 0;
      }

      if (action === "validate") {
        if (!contractName || !filePath) {
          console.error("Usage: constellation contracts validate <contract_name> <file>");
          return 1;
        }
        const res = validateContract(contractName, resolve(filePath));
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          if (res.ok) {
            console.log(`OK: Contract '${contractName}' valid (${validationSummary(res, "cli")}) in ${res.file}`);
          } else {
            console.error(`FAIL: Contract '${contractName}' validation failed in ${res.file}:`);
            res.errors.forEach((e) => {
              if (e.line != null) {
                console.error(`  Line ${e.line}: ${e.message}`);
              } else {
                console.error(`  ${e.message}`);
              }
            });
          }
        }
        return res.ok ? 0 : 1;
      }

      console.error(`Unknown contracts action '${action}'. Use list, show, or validate.`);
      return 1;
    }

    case "mcp":
    default:
      await startMcp();
      return 0;
  }
}

// Entrypoint execution
const isMain =
  Boolean(process.argv[1]) &&
  (resolve(process.argv[1]!) === fileURLToPath(import.meta.url) ||
    basename(process.argv[1]!).startsWith("constellation"));

if (isMain) {
  const isCli = process.argv.length > 2 && !["mcp"].includes(process.argv[2]!);
  if (isCli) {
    cli(process.argv.slice(2))
      .then((code) => {
        if (code !== 0) process.exit(code);
      })
      .catch((err) => {
        console.error(errMsg(err));
        process.exit(1);
      });
  } else {
    startMcp().catch((err) => {
      console.error("Failed to start Constellation MCP server:", errMsg(err));
      process.exit(1);
    });
  }
}
