/**
 * Ecosystem Doctor & Drift Diagnostic Engine.
 */
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { ALL_AGENTS } from "./agents/index.js";
import { DoctorIssue, DoctorReport, Manifest, ServerEntry } from "./types.js";
import { isSecretKey, isSecretReference } from "./util.js";

export async function runDoctor(manifest: Manifest): Promise<DoctorReport> {
  const issues: DoctorIssue[] = [];
  let antigravityConsistent = true;
  let driftCount = 0;
  let missingPathsCount = 0;
  let agentConfigsChecked = 0;

  const manifestServerNames = new Set(manifest.servers.map((s) => s.name));

  // If manifest is empty, say so and suggest import
  if (manifest.servers.length === 0) {
    for (const agent of ALL_AGENTS) {
      agentConfigsChecked += agent.getConfigPaths().filter((p) => existsSync(p)).length;

      try {
        const agentServers = await agent.readServers();
        const unmanaged = Array.from(agentServers.keys()).sort();
        if (unmanaged.length > 0) {
          issues.push({
            severity: "info",
            category: "unmanaged",
            agent: agent.displayName,
            message: `${agent.displayName}: ${unmanaged.length} unmanaged: ${unmanaged.join(", ")}`,
            fix: `Run 'eco_import' to add unmanaged servers to ecosystem.json`,
          });
        }
      } catch {
        // ignore
      }
    }

    const recommendations = [
      "Manifest is empty. Run 'eco_import' (or 'constellation import') to discover and import existing servers from agent configs.",
      "Antigravity note: Tools bind when a conversation starts. Open a new conversation 1-2 minutes after starting/restarting the app.",
    ];

    const summary = "Manifest is empty (0 servers configured). Run 'eco_import' to import servers from agent configs.";

    return {
      ok: true,
      summary,
      issues,
      antigravityConsistent: true,
      recommendations,
      stats: {
        manifestServers: 0,
        agentConfigsChecked,
        driftCount: 0,
        missingPathsCount: 0,
      },
    };
  }

  // 1. Check for duplicate server names in manifest
  const seenNames = new Set<string>();
  for (const server of manifest.servers) {
    const lower = server.name.toLowerCase();
    if (seenNames.has(lower)) {
      issues.push({
        severity: "error",
        category: "duplicate",
        server: server.name,
        message: `Duplicate server name '${server.name}' found in manifest`,
        fix: `Rename or remove the duplicate server entry in ecosystem.json`,
      });
    }
    seenNames.add(lower);
  }

  // 2. Check secret leaks in manifest
  for (const server of manifest.servers) {
    if (server.env) {
      for (const [k, v] of Object.entries(server.env)) {
        if (isSecretKey(k) && !isSecretReference(v)) {
          issues.push({
            severity: "warning",
            category: "secret_leak",
            server: server.name,
            message: `Secret env var '${k}' in server '${server.name}' has plaintext value instead of \${secret:${k}}`,
            fix: `Replace raw secret with '\${secret:${k}}' in ecosystem.json`,
          });
        }
      }
    }
  }

  // 3. Check paths & script executables
  for (const server of manifest.servers) {
    if (server.path) {
      const absPath = resolve(server.path);
      if (!existsSync(absPath)) {
        missingPathsCount++;
        issues.push({
          severity: "error",
          category: "missing_path",
          server: server.name,
          message: `Server workspace path '${server.path}' does not exist on disk`,
          fix: `Verify the 'path' property in ecosystem.json`,
        });
      }
    }

    // Check command if absolute path
    if (isAbsolute(server.command) && !existsSync(server.command)) {
      missingPathsCount++;
      issues.push({
        severity: "error",
        category: "missing_path",
        server: server.name,
        message: `Server executable '${server.command}' does not exist on disk`,
        fix: `Update 'command' to a valid executable path`,
      });
    }

    // Check script arguments (e.g. .mjs, .js, .py files)
    for (const arg of server.args) {
      if (
        /\.(m?js|py|ts|sh|cmd|bat)$/i.test(arg) &&
        !arg.startsWith("-") &&
        (isAbsolute(arg) || (server.path && !arg.startsWith("http")))
      ) {
        const targetPath = isAbsolute(arg) ? arg : server.path ? resolve(server.path, arg) : null;
        if (targetPath && !existsSync(targetPath)) {
          missingPathsCount++;
          issues.push({
            severity: "error",
            category: "missing_path",
            server: server.name,
            message: `Target script file '${arg}' does not exist on disk (${targetPath})`,
            fix: `Build the project or check the script path in args`,
          });
        }
      }
    }
  }

  // 4. Check Drift across all agents
  for (const agent of ALL_AGENTS) {
    agentConfigsChecked += agent.getConfigPaths().filter((p) => existsSync(p)).length;

    for (const server of manifest.servers) {
      // Check if server is configured for this agent
      const targetAgents = server.agents ?? ["claude", "antigravity", "antigravity-cli", "cursor", "codex"];
      if (targetAgents.includes(agent.name)) {
        const agentIssues = await agent.checkDrift(server);
        for (const iss of agentIssues) {
          if (iss.category === "antigravity_drift") {
            antigravityConsistent = false;
          }
          if (iss.category === "drift" || iss.category === "antigravity_drift") {
            driftCount++;
          }
          issues.push(iss);
        }
      }
    }

    // 5. Detect unmanaged servers in agent configs (grouped into one line per agent)
    try {
      const agentServers = await agent.readServers();
      const unmanaged: string[] = [];
      for (const name of agentServers.keys()) {
        if (!manifestServerNames.has(name)) {
          unmanaged.push(name);
        }
      }
      if (unmanaged.length > 0) {
        unmanaged.sort();
        issues.push({
          severity: "info",
          category: "unmanaged",
          agent: agent.displayName,
          message: `${agent.displayName}: ${unmanaged.length} unmanaged: ${unmanaged.join(", ")}`,
          fix: `Run 'eco_import' to add unmanaged servers to ecosystem.json`,
        });
      }
    } catch {
      // ignore
    }
  }

  // Build recommendations
  const recommendations: string[] = [];
  if (driftCount > 0) {
    recommendations.push("Run 'eco_register' (or 'constellation register') to resolve config drift across coding agents.");
  }
  if (!antigravityConsistent) {
    recommendations.push("Antigravity config files are out of sync. Run 'eco_register' to reconcile all copies.");
  }
  if (missingPathsCount > 0) {
    recommendations.push("Check missing file paths and build missing bundles with 'eco_update' or your build scripts.");
  }

  recommendations.push(
    "Antigravity note: Tools bind when a conversation starts. Open a new conversation 1-2 minutes after starting/restarting the app.",
  );

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const ok = errorCount === 0;

  const summary = ok
    ? `Doctor check passed: ${manifest.servers.length} server(s) healthy across ${agentConfigsChecked} agent config file(s).`
    : `Doctor found ${errorCount} error(s) and ${issues.length - errorCount} notice(s) across ${manifest.servers.length} server(s).`;

  return {
    ok,
    summary,
    issues,
    antigravityConsistent,
    recommendations,
    stats: {
      manifestServers: manifest.servers.length,
      agentConfigsChecked,
      driftCount,
      missingPathsCount,
    },
  };
}
