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
// True when the validator output has an error line "Line <n>: ..." that contains `needle`.
const lineHas = (out, n, needle) => out.split("\n").some((l) => l.includes(`Line ${n}: `) && l.includes(needle));

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
  ok("server version is 0.1.8", info?.version === "0.1.8", info?.version);
  const instructions = client.getInstructions() ?? "";
  ok("server sends instructions with workflow and rules", instructions.includes("Workflow:") && instructions.includes("Rules:"));
  ok(
    "server instructions list the ecosystem members and the contract validators",
    ["Polaris", "Aurora Slides", "Vega", "Orion", "Sirius", "Mira", "Rigel", "SmartDrive-OS", "mcp-agy"].every((n) => instructions.includes(n)) &&
      instructions.includes("vega-card-inbox.v1") &&
      instructions.includes("mira-embed.v1"),
  );

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
  ok(
    "eco_guide overview lists Orion, Sirius and Mira with their repositories",
    !r.isError &&
      textOf(r).includes("Orion (https://github.com/DuongNAD/orion-mcp)") &&
      textOf(r).includes("Sirius (https://github.com/DuongNAD/sirius-mcp)") &&
      textOf(r).includes("Mira (https://github.com/DuongNAD/mira-mcp)") &&
      textOf(r).includes("tutoring-ladder hints") &&
      textOf(r).includes("weekly plan-vs-actual review") &&
      textOf(r).includes("prediction gates"),
  );
  ok(
    "eco_guide overview lists Rigel (rigel-mcp) without a repository link",
    !r.isError &&
      textOf(r).includes("- Rigel (rigel-mcp): grounded Q&A over the learner's lesson materials, refs and coverage; feeds the Vega inbox.") &&
      !/Rigel \(https?:/.test(textOf(r)),
  );
  r = await call("eco_guide", { topic: "manifest" });
  ok("eco_guide manifest topic", !r.isError && textOf(r).includes("ecosystem.json"));
  r = await call("eco_guide", { topic: "contracts" });
  ok(
    "eco_guide contracts topic lists vega-card-inbox.v1, mira-embed.v1 and .sirius/",
    !r.isError &&
      textOf(r).includes("`vega-card-inbox.v1`") &&
      textOf(r).includes("`mira-embed.v1`") &&
      textOf(r).includes(".sirius/"),
  );
  ok(
    "eco_guide contracts topic names the rigel producer and the rigel-ref origin kind of the 2026-10-13 amendment",
    !r.isError && textOf(r).includes("Amendment 2026-10-13") && textOf(r).includes("`rigel`") && textOf(r).includes("`rigel-ref`"),
  );

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
    "contracts validate valid gitignore passes (8/8 patterns)",
    !r.isError && textOf(r).includes("PASSED") && textOf(r).includes("8/8 pattern(s) covered"),
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
      textOf(r).includes(".polaris/") &&
      textOf(r).includes(".sirius/") &&
      textOf(r).includes("2/8 patterns covered"),
  );

  /* ───────── 10b. New contracts: vega-card-inbox.v1, mira-embed.v1 and personal-data .sirius/ ───────── */
  console.log("\n--- Contracts: vega-card-inbox.v1, mira-embed.v1, personal-data .sirius/ ---");

  const CLI_BIN = join(ROOT, "dist", "constellation.mjs");
  // `constellation contracts validate <contract> <file> --json`, parsed (the CLI exits 1 when the file is invalid).
  const validateJson = (contract, file) => {
    try {
      return JSON.parse(
        execFileSync(process.execPath, [CLI_BIN, "contracts", "validate", contract, file, "--json"], {
          env: testEnv,
          encoding: "utf8",
        }),
      );
    } catch (e) {
      return JSON.parse(String(e.stdout));
    }
  };
  // Test files live under %TEMP% (TEST_DIR), never in the repository.
  const writeTemp = (name, content) => {
    const p = join(TEST_DIR, name);
    writeFileSync(p, content);
    return p;
  };
  const omit = (obj, ...keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
  const jsonlOf = (items) => items.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join("\n") + "\n";
  // One JSONL file per group, one case per line: [name, record, expectedValid]. Checks which lines the validator rejects.
  const checkCases = (contract, group, cases) => {
    const file = writeTemp(`${contract}-${group.replace(/\W+/g, "_")}.jsonl`, jsonlOf(cases.map(([, v]) => v)));
    const res = validateJson(contract, file);
    const badLines = new Set((res.errors ?? []).filter((e) => e.line != null).map((e) => e.line));
    const wrong = cases.filter(([, , expectValid], i) => badLines.has(i + 1) === expectValid).map(([name]) => name);
    ok(
      `${contract}: ${group} (${cases.length} cases)`,
      res.totalLines === cases.length && wrong.length === 0,
      wrong.length > 0 ? `unexpected result for: ${wrong.join("; ")}` : `${res.validLines} accepted, ${cases.length - res.validLines} rejected`,
    );
  };

  // --- list / show ---
  r = await call("eco_contracts", { action: "list" });
  ok(
    "contracts list shows vega-card-inbox.v1 (data) and mira-embed.v1 (protocol) with validators",
    !r.isError &&
      /^vega-card-inbox\.v1\s+\|\s+data\s+\|.*\|\s+Yes\s*$/m.test(textOf(r)) &&
      /^mira-embed\.v1\s+\|\s+protocol\s+\|.*\|\s+Yes\s*$/m.test(textOf(r)),
  );

  r = await call("eco_contracts", { action: "show", name: "vega-card-inbox.v1" });
  ok(
    "contracts show vega-card-inbox.v1",
    !r.isError &&
      textOf(r).includes("# Contract: `vega-card-inbox.v1`") &&
      textOf(r).includes("<hub>/.vega/inbox/") &&
      textOf(r).includes("Vega alone") &&
      textOf(r).includes("`orion-attempt`") &&
      textOf(r).includes("Producer Key Conventions"),
  );
  ok(
    "contracts show vega-card-inbox.v1 documents the 2026-10-13 amendment: producer rigel, origin kind rigel-ref, key and origin conventions",
    !r.isError &&
      textOf(r).includes("## Amendment 2026-10-13 (backward compatible, still v1)") &&
      textOf(r).includes("`producer` | string | Required, one of `polaris`, `orion`, `mira`, `aurora`, `sirius`, `rigel`, `manual`.") &&
      textOf(r).includes("`mira-stop`, `rigel-ref`, `manual`") &&
      textOf(r).includes("`rigel:<subject or course>:<ref>:<first 8 hex of sha1(front)>`") &&
      textOf(r).includes("`path` = absolute path of the source file") &&
      textOf(r).includes("`D3#12 · slide 7`"),
  );
  r = await call("eco_contracts", { action: "show", name: "mira-embed.v1" });
  ok(
    "contracts show mira-embed.v1",
    !r.isError &&
      textOf(r).includes("# Contract: `mira-embed.v1`") &&
      textOf(r).includes("postMessage") &&
      textOf(r).includes("`hello`") &&
      textOf(r).includes("`blur`") &&
      textOf(r).includes("Security Notes"),
  );
  r = await call("eco_contracts", { action: "show", name: "mira-embed" });
  ok("contracts show accepts the short name mira-embed", !r.isError && textOf(r).includes("# Contract: `mira-embed.v1`"));
  r = await call("eco_contracts", { action: "show", name: "personal-data" });
  ok(
    "contracts show personal-data documents .sirius/",
    !r.isError && textOf(r).includes("| `.sirius/` |") && textOf(r).includes("Sirius Execution Journal") && textOf(r).includes("all 8 canonical patterns"),
  );

  // --- vega-card-inbox.v1: shipped fixtures ---
  const vegaValidFixture = join(ROOT, "contracts", "vega-card-inbox.v1", "fixtures", "valid.jsonl");
  const vegaInvalidFixture = join(ROOT, "contracts", "vega-card-inbox.v1", "fixtures", "invalid.jsonl");
  r = await call("eco_contracts", { action: "validate", name: "vega-card-inbox.v1", file: vegaValidFixture });
  ok(
    "vega-card-inbox.v1 validate valid fixture passes",
    !r.isError && textOf(r).includes("PASSED") && textOf(r).includes("9/9 card line(s) valid"),
    textOf(r).slice(0, 100),
  );
  r = await call("eco_contracts", { action: "validate", name: "card-inbox", file: vegaValidFixture });
  ok("vega-card-inbox.v1 validate accepts the short name card-inbox", !r.isError && textOf(r).includes("9/9 card line(s) valid"));

  r = await call("eco_contracts", { action: "validate", name: "vega-card-inbox.v1", file: vegaInvalidFixture });
  const vegaBad = textOf(r);
  ok(
    "vega-card-inbox.v1 validate invalid fixture fails: no line is valid",
    r.isError && vegaBad.includes("FAILED") && vegaBad.includes("(0/17 lines valid)"),
    vegaBad.split("\n")[0].slice(-40),
  );
  ok(
    "vega-card-inbox.v1 reports missing key, wrong producer prefix, unknown field, over-long front, bad origin kind and malformed JSON by line",
    lineHas(vegaBad, 1, "key: required field is missing") &&
      lineHas(vegaBad, 2, "key: must start with 'orion:'") &&
      lineHas(vegaBad, 3, "difficulty: unknown field") &&
      lineHas(vegaBad, 4, "front: must be at most 600 characters (got 601)") &&
      lineHas(vegaBad, 5, "origin.kind: must be one of: polaris-fact") &&
      lineHas(vegaBad, 6, "Malformed JSON line"),
  );
  ok(
    "vega-card-inbox.v1 also reports unknown producer, time without offset, wrong v, emoji, 11 tags, missing back, unknown origin field, control character, impossible date and unknown kind",
    lineHas(vegaBad, 7, "producer: must be one of: polaris, orion, mira, aurora, sirius, rigel, manual") &&
      lineHas(vegaBad, 8, "t: must be an ISO 8601 date-time") &&
      lineHas(vegaBad, 9, "v: must be 1") &&
      lineHas(vegaBad, 10, "front: must not contain emoji") &&
      lineHas(vegaBad, 11, "tags: must have at most 10 items (got 11)") &&
      lineHas(vegaBad, 12, "back: required field is missing") &&
      lineHas(vegaBad, 13, "origin.page: unknown field") &&
      lineHas(vegaBad, 14, "key: must not contain control characters") &&
      lineHas(vegaBad, 15, "t: must be an ISO 8601 date-time") &&
      lineHas(vegaBad, 16, "kind: must be one of: basic, cloze, reverse"),
  );
  ok(
    "vega-card-inbox.v1 reports a rigel line whose key carries another producer's prefix (line 17), and nothing else on that line",
    lineHas(vegaBad, 17, "key: must start with 'rigel:' followed by an identifier (producer is 'rigel')") &&
      vegaBad.split("\n").filter((l) => l.includes("Line 17: ")).length === 1,
  );

  // --- mira-embed.v1: shipped fixtures ---
  const miraValidFixture = join(ROOT, "contracts", "mira-embed.v1", "fixtures", "valid.jsonl");
  const miraInvalidFixture = join(ROOT, "contracts", "mira-embed.v1", "fixtures", "invalid.jsonl");
  r = await call("eco_contracts", { action: "validate", name: "mira-embed.v1", file: miraValidFixture });
  ok(
    "mira-embed.v1 validate valid fixture passes",
    !r.isError && textOf(r).includes("PASSED") && textOf(r).includes("8/8 message line(s) valid"),
    textOf(r).slice(0, 100),
  );
  r = await call("eco_contracts", { action: "validate", name: "mira-embed.v1", file: miraInvalidFixture });
  const miraBad = textOf(r);
  ok(
    "mira-embed.v1 validate invalid fixture fails: no line is valid",
    r.isError && miraBad.includes("FAILED") && miraBad.includes("(0/17 lines valid)"),
    miraBad.split("\n")[0].slice(-40),
  );
  ok(
    "mira-embed.v1 reports wrong source, wrong v, unknown kind, hello from the player, missing ready fields and bad predict event fields by line",
    lineHas(miraBad, 1, "source: must be 'mira'") &&
      lineHas(miraBad, 2, "v: must be 1") &&
      lineHas(miraBad, 3, "kind: must be one of ready, event, blur") &&
      lineHas(miraBad, 4, "source: must be 'aurora'") &&
      lineHas(miraBad, 5, "steps: required field is missing") &&
      lineHas(miraBad, 5, "stops: required field is missing") &&
      lineHas(miraBad, 6, "event.rating: must be 'right' or 'different'") &&
      lineHas(miraBad, 7, "event.slideId: must match mira-stop-<k>") &&
      lineHas(miraBad, 8, "event.title: must be at most 200 characters (got 201)"),
  );
  ok(
    "mira-embed.v1 also reports event types outside the protocol, bad accent, unknown field, non-object event, malformed JSON, missing prediction, bad theme, missing base fields and bad counts",
    lineHas(miraBad, 9, "event.type: must be 'predict' or 'complete'") &&
      lineHas(miraBad, 10, "accent: must be #RRGGBB") &&
      lineHas(miraBad, 11, "key: unknown field") &&
      lineHas(miraBad, 12, "event: ") &&
      lineHas(miraBad, 13, "Malformed JSON line") &&
      lineHas(miraBad, 14, "event.prediction: required field is missing") &&
      lineHas(miraBad, 15, "theme: must be 'dark' or 'light'") &&
      lineHas(miraBad, 16, "event.deck: required field is missing") &&
      lineHas(miraBad, 16, "event.slide: required field is missing") &&
      lineHas(miraBad, 17, "steps: must be a non-negative integer") &&
      lineHas(miraBad, 17, "stops: must be a non-negative integer"),
  );

  // --- generated cases (under %TEMP%): boundaries the one-violation-per-line fixtures do not show ---
  const cardBase = {
    v: 1,
    t: "2026-10-12T21:04:10+07:00",
    producer: "orion",
    key: "orion:Lab_X:check_a",
    subject: "Python_Master",
    front: "Câu hỏi",
    back: "Trả lời",
    origin: { kind: "orion-attempt", path: "Python_Master/Lab_X" },
  };
  const astral = String.fromCodePoint(0x1d465); // one code point, two UTF-16 units
  const emojiChar = String.fromCodePoint(0x1f600);
  const card = (over) => ({ ...cardBase, ...over });
  const cardOrigin = (over) => card({ origin: { ...cardBase.origin, ...over } });

  checkCases("vega-card-inbox.v1", "text lengths", [
    ["front of 600 characters", card({ front: "x".repeat(600) }), true],
    ["front of 601 characters", card({ front: "x".repeat(601) }), false],
    ["front of 600 astral characters (1200 UTF-16 units) counts code points", card({ front: astral.repeat(600) }), true],
    ["front of 601 astral characters", card({ front: astral.repeat(601) }), false],
    ["front of 600 characters plus surrounding spaces is trimmed", card({ front: ` ${"x".repeat(600)} ` }), true],
    ["whitespace-only front counts as empty", card({ front: "   " }), false],
    ["empty back is allowed", card({ back: "" }), true],
    ["back of 1200 characters", card({ back: "y".repeat(1200) }), true],
    ["back of 1201 characters", card({ back: "y".repeat(1201) }), false],
    ["hint of 200 characters", card({ hint: "h".repeat(200) }), true],
    ["hint of 201 characters", card({ hint: "h".repeat(201) }), false],
    ["hook of 201 characters", card({ hook: "h".repeat(201) }), false],
    ["reason of 201 characters", card({ reason: "r".repeat(201) }), false],
    ["subject of 120 characters", card({ subject: "s".repeat(120) }), true],
    ["subject of 121 characters", card({ subject: "s".repeat(121) }), false],
    ["empty subject", card({ subject: "" }), false],
    ["deck of 121 characters", card({ deck: "d".repeat(121) }), false],
    ["empty optional deck", card({ deck: "" }), true],
  ]);
  checkCases("vega-card-inbox.v1", "key rules", [
    ["key of 200 characters", card({ key: `orion:${"k".repeat(194)}` }), true],
    ["key of 201 characters", card({ key: `orion:${"k".repeat(195)}` }), false],
    ["key with nothing after the producer prefix", card({ key: "orion:" }), false],
    ["key that only looks like the prefix (orionx:)", card({ key: "orionx:a" }), false],
    ["key of another producer", card({ key: "mira:Lab_X:stop-1" }), false],
    ["key with a newline", card({ key: "orion:a\nb" }), false],
    ["key with a tab", card({ key: "orion:a\tb" }), false],
    ["key surrounded by spaces is trimmed", card({ key: "  orion:Lab_X:check_a  " }), true],
    ["mira key for producer mira", card({ producer: "mira", key: "mira:dem-chan:stop-3", origin: { kind: "mira-stop", path: "p" } }), true],
    ["sirius key for producer sirius", card({ producer: "sirius", key: "sirius:weekly:1" }), true],
    [
      "rigel key for producer rigel (amendment 2026-10-13)",
      card({ producer: "rigel", key: "rigel:GCI_World_2026_September:D3#12:9f2c1a0b", origin: { kind: "rigel-ref", path: "D:/x/lecture.md", locator: "D3#12 · slide 7" } }),
      true,
    ],
    ["key of another producer for producer rigel", card({ producer: "rigel", key: "polaris:GCI_World_2026_September:D3#12:9f2c1a0b", origin: { kind: "rigel-ref", path: "p" } }), false],
    ["rigel key with nothing after the prefix", card({ producer: "rigel", key: "rigel:", origin: { kind: "rigel-ref", path: "p" } }), false],
    ["rigel key that only looks like the prefix (rigelx:)", card({ producer: "rigel", key: "rigelx:a", origin: { kind: "rigel-ref", path: "p" } }), false],
    ["rigel key for producer orion", card({ key: "rigel:Lab_X:check_a" }), false],
    ["producer vega", card({ producer: "vega" }), false],
    ["missing producer", omit(cardBase, "producer"), false],
  ]);
  checkCases("vega-card-inbox.v1", "timestamps", [
    ["Z suffix", card({ t: "2026-10-12T14:04:10Z" }), true],
    ["fractional seconds with offset", card({ t: "2026-10-12T21:04:10.123456+07:00" }), true],
    ["negative offset", card({ t: "2026-10-12T09:04:10-05:00" }), true],
    ["leap day 2028-02-29", card({ t: "2028-02-29T00:00:00Z" }), true],
    ["2026-02-29 is not a date", card({ t: "2026-02-29T00:00:00Z" }), false],
    ["2100-02-29 is not a date (century year)", card({ t: "2100-02-29T00:00:00Z" }), false],
    ["2000-02-29 is a date (divisible by 400)", card({ t: "2000-02-29T00:00:00Z" }), true],
    ["April 31", card({ t: "2026-04-31T00:00:00Z" }), false],
    ["month 13", card({ t: "2026-13-01T00:00:00Z" }), false],
    ["hour 24", card({ t: "2026-10-12T24:00:00Z" }), false],
    ["minute 60", card({ t: "2026-10-12T10:60:00Z" }), false],
    ["offset +24:00", card({ t: "2026-10-12T10:00:00+24:00" }), false],
    ["no offset", card({ t: "2026-10-12T21:04:10" }), false],
    ["date only", card({ t: "2026-10-12" }), false],
    ["space instead of T", card({ t: "2026-10-12 21:04:10+07:00" }), false],
    ["no seconds", card({ t: "2026-10-12T21:04+07:00" }), false],
    ["numeric timestamp", card({ t: 1791744074 }), false],
    ["wrong version 2", card({ v: 2 }), false],
    ["version as string", card({ v: "1" }), false],
  ]);
  checkCases("vega-card-inbox.v1", "tags, origin and kinds", [
    ["10 tags", card({ tags: Array.from({ length: 10 }, (_v, i) => `t${i}`) }), true],
    ["11 tags", card({ tags: Array.from({ length: 11 }, (_v, i) => `t${i}`) }), false],
    ["empty tag list", card({ tags: [] }), true],
    ["tag of 40 characters", card({ tags: ["t".repeat(40)] }), true],
    ["tag of 41 characters", card({ tags: ["t".repeat(41)] }), false],
    ["empty tag", card({ tags: [""] }), false],
    ["tag that is not a string", card({ tags: [5] }), false],
    ["tags that is not an array", card({ tags: "a,b" }), false],
    ["origin.path of 400 characters", cardOrigin({ path: "p".repeat(400) }), true],
    ["origin.path of 401 characters", cardOrigin({ path: "p".repeat(401) }), false],
    ["origin.locator of 120 characters", cardOrigin({ locator: "l".repeat(120) }), true],
    ["origin.locator of 121 characters", cardOrigin({ locator: "l".repeat(121) }), false],
    ["origin.href of 400 characters", cardOrigin({ href: "h".repeat(400) }), true],
    ["origin.href of 401 characters", cardOrigin({ href: "h".repeat(401) }), false],
    ["origin without path", card({ origin: { kind: "manual" } }), false],
    ["origin without kind", card({ origin: { path: "p" } }), false],
    ["origin that is a string", card({ origin: "p" }), false],
    ["origin kind polaris-fact", card({ origin: { kind: "polaris-fact", path: "p" } }), true],
    ["origin kind aurora-quiz", card({ origin: { kind: "aurora-quiz", path: "p" } }), true],
    ["origin kind notebook is unknown", card({ origin: { kind: "notebook", path: "p" } }), false],
    ["origin kind rigel-ref (amendment 2026-10-13)", card({ origin: { kind: "rigel-ref", path: "p" } }), true],
    [
      "origin kind rigel-ref with locator and href",
      card({ origin: { kind: "rigel-ref", path: "D:/x/lecture.md", locator: "D3#12 · slide 7", href: "file:///D:/x/lecture.md#D3-12" } }),
      true,
    ],
    ["origin kind rigel-note is unknown", card({ origin: { kind: "rigel-note", path: "p" } }), false],
    ["kind reverse", card({ kind: "reverse" }), true],
    ["kind cloze", card({ kind: "cloze", front: "Hàm [[len]] đếm phần tử" }), true],
    ["kind palace is not a card kind here", card({ kind: "palace" }), false],
    ["record that is an array", [cardBase], false],
    ["record that is a JSON string", '"hello"', false],
    ["record that is null", null, false],
  ]);
  checkCases("vega-card-inbox.v1", "emoji in front", [
    ["emoji in front", card({ front: `Câu hỏi ${emojiChar}` }), false],
    ["emoji variation selector (U+FE0F) in front", card({ front: `Ghi chú${String.fromCodePoint(0xfe0f)}` }), false],
    ["check-mark emoji (U+2705) in front", card({ front: `Xong ${String.fromCodePoint(0x2705)}` }), false],
    ["arrow, check mark, copyright sign and bullet are not emoji", card({ front: `a ${String.fromCodePoint(0x2192)} b ${String.fromCodePoint(0x2713)} ${String.fromCodePoint(0xa9)} ${String.fromCodePoint(0x2022)}` }), true],
    ["emoji in back is not part of the front rule", card({ back: `Trả lời ${emojiChar}` }), true],
  ]);

  // --- mira-embed.v1 generated cases ---
  const evBase = {
    v: 1,
    t: "2026-10-12T21:30:05+07:00",
    deck: "Dò vòng lặp",
    slide: 3,
    slideId: "mira-stop-1",
    type: "predict",
    title: "Câu hỏi",
    prediction: "1",
    rating: "right",
    output: "1",
  };
  const evMsg = (over = {}, drop = []) => ({
    source: "mira",
    v: 1,
    kind: "event",
    event: omit({ ...evBase, ...over }, ...drop),
  });
  const ready = (over = {}) => ({ source: "mira", v: 1, kind: "ready", title: "Dò", steps: 10, stops: 2, ...over });
  const hello = (over = {}) => ({ source: "aurora", v: 1, kind: "hello", theme: "dark", ...over });

  checkCases("mira-embed.v1", "predict event limits and fields", [
    ["title of 200 characters", evMsg({ title: "t".repeat(200) }), true],
    ["title of 201 characters", evMsg({ title: "t".repeat(201) }), false],
    ["empty title", evMsg({ title: "" }), true],
    ["prediction of 2000 characters", evMsg({ prediction: "p".repeat(2000) }), true],
    ["prediction of 2001 characters", evMsg({ prediction: "p".repeat(2001) }), false],
    ["empty prediction", evMsg({ prediction: "" }), true],
    ["output of 300 characters", evMsg({ output: "o".repeat(300) }), true],
    ["output of 301 characters", evMsg({ output: "o".repeat(301) }), false],
    ["rating right", evMsg({ rating: "right" }), true],
    ["rating different", evMsg({ rating: "different" }), true],
    ["rating good (valid in aurora-progress-event.v1, not here)", evMsg({ rating: "good" }), false],
    ["rating got", evMsg({ rating: "got" }), false],
    ["missing rating", evMsg({}, ["rating"]), false],
    ["missing title", evMsg({}, ["title"]), false],
    ["missing output", evMsg({}, ["output"]), false],
    ["missing slideId", evMsg({}, ["slideId"]), false],
    ["slideId mira-stop-0", evMsg({ slideId: "mira-stop-0" }), true],
    ["slideId mira-stop-12", evMsg({ slideId: "mira-stop-12" }), true],
    ["slideId mira-stop- (no number)", evMsg({ slideId: "mira-stop-" }), false],
    ["slideId mira-stop-x", evMsg({ slideId: "mira-stop-x" }), false],
    ["slideId mira-stop-1x", evMsg({ slideId: "mira-stop-1x" }), false],
    ["slideId with a prefix (s_trace_1:mira-stop-1)", evMsg({ slideId: "s_trace_1:mira-stop-1" }), false],
    ["slideId null", evMsg({ slideId: null }), false],
    ["course and lesson null", evMsg({ course: null, lesson: null }), true],
    ["course and lesson strings", evMsg({ course: "python-master", lesson: "02-vong-lap" }), true],
    ["event version 2", evMsg({ v: 2 }), false],
    ["event slide -1", evMsg({ slide: -1 }), false],
    ["event slide as string", evMsg({ slide: "3" }), false],
    ["event without t", evMsg({}, ["t"]), false],
    ["event with empty deck", evMsg({ deck: "" }), false],
  ]);
  checkCases("mira-embed.v1", "other event types", [
    ["complete event", evMsg({ type: "complete", slides: 42, quiz: null, predictions: "1/2" }, ["title", "prediction", "rating", "output", "slideId"]), true],
    ["complete event with only the required base fields", evMsg({ type: "complete" }, ["title", "prediction", "rating", "output", "slideId"]), true],
    ["complete event with a bad predictions type", evMsg({ type: "complete", predictions: 3 }, ["title", "prediction", "rating", "output", "slideId"]), false],
    ["quiz event", evMsg({ type: "quiz" }), false],
    ["recall event", evMsg({ type: "recall" }), false],
    ["card event", evMsg({ type: "card" }), false],
    ["event without type", evMsg({}, ["type"]), false],
    ["event type that is not a string", evMsg({ type: 5 }), false],
    ["event that is null", { source: "mira", v: 1, kind: "event", event: null }, false],
    ["event that is an array", { source: "mira", v: 1, kind: "event", event: [evBase] }, false],
    ["event message without event", { source: "mira", v: 1, kind: "event" }, false],
    ["event message with an extra field", { ...evMsg(), note: "x" }, false],
  ]);
  checkCases("mira-embed.v1", "ready, hello, blur and envelope", [
    ["ready", ready(), true],
    ["ready with 0 steps and 0 stops", ready({ steps: 0, stops: 0 }), true],
    ["ready title of 200 characters", ready({ title: "t".repeat(200) }), true],
    ["ready title of 201 characters", ready({ title: "t".repeat(201) }), false],
    ["ready with fractional stops", ready({ stops: 2.5 }), false],
    ["ready with negative steps", ready({ steps: -1 }), false],
    ["ready with steps as string", ready({ steps: "10" }), false],
    ["ready without title", omit(ready(), "title"), false],
    ["ready with an extra field", ready({ theme: "dark" }), false],
    ["hello dark", hello(), true],
    ["hello light with accent", hello({ theme: "light", accent: "#112233" }), true],
    ["hello with a lowercase accent", hello({ accent: "#e8a23b" }), true],
    ["hello accent with 3 digits", hello({ accent: "#FFF" }), false],
    ["hello accent with 8 digits", hello({ accent: "#E8A23BFF" }), false],
    ["hello accent without #", hello({ accent: "E8A23B" }), false],
    ["hello accent with a non-hex digit", hello({ accent: "#E8A23G" }), false],
    ["hello without theme", omit(hello(), "theme"), false],
    ["hello with theme sepia", hello({ theme: "sepia" }), false],
    ["hello sent with the player source", hello({ source: "mira" }), false],
    ["ready sent with the parent source", ready({ source: "aurora" }), false],
    ["event sent with the parent source", { ...evMsg(), source: "aurora" }, false],
    ["blur", { source: "mira", v: 1, kind: "blur" }, true],
    ["blur sent with the parent source", { source: "aurora", v: 1, kind: "blur" }, false],
    ["blur with an extra field", { source: "mira", v: 1, kind: "blur", key: "Escape" }, false],
    ["v as string", { source: "mira", v: "1", kind: "blur" }, false],
    ["missing v", { source: "mira", kind: "blur" }, false],
    ["missing source", { v: 1, kind: "blur" }, false],
    ["missing kind", { source: "mira", v: 1 }, false],
    ["unknown kind", { source: "mira", v: 1, kind: "resize" }, false],
    ["message that is an array", [], false],
    ["message that is null", null, false],
    ["message that is a number", 5, false],
    ["message that is a JSON string", '"ready"', false],
  ]);

  // --- file-level behaviour, both JSON Lines validators ---
  for (const [contract, sampleLine] of [
    ["vega-card-inbox.v1", JSON.stringify(cardBase)],
    ["mira-embed.v1", JSON.stringify({ source: "mira", v: 1, kind: "blur" })],
  ]) {
    const badLine = contract === "vega-card-inbox.v1" ? JSON.stringify(omit(cardBase, "key")) : JSON.stringify({ source: "x", v: 1, kind: "blur" });
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    let res = validateJson(contract, writeTemp(`${contract}-bom-crlf.jsonl`, Buffer.concat([bom, Buffer.from(`${sampleLine}\r\n${sampleLine}\r\n`, "utf8")])));
    ok(`${contract}: a UTF-8 BOM and CRLF line endings are tolerated`, res.ok === true && res.totalLines === 2 && res.validLines === 2, `${res.validLines}/${res.totalLines}`);

    res = validateJson(contract, writeTemp(`${contract}-blank-lines.jsonl`, `${sampleLine}\n\n   \n${badLine}\n${sampleLine}`));
    ok(
      `${contract}: blank lines are skipped and line numbers stay physical`,
      res.ok === false && res.totalLines === 3 && res.validLines === 2 && res.errors.length >= 1 && res.errors.every((e) => e.line === 4),
      JSON.stringify(res.errors.map((e) => e.line)),
    );

    res = validateJson(contract, writeTemp(`${contract}-empty.jsonl`, ""));
    ok(`${contract}: an empty file is not valid`, res.ok === false && res.totalLines === 0 && res.errors.some((e) => e.message.includes("no JSON Lines records")));
    res = validateJson(contract, writeTemp(`${contract}-only-newlines.jsonl`, "\n\n\n"));
    ok(`${contract}: a file with only blank lines is not valid`, res.ok === false && res.totalLines === 0);

    res = validateJson(contract, writeTemp(`${contract}-array.json`, `[${sampleLine},${sampleLine}]`));
    ok(
      `${contract}: a JSON array is reported once as the wrong format`,
      res.ok === false && res.errors.length === 1 && res.errors[0].message.includes("JSON array") && res.errors[0].line === 1,
      JSON.stringify(res.errors.map((e) => e.message.slice(0, 40))),
    );

    res = validateJson(contract, writeTemp(`${contract}-latin1.jsonl`, Buffer.concat([Buffer.from(`${sampleLine.slice(0, 20)}`, "utf8"), Buffer.from([0xff, 0xfe, 0xe9]), Buffer.from(`${sampleLine.slice(20)}\n`, "utf8")])));
    ok(`${contract}: a file that is not valid UTF-8 is rejected`, res.ok === false && res.errors.some((e) => e.message.includes("not valid UTF-8")));

    res = validateJson(contract, join(TEST_DIR, `${contract}-does-not-exist.jsonl`));
    ok(`${contract}: a missing file is reported`, res.ok === false && res.errors.some((e) => e.message.includes("File not found")));

    res = validateJson(contract, writeTemp(`${contract}-pretty.json`, JSON.stringify(JSON.parse(sampleLine), null, 2) + "\n"));
    ok(`${contract}: a pretty-printed object is reported as malformed JSON lines`, res.ok === false && res.errors.some((e) => e.message.includes("Malformed JSON line")));
  }

  // --- each schema.json must agree with the validator on every fixture line ---
  // Portable JSON Schema cannot express the emoji rule or the calendar validity of t, so lines the validator
  // rejects only for those two reasons are allowed to pass the schema.
  const Ajv = req("ajv");
  for (const contract of ["vega-card-inbox.v1", "mira-embed.v1"]) {
    let validateSchema;
    let schemaProblem = "";
    try {
      validateSchema = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(
        JSON.parse(readFileSync(join(ROOT, "contracts", contract, "schema.json"), "utf8")),
      );
    } catch (e) {
      schemaProblem = String(e?.message ?? e);
    }
    ok(`${contract}: schema.json is a valid draft-07 JSON Schema`, typeof validateSchema === "function", schemaProblem);
    if (typeof validateSchema !== "function") continue;

    let compared = 0;
    const disagreements = [];
    for (const fixture of ["valid", "invalid"]) {
      const file = join(ROOT, "contracts", contract, "fixtures", `${fixture}.jsonl`);
      const res = validateJson(contract, file);
      const messagesByLine = new Map();
      for (const e of res.errors) {
        if (e.line != null) messagesByLine.set(e.line, [...(messagesByLine.get(e.line) ?? []), e.message]);
      }
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((lineText, i) => {
          if (!lineText.trim()) return;
          let record;
          try {
            record = JSON.parse(lineText);
          } catch {
            return; // malformed JSON line: nothing for a schema to judge
          }
          compared++;
          const messages = messagesByLine.get(i + 1) ?? [];
          const schemaAccepts = validateSchema(record) === true;
          const validatorAccepts = messages.length === 0;
          const validatorOnly = messages.length > 0 && messages.every((m) => /emoji|ISO 8601 date-time/.test(m));
          if (schemaAccepts !== validatorAccepts && !(schemaAccepts && validatorOnly)) {
            disagreements.push(`${fixture}.jsonl line ${i + 1}`);
          }
        });
    }
    ok(
      `${contract}: schema.json agrees with the validator on ${compared} fixture lines`,
      compared > 0 && disagreements.length === 0,
      disagreements.join(", "),
    );
  }

  // --- schema.json carries the amendment of 2026-10-13: producer rigel, origin kind rigel-ref, one key rule per producer ---
  const inboxSchemaDoc = JSON.parse(readFileSync(join(ROOT, "contracts", "vega-card-inbox.v1", "schema.json"), "utf8"));
  const inboxProducerEnum = inboxSchemaDoc.properties.producer.enum;
  const inboxOriginKindEnum = inboxSchemaDoc.properties.origin.properties.kind.enum;
  const rigelKeyRule = inboxSchemaDoc.allOf.find((rule) => rule.if?.properties?.producer?.const === "rigel");
  ok(
    "vega-card-inbox.v1 schema.json lists producer rigel and origin kind rigel-ref, with the rigel: key prefix rule (one rule per producer)",
    JSON.stringify(inboxProducerEnum) === JSON.stringify(["polaris", "orion", "mira", "aurora", "sirius", "rigel", "manual"]) &&
      inboxOriginKindEnum.length === 9 &&
      inboxOriginKindEnum.includes("rigel-ref") &&
      rigelKeyRule?.then?.properties?.key?.pattern === "^rigel:." &&
      inboxSchemaDoc.allOf.length === inboxProducerEnum.length,
    `${inboxProducerEnum.length} producers, ${inboxOriginKindEnum.length} origin kinds, ${inboxSchemaDoc.allOf.length} key rules`,
  );
  const validInboxFixtureRecords = readFileSync(vegaValidFixture, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  const rigelFixtureLine = validInboxFixtureRecords.find((l) => l.producer === "rigel");
  ok(
    "vega-card-inbox.v1 valid.jsonl carries a rigel line: key rigel:..., origin rigel-ref with an absolute path and a '<ref> · slide N' locator",
    validInboxFixtureRecords.length === 9 &&
      rigelFixtureLine?.key.startsWith("rigel:") === true &&
      rigelFixtureLine?.origin.kind === "rigel-ref" &&
      /^[A-Za-z]:\//.test(rigelFixtureLine?.origin.path ?? "") &&
      /^\S+ · slide \d+$/.test(rigelFixtureLine?.origin.locator ?? ""),
    JSON.stringify(rigelFixtureLine?.origin),
  );

  // --- the JSON examples printed in the two READMEs must pass the validator ---
  for (const contract of ["vega-card-inbox.v1", "mira-embed.v1"]) {
    const readme = readFileSync(join(ROOT, "contracts", contract, "README.md"), "utf8");
    const examples = [...readme.matchAll(/```json\r?\n([\s\S]*?)```/g)].map((m) => JSON.stringify(JSON.parse(m[1])));
    const res = validateJson(contract, writeTemp(`${contract}-readme-examples.jsonl`, `${examples.join("\n")}\n`));
    ok(
      `${contract}: the ${examples.length} JSON examples in its README are valid`,
      examples.length >= 1 && res.ok === true && res.validLines === examples.length,
      JSON.stringify(res.errors.map((e) => `${e.line}: ${e.message}`)),
    );
  }

  // --- the Mermaid diagram of each README: every edge label quoted, <br> (never \n) in node labels, Rigel node and edges ---
  for (const file of ["README.md", "README.vi.md"]) {
    const readme = readFileSync(join(ROOT, file), "utf8");
    const blocks = [...readme.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
    const diagram = blocks.join("\n");
    const edgeLines = diagram.split("\n").filter((l) => /-->|-\.->/.test(l));
    const unquotedEdges = edgeLines.filter((l) => !/(-->|-\.->)\|"[^"]+"\|/.test(l));
    ok(
      `${file}: the Mermaid diagram quotes every edge label, writes line breaks as <br> (never \\n), and has the Rigel node with its two edges`,
      blocks.length === 1 &&
        edgeLines.length > 0 &&
        unquotedEdges.length === 0 &&
        !diagram.includes("\\n") &&
        /Rigel\["[^"\n]*<br>[^"\n]*"\]/.test(diagram) &&
        /Constellation -->\|"[^"]+"\| Rigel\b/.test(diagram) &&
        /Rigel -\.->\|"vega-card-inbox\.v1"\| Vega\b/.test(diagram),
      unquotedEdges.join(" | "),
    );
  }

  // --- personal-data: .sirius/ is the 8th canonical pattern and every description of the patterns agrees ---
  const patternsDoc = JSON.parse(readFileSync(join(ROOT, "contracts", "personal-data", "patterns.json"), "utf8"));
  const patternList = patternsDoc.patterns.map((p) => p.pattern);
  const siriusPattern = patternsDoc.patterns.find((p) => p.pattern === ".sirius/");
  ok(
    "personal-data patterns.json has 8 patterns, with .sirius/ owned by Sirius as personal data",
    patternList.length === 8 &&
      siriusPattern?.category === "personal" &&
      siriusPattern?.owner === "sirius" &&
      siriusPattern?.ownerProject === "Sirius (sirius-mcp)" &&
      siriusPattern?.description.startsWith("Sirius execution journal: study sessions with minutes and outcomes") &&
      siriusPattern?.description.includes("triage.json read by pick_today.py") &&
      siriusPattern?.remediation.includes("git rm -r --cached .sirius/"),
    patternList.join(" "),
  );
  const pdReadme = readFileSync(join(ROOT, "contracts", "personal-data", "README.md"), "utf8");
  const gitignoreFixtures = [
    join(ROOT, "contracts", "fixtures", "valid.gitignore"),
    join(ROOT, "contracts", "personal-data", "fixtures", "valid.gitignore"),
  ];
  ok(
    "personal-data README and both valid.gitignore fixtures list every pattern of patterns.json",
    patternList.every(
      (p) =>
        pdReadme.includes(`\`${p}\``) &&
        gitignoreFixtures.every((f) => readFileSync(f, "utf8").split(/\r?\n/).includes(p)),
    ),
  );
  ok(
    "the two valid.gitignore copies are identical",
    readFileSync(gitignoreFixtures[0], "utf8") === readFileSync(gitignoreFixtures[1], "utf8"),
  );
  const everyPatternPath = writeTemp("every-pattern.gitignore", `${patternList.join("\n")}\n`);
  const everyPatternRes = validateJson("personal-data", everyPatternPath);
  ok(
    "the validator knows exactly the patterns of patterns.json",
    everyPatternRes.ok === true && everyPatternRes.totalLines === patternList.length && everyPatternRes.validLines === patternList.length,
    `${everyPatternRes.validLines}/${everyPatternRes.totalLines} vs ${patternList.length} in patterns.json`,
  );

  const withoutSirius = readFileSync(validGitignoreFixture, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== ".sirius/")
    .join("\n");
  r = await call("eco_contracts", { action: "validate", name: "personal-data", file: writeTemp("legacy-7.gitignore", withoutSirius) });
  ok(
    "a .gitignore written for 0.1.6 (7 patterns) is reported as missing only .sirius/",
    r.isError &&
      textOf(r).includes("7/8 patterns covered") &&
      textOf(r).includes("Missing pattern '.sirius/' (Sirius (sirius-mcp): Sirius execution journal") &&
      (textOf(r).match(/Missing pattern/g) ?? []).length === 1,
    textOf(r).split("\n")[0].slice(-60),
  );
  const coverageOf = (rule) => validateJson("personal-data", writeTemp("sirius-rule.gitignore", `${withoutSirius}\n${rule}\n`));
  const covering = [".sirius", "/.sirius/", ".sirius/*", "**/.sirius/", ".s*"];
  const notCovering = ["sirius/", ".sirius-old/", "!.sirius/", "# .sirius/", ".siriu"];
  ok(
    "rules .sirius, /.sirius/, .sirius/*, **/.sirius/ and .s* cover the .sirius/ pattern",
    covering.every((rule) => coverageOf(rule).ok === true),
    covering.filter((rule) => coverageOf(rule).ok !== true).join(" "),
  );
  ok(
    "rules sirius/, .sirius-old/, !.sirius/, a comment and .siriu do not cover .sirius/",
    notCovering.every((rule) => {
      const res = coverageOf(rule);
      return res.ok === false && res.validLines === 7;
    }),
    notCovering.filter((rule) => coverageOf(rule).ok !== false).join(" "),
  );

  /* ───────── 11. CLI Integration Checks ───────── */
  console.log("\n--- CLI Integration Checks ---");

  const cliBin = join(ROOT, "dist", "constellation.mjs");

  // Help command
  const helpOut = execFileSync(process.execPath, [cliBin, "help"], { env: testEnv, encoding: "utf8" });
  ok("CLI help lists commands", helpOut.includes("Usage: constellation") && helpOut.includes("doctor") && helpOut.includes("health") && helpOut.includes("register"));

  // Version command
  const verOut = execFileSync(process.execPath, [cliBin, "version"], { env: testEnv, encoding: "utf8" }).trim();
  ok("CLI version prints 0.1.8", verOut === "0.1.8");

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
    "CLI contracts validate valid gitignore passes (8/8 patterns)",
    valGitOut.includes("OK: Contract 'personal-data' valid (8/8 patterns covered)"),
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
        out.includes(".polaris/") &&
        out.includes(".sirius/"),
    );
  }
  ok("CLI contracts validate invalid gitignore exits non-zero", invalidGitFailedAsExpected);

  // CLI: contracts list/show/validate for vega-card-inbox.v1 and mira-embed.v1
  const cliListJson = JSON.parse(
    execFileSync(process.execPath, [cliBin, "contracts", "list", "--json"], { env: testEnv, encoding: "utf8" }),
  );
  const cliContract = (name) => cliListJson.find((c) => c.name === name);
  ok(
    "CLI contracts list --json: 7 contracts, the two new ones have validators and every schemaPath exists",
    cliListJson.length === 7 &&
      cliContract("vega-card-inbox.v1")?.hasValidator === true &&
      cliContract("vega-card-inbox.v1")?.type === "data" &&
      cliContract("mira-embed.v1")?.hasValidator === true &&
      cliContract("mira-embed.v1")?.type === "protocol" &&
      cliListJson.filter((c) => c.schemaPath).every((c) => existsSync(c.schemaPath)),
    cliListJson.map((c) => c.name).join(", "),
  );
  const cliListText = execFileSync(process.execPath, [cliBin, "contracts", "list"], { env: testEnv, encoding: "utf8" });
  ok(
    "CLI contracts list prints both new contracts",
    cliListText.includes("vega-card-inbox.v1") && cliListText.includes("mira-embed.v1"),
  );
  const cliShowCard = execFileSync(process.execPath, [cliBin, "contracts", "show", "vega-card-inbox"], { env: testEnv, encoding: "utf8" });
  ok(
    "CLI contracts show vega-card-inbox (short name) prints the contract",
    cliShowCard.includes("# Contract: `vega-card-inbox.v1`") && cliShowCard.includes("Consumer Rules (Vega)"),
  );

  for (const [contract, validFile, invalidFile, validCount, expectations] of [
    [
      "vega-card-inbox.v1",
      vegaValidFixture,
      vegaInvalidFixture,
      9,
      [
        [1, "key: required field is missing"],
        [2, "key: must start with 'orion:'"],
        [3, "difficulty: unknown field"],
        [4, "front: must be at most 600 characters"],
        [5, "origin.kind"],
        [17, "key: must start with 'rigel:'"],
      ],
    ],
    [
      "mira-embed.v1",
      miraValidFixture,
      miraInvalidFixture,
      8,
      [
        [1, "source: must be 'mira'"],
        [4, "source: must be 'aurora'"],
        [6, "event.rating"],
        [7, "event.slideId"],
        [9, "event.type"],
      ],
    ],
  ]) {
    const okOut = execFileSync(process.execPath, [cliBin, "contracts", "validate", contract, validFile], { env: testEnv, encoding: "utf8" });
    ok(
      `CLI contracts validate ${contract} valid fixture passes`,
      okOut.includes(`OK: Contract '${contract}' valid (${validCount}/${validCount} lines)`),
      okOut.slice(0, 80),
    );
    let exitCode = 0;
    let failOut = "";
    try {
      execFileSync(process.execPath, [cliBin, "contracts", "validate", contract, invalidFile], { env: testEnv, encoding: "utf8" });
    } catch (e) {
      exitCode = e.status;
      failOut = String(e.stdout ?? "") + String(e.stderr ?? "");
    }
    ok(
      `CLI contracts validate ${contract} invalid fixture exits 1 with per-line errors`,
      exitCode === 1 && failOut.includes(`FAIL: Contract '${contract}' validation failed`) && expectations.every(([n, needle]) => lineHas(failOut, n, needle)),
      `exit ${exitCode}`,
    );
  }

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
