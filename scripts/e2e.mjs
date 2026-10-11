#!/usr/bin/env node
/**
 * End-to-end integration and MCP stdio client tests for Constellation MCP.
 *
 * Runs all tests in an isolated %TEMP% environment without modifying real configs.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function findToolchain() {
  if (process.env.CONSTELLATION_TOOLCHAIN && existsSync(process.env.CONSTELLATION_TOOLCHAIN)) {
    return resolve(process.env.CONSTELLATION_TOOLCHAIN);
  }
  const candidates = [];
  if (process.env.LOCALAPPDATA) {
    candidates.push(join(process.env.LOCALAPPDATA, "aurora-slides", "toolchain"));
    candidates.push(
      join(
        process.env.LOCALAPPDATA,
        "Packages",
        "Claude_pzs8sxrjxfjjc",
        "LocalCache",
        "Local",
        "aurora-slides",
        "toolchain",
      ),
    );
  }
  candidates.push(join(homedir(), "AppData", "Local", "aurora-slides", "toolchain"));
  candidates.push(
    join(
      homedir(),
      "AppData",
      "Local",
      "Packages",
      "Claude_pzs8sxrjxfjjc",
      "LocalCache",
      "Local",
      "aurora-slides",
      "toolchain",
    ),
  );
  if (process.env.XDG_CACHE_HOME) {
    candidates.push(join(process.env.XDG_CACHE_HOME, "aurora-slides", "toolchain"));
  }
  candidates.push(join(homedir(), ".cache", "aurora-slides", "toolchain"));

  for (const c of candidates) {
    if (existsSync(join(c, "node_modules", "@modelcontextprotocol", "sdk"))) {
      return resolve(c);
    }
  }
  return resolve(candidates[0] ?? join(homedir(), ".cache", "aurora-slides", "toolchain"));
}

const TOOL = findToolchain();
const req = createRequire(join(TOOL, "package.json"));
const { Client } = req("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = req("@modelcontextprotocol/sdk/client/stdio.js");

/* ───────── Setup Temp Isolated Environment ───────── */
const TEST_DIR = join(tmpdir(), `constellation_e2e_${Date.now()}`);
rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(TEST_DIR, { recursive: true });

const FAKE_HOME = join(TEST_DIR, "fake_home");
const FAKE_CONSTELLATION = join(FAKE_HOME, ".constellation");
mkdirSync(FAKE_HOME, { recursive: true });
mkdirSync(FAKE_CONSTELLATION, { recursive: true });

// Setup fake agent config locations
const AG_DIR1 = join(FAKE_HOME, ".gemini", "antigravity");
const AG_DIR2 = join(FAKE_HOME, ".gemini", "config");
const AG_DIR3 = join(FAKE_HOME, ".gemini", "antigravity-ide");
const AG_CLI_DIR = join(FAKE_HOME, ".gemini", "antigravity-cli");
mkdirSync(AG_DIR1, { recursive: true });
mkdirSync(AG_DIR2, { recursive: true });
mkdirSync(AG_DIR3, { recursive: true });
mkdirSync(AG_CLI_DIR, { recursive: true });

const CURSOR_DIR = join(FAKE_HOME, ".cursor");
mkdirSync(CURSOR_DIR, { recursive: true });

const CODEX_DIR = join(FAKE_HOME, ".codex");
mkdirSync(CODEX_DIR, { recursive: true });

// 1. Initial Antigravity config with CRLF and unrelated server with secret
const FAKE_SECRET_VALUE = "super_secret_token_value_998877";
const initialAgConfig = {
  mcpServers: {
    "unrelated-secret-server": {
      command: "node",
      args: ["unrelated.js"],
      env: {
        CUSTOM_SECRET_AUTH_TOKEN: FAKE_SECRET_VALUE,
        PUBLIC_VAR: "public_value",
      },
    },
  },
};
const agConfigCrlf = JSON.stringify(initialAgConfig, null, 2).replace(/\n/g, "\r\n") + "\r\n";
writeFileSync(join(AG_DIR1, "mcp_config.json"), agConfigCrlf, "utf8");
writeFileSync(join(AG_DIR2, "mcp_config.json"), agConfigCrlf, "utf8");
writeFileSync(join(AG_DIR3, "mcp_config.json"), agConfigCrlf, "utf8");
writeFileSync(join(AG_CLI_DIR, "mcp_config.json"), JSON.stringify({ mcpServers: {} }, null, 2) + "\n", "utf8");

// 2. Initial Codex config.toml
const initialCodexToml = `# Codex Configuration
[general]
model = "codex-test"

[mcp_servers.legacy_tool]
command = "node"
args = ["legacy.js"]
`;
writeFileSync(join(CODEX_DIR, "config.toml"), initialCodexToml, "utf8");

// 3. Initial Cursor config with legacy tools to test unmanaged grouping
const initialCursorConfig = {
  mcpServers: {
    "cursor_tool_alpha": {
      command: "node",
      args: ["alpha.js"],
    },
    "cursor_tool_beta": {
      command: "node",
      args: ["beta.js"],
    },
  },
};
writeFileSync(join(CURSOR_DIR, "mcp.json"), JSON.stringify(initialCursorConfig, null, 2) + "\n", "utf8");

// 4. Initial Claude config
writeFileSync(join(FAKE_HOME, ".claude.json"), JSON.stringify({ mcpServers: {} }, null, 2) + "\n", "utf8");

// 5. Fake Claude CLI script that logs args
const FAKE_CLAUDE_LOG = join(TEST_DIR, "claude_args.log");
const FAKE_CLAUDE_SCRIPT = join(TEST_DIR, "fake_claude.mjs");
writeFileSync(
  FAKE_CLAUDE_SCRIPT,
  `import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const logPath = ${JSON.stringify(FAKE_CLAUDE_LOG)};
const home = ${JSON.stringify(FAKE_HOME)};
const args = process.argv.slice(2);
appendFileSync(logPath, args.join(" ") + "\\n", "utf8");

const claudeFile = join(home, ".claude.json");
let data = { mcpServers: {} };
if (existsSync(claudeFile)) {
  try { data = JSON.parse(readFileSync(claudeFile, "utf8")); } catch {}
}
if (args[0] === "mcp" && args[1] === "add") {
  const name = args[4];
  const command = args[5];
  const serverArgs = args.slice(6);
  data.mcpServers[name] = { command, args: serverArgs };
  writeFileSync(claudeFile, JSON.stringify(data, null, 2) + "\\n");
} else if (args[0] === "mcp" && args[1] === "remove") {
  const name = args[4];
  delete data.mcpServers[name];
  writeFileSync(claudeFile, JSON.stringify(data, null, 2) + "\\n");
}
`,
  "utf8",
);

// 6. Fake working MCP server script (stdio)
const FAKE_SERVER_SCRIPT = join(TEST_DIR, "fake_server.mjs");
writeFileSync(
  FAKE_SERVER_SCRIPT,
  `import { createRequire } from "node:module";
const require = createRequire(${JSON.stringify(join(TOOL, "package.json"))});
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const server = new McpServer({ name: "fake-server", version: "1.0.0" });
server.registerTool("tool_alpha", { inputSchema: { text: z.string().optional() } }, async () => ({ content: [{ type: "text", text: "alpha" }] }));
server.registerTool("tool_beta", { inputSchema: {} }, async () => ({ content: [{ type: "text", text: "beta" }] }));
server.registerTool("tool_gamma", { inputSchema: {} }, async () => ({ content: [{ type: "text", text: "gamma" }] }));

const transport = new StdioServerTransport();
await server.connect(transport);
`,
  "utf8",
);

// 7. Fake broken MCP server script
const BROKEN_SERVER_SCRIPT = join(TEST_DIR, "broken_server.mjs");
writeFileSync(
  BROKEN_SERVER_SCRIPT,
  `console.error("FATAL: Server failed to start");
process.exit(1);
`,
  "utf8",
);

// Set test environment variables
const testEnv = {
  ...process.env,
  USERPROFILE: FAKE_HOME,
  HOME: FAKE_HOME,
  CONSTELLATION_HOME: FAKE_CONSTELLATION,
  CONSTELLATION_CLAUDE_CMD: `node "${FAKE_CLAUDE_SCRIPT}"`,
  CONSTELLATION_TOOLCHAIN: TOOL,
};

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};
const textOf = (r) => (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

/* ───────── Start Real MCP Client over stdio ───────── */
console.log("\n--- Real MCP Server Stdio Tests ---");

const client = new Client({ name: "constellation-e2e", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(ROOT, "dist", "constellation.mjs")],
  stderr: "inherit",
  env: testEnv,
});

await client.connect(transport);
const call = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 30000 });

try {
  // Test server identification and instructions
  const info = client.getServerVersion();
  ok("server identifies itself as constellation", info?.name === "constellation", `${info?.name} ${info?.version}`);
  ok("server version is 0.1.6", info?.version === "0.1.6", info?.version);
  const instructions = client.getInstructions() ?? "";
  ok("server sends instructions with workflow and rules", instructions.includes("Workflow:") && instructions.includes("Rules:"));

  // Check registered tools
  const { tools } = await client.listTools();
  const toolNames = tools.map((t) => t.name).sort();
  ok(
    "all 9 tools registered",
    toolNames.length === 9 &&
      toolNames.includes("eco_guide") &&
      toolNames.includes("eco_status") &&
      toolNames.includes("eco_import") &&
      toolNames.includes("eco_register") &&
      toolNames.includes("eco_unregister") &&
      toolNames.includes("eco_health") &&
      toolNames.includes("eco_doctor") &&
      toolNames.includes("eco_update") &&
      toolNames.includes("eco_contracts"),
    toolNames.join(", "),
  );

  // Check prompts
  const { prompts } = await client.listPrompts();
  const promptNames = prompts.map((p) => p.name).sort();
  ok(
    "prompts listed (ecosystem_setup, ecosystem_doctor)",
    promptNames.includes("ecosystem_setup") && promptNames.includes("ecosystem_doctor"),
    promptNames.join(", "),
  );

  // 1. eco_guide
  let r = await call("eco_guide");
  ok("eco_guide overview", !r.isError && textOf(r).includes("Available topics:"));
  r = await call("eco_guide", { topic: "manifest" });
  ok("eco_guide manifest topic", !r.isError && textOf(r).includes("ecosystem.json"));

  // Test doctor on empty manifest before import
  r = await call("eco_doctor");
  const emptyDoctorText = textOf(r);
  ok(
    "doctor reports empty manifest with import suggestion",
    !r.isError && emptyDoctorText.includes("Manifest is empty (0 servers configured)") && emptyDoctorText.includes("eco_import"),
  );

  // 2. eco_import: bootstrap manifest & verify secret reference + masking
  r = await call("eco_import");
  const importText = textOf(r);
  ok("eco_import succeeds", !r.isError && importText.includes("Import complete:"));
  ok(
    "import output never prints plaintext secret",
    !importText.includes(FAKE_SECRET_VALUE),
    "secret was masked in output",
  );

  const manifestPath = join(FAKE_CONSTELLATION, "ecosystem.json");
  ok("ecosystem.json created on disk", existsSync(manifestPath));
  const manifestContent = readFileSync(manifestPath, "utf8");
  ok(
    "manifest replaces secret with ${secret:CUSTOM_SECRET_AUTH_TOKEN}",
    manifestContent.includes("${secret:CUSTOM_SECRET_AUTH_TOKEN}") && !manifestContent.includes(FAKE_SECRET_VALUE),
    "secret converted to reference",
  );

  // 3. Add fake_server and broken_server to manifest (targeted at antigravity, NOT antigravity-cli)
  const manifestObj = JSON.parse(manifestContent);
  manifestObj.servers.push(
    {
      name: "fake-test-server",
      transport: "stdio",
      command: "node",
      args: [FAKE_SERVER_SCRIPT],
      agents: ["claude", "antigravity", "cursor", "codex"],
      health: { timeoutMs: 15000 },
    },
    {
      name: "broken-test-server",
      transport: "stdio",
      command: "node",
      args: [BROKEN_SERVER_SCRIPT],
      agents: ["antigravity", "claude"],
      health: { timeoutMs: 5000 },
    },
  );
  writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2) + "\n", "utf8");

  // 4. eco_register with dry_run
  const ag1Path = join(AG_DIR1, "mcp_config.json");
  const ag1Before = readFileSync(ag1Path, "utf8");
  r = await call("eco_register", { dry_run: true });
  ok("eco_register dry_run preview", !r.isError && textOf(r).includes("Register preview (dry run):"));
  const ag1AfterDryRun = readFileSync(ag1Path, "utf8");
  ok("dry_run leaves disk files untouched", ag1Before === ag1AfterDryRun);

  // 5. eco_register apply (registering 2 servers in one run)
  r = await call("eco_register");
  ok("eco_register apply succeeds", !r.isError && textOf(r).includes("Successfully updated configurations"));

  // Check that rolling backup *.bak.constellation was created once and equals the original file before the run
  const ag1BackupPath = join(AG_DIR1, "mcp_config.json.bak.constellation");
  ok("rolling backup *.bak.constellation created for Antigravity", existsSync(ag1BackupPath));
  const ag1BackupContent = readFileSync(ag1BackupPath, "utf8");
  ok(
    "Antigravity rolling backup is equal to original file before the run",
    ag1BackupContent === agConfigCrlf,
    "one backup per file per run",
  );

  const codexBackupPath = join(CODEX_DIR, "config.toml.bak.constellation");
  ok("rolling backup created for Codex config.toml", existsSync(codexBackupPath));
  const codexBackupContent = readFileSync(codexBackupPath, "utf8");
  ok(
    "Codex rolling backup is equal to original TOML file before the run",
    codexBackupContent === initialCodexToml,
  );

  // Check CRLF preserved in Antigravity
  const ag1After = readFileSync(ag1Path, "utf8");
  ok("Antigravity config preserves CRLF line endings", ag1After.includes("\r\n"));
  ok("Antigravity preserves unrelated server entry with secret", ag1After.includes("unrelated-secret-server") && ag1After.includes(FAKE_SECRET_VALUE));
  ok("Antigravity registered fake-test-server", ag1After.includes("fake-test-server"));
  ok("Antigravity registered broken-test-server", ag1After.includes("broken-test-server"));

  // Check that antigravity-cli config was NOT modified (server targeted at antigravity, not antigravity-cli)
  const agCliPath = join(AG_CLI_DIR, "mcp_config.json");
  const agCliContent = readFileSync(agCliPath, "utf8");
  ok(
    "server targeted at antigravity is not added to antigravity-cli file",
    !agCliContent.includes("fake-test-server") && !agCliContent.includes("broken-test-server"),
  );

  // Check Codex TOML preserved comments and general section
  const codexAfter = readFileSync(join(CODEX_DIR, "config.toml"), "utf8");
  ok("Codex TOML preserves comments and [general]", codexAfter.includes("# Codex Configuration") && codexAfter.includes("[general]") && codexAfter.includes("[mcp_servers.fake-test-server]"));

  // Check Claude Fake CLI logged execution
  const claudeLog = existsSync(FAKE_CLAUDE_LOG) ? readFileSync(FAKE_CLAUDE_LOG, "utf8") : "";
  ok("Claude Code CLI executed with mcp add", claudeLog.includes("mcp add --scope user fake-test-server"));

  // Check idempotency: calling eco_register again produces no diffs
  r = await call("eco_register");
  ok("eco_register is idempotent (no changes on rerun)", !r.isError && textOf(r).includes("All agent configurations are already up to date"));

  // Real Claude Code entries carry "type": "stdio" and an empty env block; neither is a difference.
  const claudePath = join(FAKE_HOME, ".claude.json");
  const claudeData = JSON.parse(readFileSync(claudePath, "utf8"));
  for (const entry of Object.values(claudeData.mcpServers)) Object.assign(entry, { type: "stdio", env: {} });
  writeFileSync(claudePath, JSON.stringify(claudeData, null, 2) + String.fromCharCode(10), "utf8");
  r = await call("eco_register", { dry_run: true });
  const claudeParts = textOf(r).split("[Claude Code]").slice(1);
  const claudeUpdates = claudeParts.filter((part) => part.split("[Google")[0].split("[Cursor")[0].split("[OpenAI")[0].includes("~ Update"));
  ok("type stdio and empty env in Claude entries are not reported as changes", !r.isError && claudeUpdates.length === 0, claudeUpdates.length + " Claude update(s)");

  // 6. eco_status
  r = await call("eco_status");
  ok("eco_status outputs matrix table", !r.isError && textOf(r).includes("Constellation Ecosystem Status") && textOf(r).includes("fake-test-server"));

  // 7. Drift detection in eco_doctor & unmanaged grouping
  // Add unmanaged servers in Cursor to verify grouping
  const cursorFile = join(CURSOR_DIR, "mcp.json");
  const cursorData = JSON.parse(readFileSync(cursorFile, "utf8"));
  cursorData.mcpServers["extra_unmanaged_1"] = { command: "node", args: ["u1.js"] };
  cursorData.mcpServers["extra_unmanaged_2"] = { command: "node", args: ["u2.js"] };
  writeFileSync(cursorFile, JSON.stringify(cursorData, null, 2) + "\n", "utf8");

  r = await call("eco_doctor");
  const docTextWithUnmanaged = textOf(r);
  ok(
    "doctor groups unmanaged servers into one line per agent",
    docTextWithUnmanaged.includes("Cursor IDE: 2 unmanaged: extra_unmanaged_1, extra_unmanaged_2"),
    "grouped line found",
  );
  ok(
    "doctor reports no drift for server not targeted at antigravity-cli",
    !docTextWithUnmanaged.includes("Antigravity CLI config file") && !docTextWithUnmanaged.includes("missing in") && !docTextWithUnmanaged.includes("fake-test-server' is missing in"),
  );

  // Clean up extra unmanaged servers
  delete cursorData.mcpServers["extra_unmanaged_1"];
  delete cursorData.mcpServers["extra_unmanaged_2"];
  writeFileSync(cursorFile, JSON.stringify(cursorData, null, 2) + "\n", "utf8");

  // Simulate hand-edited drift in Antigravity copy 2
  const ag2Path = join(AG_DIR2, "mcp_config.json");
  const ag2Data = JSON.parse(readFileSync(ag2Path, "utf8"));
  ag2Data.mcpServers["fake-test-server"].command = "node_drifted";
  writeFileSync(ag2Path, JSON.stringify(ag2Data, null, 2).replace(/\n/g, "\r\n") + "\r\n", "utf8");

  r = await call("eco_doctor");
  const doctorText = textOf(r);
  ok("eco_doctor detects drift between Antigravity copies", r.isError && (doctorText.includes("Antigravity config mismatch") || doctorText.includes("differs from manifest")));
  ok("eco_doctor includes Antigravity timing recommendation", doctorText.includes("Antigravity note: Tools bind when a conversation starts"));

  // Reconcile drift with eco_register
  await call("eco_register");
  r = await call("eco_doctor");
  ok("eco_doctor reports clean after eco_register reconcile", !r.isError && textOf(r).includes("Doctor check passed"));

  // 7b. Constellation 0.1.5: UTF-8 BOM tolerance, single parse error reporting, env drift & register merge
  // Test A: A BOM config is parsed & the doctor notice appears
  const ag2Content = readFileSync(ag2Path, "utf8");
  const ag2WithBom = "\uFEFF" + (ag2Content.startsWith("\uFEFF") ? ag2Content.slice(1) : ag2Content);
  writeFileSync(ag2Path, ag2WithBom, "utf8");
  ok("ag2 file written with UTF-8 BOM", readFileSync(ag2Path, "utf8").charCodeAt(0) === 0xfeff);

  r = await call("eco_doctor");
  const bomDoctorText = textOf(r);
  ok(
    "the doctor notice appears for BOM config",
    bomDoctorText.includes("starts with a UTF-8 BOM; some JSON parsers reject it; the next register rewrites it without one"),
  );
  ok("a BOM config is parsed without missing server errors", !bomDoctorText.includes("missing in"));

  // Test B: A broken JSON config gives exactly one error, never server missing for every server
  const savedCursorContent = readFileSync(cursorFile, "utf8");
  writeFileSync(cursorFile, "{ broken json content: invalid syntax", "utf8");
  r = await call("eco_doctor");
  const brokenDoctorText = textOf(r);
  ok("doctor detects broken JSON as error", r.isError && brokenDoctorText.includes("Failed to parse"));
  const parseErrorsForCursor = brokenDoctorText.split("\n").filter((l) => l.includes("Failed to parse") && l.includes("mcp.json"));
  const missingErrorsForCursor = brokenDoctorText.split("\n").filter((l) => l.includes("missing in") && l.includes("mcp.json"));
  ok("a broken JSON config gives exactly one error", parseErrorsForCursor.length === 1);
  ok("broken JSON never reports server missing for every server", missingErrorsForCursor.length === 0);
  // Restore cursor file
  writeFileSync(cursorFile, savedCursorContent, "utf8");

  // Test C: Env drift: doctor reports env keys in agent but not in manifest (masked), with fix
  const ag1Data = JSON.parse(readFileSync(ag1Path, "utf8").replace(/^\uFEFF/, ""));
  const FAKE_EXTRA_SECRET = "secret_custom_token_val_4321";
  ag1Data.mcpServers["fake-test-server"].env = {
    ...(ag1Data.mcpServers["fake-test-server"].env || {}),
    CUSTOM_EXTRA_SECRET_KEY: FAKE_EXTRA_SECRET,
  };
  writeFileSync(ag1Path, JSON.stringify(ag1Data, null, 2).replace(/\n/g, "\r\n") + "\r\n", "utf8");

  r = await call("eco_doctor");
  const envDriftText = textOf(r);
  ok("drift is reported by key name", envDriftText.includes("CUSTOM_EXTRA_SECRET_KEY"));
  ok("drift never prints secret value in doctor output", !envDriftText.includes(FAKE_EXTRA_SECRET));
  ok(
    "doctor provides fix instruction with secret placeholder",
    envDriftText.includes("add ${secret:CUSTOM_EXTRA_SECRET_KEY} to the server's env in ecosystem.json and the value to ~/.constellation/secrets.json or the process environment"),
  );

  // Test D: Dry-run register reports kept unmanaged env key masked
  r = await call("eco_register", { dry_run: true });
  const dryRunText = textOf(r);
  ok(
    "drift is reported with the value masked in dry-run",
    dryRunText.includes("CUSTOM_EXTRA_SECRET_KEY") && dryRunText.includes("***") && !dryRunText.includes(FAKE_EXTRA_SECRET),
  );

  // Test E: Register keeps unknown env key and writes the file without a BOM
  r = await call("eco_register");
  const ag1AfterMerge = JSON.parse(readFileSync(ag1Path, "utf8").replace(/^\uFEFF/, ""));
  ok(
    "register keeps an unknown env key",
    ag1AfterMerge.mcpServers["fake-test-server"]?.env?.CUSTOM_EXTRA_SECRET_KEY === FAKE_EXTRA_SECRET,
  );
  const ag2AfterRaw = readFileSync(ag2Path, "utf8");
  ok("register writes the file without a BOM", ag2AfterRaw.charCodeAt(0) !== 0xfeff);

  // Clean up extra env key for subsequent tests so eco_health and following checks have clean state
  delete ag1Data.mcpServers["fake-test-server"].env.CUSTOM_EXTRA_SECRET_KEY;
  writeFileSync(ag1Path, JSON.stringify(ag1Data, null, 2).replace(/\n/g, "\r\n") + "\r\n", "utf8");
  await call("eco_register");

  // 8. eco_health checks
  r = await call("eco_health");
  const healthText = textOf(r);
  ok("eco_health checks servers over stdio", healthText.includes("MCP Health Checks:"));
  ok(
    "eco_health reports fake-test-server ok with tool list and duration",
    healthText.includes("fake-test-server") && healthText.includes("OK") && healthText.includes("tool_alpha"),
    healthText.split("\n")[2] ?? "",
  );
  ok(
    "eco_health reports broken-test-server failure",
    healthText.includes("broken-test-server") && healthText.includes("ERROR"),
    healthText.split("\n")[3] ?? "",
  );

  // 9. eco_unregister improvements: multi-server batch unregister, --forget, pre-run backup, and no-op on rerun
  const ag1BeforeMulti = readFileSync(ag1Path, "utf8");
  ok("fake-test-server present before unregister", ag1BeforeMulti.includes("fake-test-server"));
  ok("broken-test-server present before unregister", ag1BeforeMulti.includes("broken-test-server"));

  // Multi-server unregister in one run
  r = await call("eco_unregister", { servers: ["fake-test-server", "broken-test-server"] });
  ok("multi-server unregister succeeds", !r.isError && textOf(r).includes("Successfully removed server entries"));

  const ag1AfterMulti = readFileSync(ag1Path, "utf8");
  ok(
    "both servers removed from Antigravity in one unregister run",
    !ag1AfterMulti.includes("fake-test-server") && !ag1AfterMulti.includes("broken-test-server"),
  );
  ok("unrelated-secret-server remains in Antigravity config", ag1AfterMulti.includes("unrelated-secret-server"));

  // Antigravity backup was written once and equals the pre-run state
  const ag1BackupAfterMulti = readFileSync(ag1BackupPath, "utf8");
  ok(
    "multi-server unregister writes each file once with pre-run backup",
    ag1BackupAfterMulti === ag1BeforeMulti,
  );

  // --forget option removes entries from manifest and creates backup of manifest
  const manifestBeforeForget = readFileSync(manifestPath, "utf8");
  ok(
    "manifest contains servers before forget",
    manifestBeforeForget.includes("fake-test-server") && manifestBeforeForget.includes("broken-test-server"),
  );

  r = await call("eco_unregister", { servers: ["fake-test-server", "broken-test-server"], forget: true });
  ok("unregister with forget: true succeeds", !r.isError);

  const manifestAfterForget = readFileSync(manifestPath, "utf8");
  ok(
    "--forget removes manifest entries",
    !manifestAfterForget.includes("fake-test-server") && !manifestAfterForget.includes("broken-test-server"),
  );

  const manifestBackupPath = `${manifestPath}.bak.constellation`;
  ok("manifest rolling backup created", existsSync(manifestBackupPath));
  const manifestBackupContent = readFileSync(manifestBackupPath, "utf8");
  ok("manifest backup contains pre-run state", manifestBackupContent === manifestBeforeForget);

  // Second run is a no-op
  const ag1BeforeNoop = readFileSync(ag1Path, "utf8");
  const manifestBeforeNoop = readFileSync(manifestPath, "utf8");
  r = await call("eco_unregister", { servers: ["fake-test-server", "broken-test-server"], forget: true });
  ok(
    "second unregister run is a no-op",
    !r.isError && (textOf(r).includes("None of the servers") || textOf(r).includes("not present")),
  );
  ok("second run leaves agent config untouched", readFileSync(ag1Path, "utf8") === ag1BeforeNoop);
  ok("second run leaves manifest untouched", readFileSync(manifestPath, "utf8") === manifestBeforeNoop);

  // 10. eco_contracts
  r = await call("eco_contracts", { action: "list" });
  ok(
    "contracts list",
    !r.isError &&
      textOf(r).includes("aurora-progress-event.v1") &&
      textOf(r).includes("learning-units") &&
      textOf(r).includes("personal-data"),
  );

  r = await call("eco_contracts", { action: "show", name: "aurora-progress-event.v1" });
  ok("contracts show aurora-progress-event.v1", !r.isError && textOf(r).includes("aurora-progress-event.v1") && textOf(r).includes("Vega"));

  r = await call("eco_contracts", { action: "show", name: "personal-data" });
  ok(
    "contracts show personal-data",
    !r.isError &&
      textOf(r).includes("personal-data") &&
      textOf(r).includes(".vega/") &&
      textOf(r).includes("**/progress.jsonl") &&
      textOf(r).includes("SmartDrive-OS"),
  );

  const validFixture = join(ROOT, "contracts", "fixtures", "valid-progress.jsonl");
  r = await call("eco_contracts", { action: "validate", name: "aurora-progress-event.v1", file: validFixture });
  ok("contracts validate valid fixture passes", !r.isError && textOf(r).includes("PASSED") && textOf(r).includes("5/5 event line(s) valid"));

  const invalidFixture = join(ROOT, "contracts", "fixtures", "invalid-progress.jsonl");
  r = await call("eco_contracts", { action: "validate", name: "aurora-progress-event.v1", file: invalidFixture });
  ok(
    "contracts validate invalid fixture fails with line numbers",
    r.isError &&
      textOf(r).includes("FAILED") &&
      textOf(r).includes("Line 1") &&
      textOf(r).includes("Line 5") &&
      textOf(r).includes("Line 6"),
  );

  const validGitignoreFixture = join(ROOT, "contracts", "fixtures", "valid.gitignore");
  r = await call("eco_contracts", { action: "validate", name: "personal-data", file: validGitignoreFixture });
  ok(
    "contracts validate valid gitignore passes",
    !r.isError && textOf(r).includes("PASSED") && textOf(r).includes("7/7 pattern(s) covered"),
  );

  const invalidGitignoreFixture = join(ROOT, "contracts", "fixtures", "invalid.gitignore");
  r = await call("eco_contracts", { action: "validate", name: "personal-data", file: invalidGitignoreFixture });
  ok(
    "contracts validate invalid gitignore fails listing missing patterns",
    r.isError &&
      textOf(r).includes("FAILED") &&
      textOf(r).includes("aurora-progress-*.jsonl") &&
      textOf(r).includes("orion-attempts.jsonl") &&
      textOf(r).includes("**/polaris/captures/") &&
      textOf(r).includes("**/polaris/.cache/") &&
      textOf(r).includes(".polaris/"),
  );

  /* ───────── 11. CLI Integration Checks ───────── */
  console.log("\n--- CLI Integration Checks ---");

  const cliBin = join(ROOT, "dist", "constellation.mjs");

  // Help command
  const helpOut = execFileSync(process.execPath, [cliBin, "help"], { env: testEnv, encoding: "utf8" });
  ok("CLI help lists commands", helpOut.includes("Usage: constellation") && helpOut.includes("doctor") && helpOut.includes("health") && helpOut.includes("register"));

  // Version command
  const verOut = execFileSync(process.execPath, [cliBin, "version"], { env: testEnv, encoding: "utf8" }).trim();
  ok("CLI version prints 0.1.6", verOut === "0.1.6");

  // Status command
  const statusOut = execFileSync(process.execPath, [cliBin, "status"], { env: testEnv, encoding: "utf8" });
  ok("CLI status prints table", statusOut.includes("Constellation Ecosystem Status"));

  // CLI contracts show personal-data
  const cliShowOut = execFileSync(process.execPath, [cliBin, "contracts", "show", "personal-data"], {
    env: testEnv,
    encoding: "utf8",
  });
  ok(
    "CLI contracts show personal-data prints markdown",
    cliShowOut.includes("# Contract: `personal-data`") &&
      cliShowOut.includes(".vega/") &&
      cliShowOut.includes("SmartDrive-OS"),
  );

  // Validate valid fixture via CLI
  const valOut = execFileSync(process.execPath, [cliBin, "contracts", "validate", "aurora-progress-event.v1", validFixture], {
    env: testEnv,
    encoding: "utf8",
  });
  ok("CLI contracts validate valid fixture passes", valOut.includes("OK: Contract 'aurora-progress-event.v1' valid (5/5 lines)"));

  // Validate invalid fixture via CLI
  let invalidFailedAsExpected = false;
  try {
    execFileSync(process.execPath, [cliBin, "contracts", "validate", "aurora-progress-event.v1", invalidFixture], {
      env: testEnv,
      encoding: "utf8",
    });
  } catch (e) {
    invalidFailedAsExpected = true;
    const out = String(e.stdout ?? "") + String(e.stderr ?? "");
    ok(
      "CLI contracts validate invalid fixture exits with error and line numbers",
      out.includes("FAIL:") && out.includes("Line 1") && out.includes("Line 5") && out.includes("Line 6"),
    );
  }
  ok("CLI contracts validate invalid exits non-zero", invalidFailedAsExpected);

  // Validate valid gitignore fixture via CLI
  const valGitOut = execFileSync(process.execPath, [cliBin, "contracts", "validate", "personal-data", validGitignoreFixture], {
    env: testEnv,
    encoding: "utf8",
  });
  ok(
    "CLI contracts validate valid gitignore passes",
    valGitOut.includes("OK: Contract 'personal-data' valid (7/7 patterns covered)"),
  );

  // Validate invalid gitignore fixture via CLI
  let invalidGitFailedAsExpected = false;
  try {
    execFileSync(process.execPath, [cliBin, "contracts", "validate", "personal-data", invalidGitignoreFixture], {
      env: testEnv,
      encoding: "utf8",
    });
  } catch (e) {
    invalidGitFailedAsExpected = true;
    const out = String(e.stdout ?? "") + String(e.stderr ?? "");
    ok(
      "CLI contracts validate invalid gitignore exits with error and lists missing patterns",
      out.includes("FAIL:") &&
        out.includes("aurora-progress-*.jsonl") &&
        out.includes("orion-attempts.jsonl") &&
        out.includes("**/polaris/captures/") &&
        out.includes("**/polaris/.cache/") &&
        out.includes(".polaris/"),
    );
  }
  ok("CLI contracts validate invalid gitignore exits non-zero", invalidGitFailedAsExpected);

  // Secrets resolve at register time: an agent that does not have the server yet gets the real value, never the
  // ${secret:...} placeholder; a secret that cannot be resolved is refused.
  {
    const RESOLVE_VALUE = "e2e_resolved_secret_value_5566";
    const secretsPath = join(FAKE_CONSTELLATION, "secrets.json");
    const secretsBefore = existsSync(secretsPath) ? readFileSync(secretsPath, "utf8") : null;
    writeFileSync(secretsPath, JSON.stringify({ E2E_RESOLVE_TOKEN: RESOLVE_VALUE }, null, 2) + "\n", "utf8");
    const m = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^﻿/, ""));
    m.servers.push(
      {
        name: "secret-resolve-server",
        transport: "stdio",
        command: "node",
        args: [FAKE_SERVER_SCRIPT],
        env: { E2E_RESOLVE_TOKEN: "${secret:E2E_RESOLVE_TOKEN}" },
        agents: ["cursor"],
      },
      {
        name: "secret-missing-server",
        transport: "stdio",
        command: "node",
        args: [FAKE_SERVER_SCRIPT],
        env: { E2E_MISSING_TOKEN: "${secret:E2E_MISSING_TOKEN}" },
        agents: ["cursor"],
      },
    );
    writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n", "utf8");

    r = await call("eco_register", { servers: ["secret-resolve-server"] });
    const resolveText = textOf(r);
    const cursorCfg = JSON.parse(readFileSync(join(CURSOR_DIR, "mcp.json"), "utf8").replace(/^﻿/, ""));
    const written = cursorCfg.mcpServers?.["secret-resolve-server"]?.env?.E2E_RESOLVE_TOKEN;
    ok(
      "register resolves ${secret:NAME} from secrets.json into the agent config",
      !r.isError && written === RESOLVE_VALUE,
      written === undefined ? "missing" : written === RESOLVE_VALUE ? "resolved" : "placeholder or other value",
    );
    ok("register output never prints the resolved secret", !resolveText.includes(RESOLVE_VALUE));

    // An agent config left with the raw placeholder (what register wrote before 0.1.6) is drift and is repaired,
    // even though placeholder and secret look the same once masked.
    const cursorPath = join(CURSOR_DIR, "mcp.json");
    const withPlaceholder = JSON.parse(readFileSync(cursorPath, "utf8").replace(/^﻿/, ""));
    withPlaceholder.mcpServers["secret-resolve-server"].env.E2E_RESOLVE_TOKEN = "${secret:E2E_RESOLVE_TOKEN}";
    writeFileSync(cursorPath, JSON.stringify(withPlaceholder, null, 2) + "\n", "utf8");
    r = await call("eco_doctor");
    ok(
      "doctor flags a config that holds the unresolved ${secret:...} placeholder",
      textOf(r).includes("unresolved placeholder") && !textOf(r).includes(RESOLVE_VALUE),
    );
    r = await call("eco_register", { servers: ["secret-resolve-server"] });
    const repaired = JSON.parse(readFileSync(cursorPath, "utf8").replace(/^﻿/, ""));
    ok(
      "register replaces a leftover placeholder with the resolved secret",
      repaired.mcpServers["secret-resolve-server"].env.E2E_RESOLVE_TOKEN === RESOLVE_VALUE &&
        textOf(r).includes("updated secret value") &&
        !textOf(r).includes(RESOLVE_VALUE),
      textOf(r).slice(0, 200),
    );

    r = await call("eco_register", { servers: ["secret-missing-server"] });
    const afterMissing = readFileSync(join(CURSOR_DIR, "mcp.json"), "utf8");
    ok(
      "register refuses an unresolvable secret instead of writing the placeholder",
      textOf(r).includes("E2E_MISSING_TOKEN") && !afterMissing.includes("${secret:E2E_MISSING_TOKEN}"),
      textOf(r).slice(0, 200),
    );
    if (secretsBefore === null) rmSync(secretsPath, { force: true });
    else writeFileSync(secretsPath, secretsBefore, "utf8");
  }

} finally {
  await client.close();
  await transport.close();

  // Cleanup temp files
  if (!process.env.CONSTELLATION_E2E_KEEP) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

console.log(`\nAll e2e checks complete: ${failed === 0 ? "ALL PASSED" : `${failed} FAILED`}\n`);
if (failed > 0) process.exit(1);
