/**
 * Guide documentation for Constellation MCP.
 */

export const TOPICS = [
  "overview",
  "manifest",
  "agents",
  "health",
  "doctor",
  "update",
  "contracts",
  "rules",
] as const;

export type GuideTopic = (typeof TOPICS)[number];

export const GUIDE_DOCS: Record<GuideTopic, string> = {
  overview: `# Constellation MCP: Ecosystem Control Plane

Constellation is the control plane for the learner's MCP ecosystem:
- One unified manifest of servers (~/.constellation/ecosystem.json).
- One command to register MCP servers across Claude Code, Antigravity, Cursor, and Codex.
- Automated stdio health checks with latency and tool discovery.
- Drift detection engine across all agent configurations and Antigravity copies.
- Safe git-backed updates with fast-forward only, builds, and test runs.
- Shared contracts maintaining cross-project compatibility.

Ecosystem Projects:
- Polaris (https://github.com/DuongNAD/polaris-mcp): Course architect, evidence research, spaced reviews.
- Aurora Slides (https://github.com/DuongNAD/aurora-slides-mcp): Keynote-style decks, interactive learning, progress events.
- Vega (https://github.com/DuongNAD/vega-mcp): FSRS spaced repetition memory engine.
- SmartDrive-OS (https://github.com/DuongNAD/smart-drive-os): SSD governance, index, learning search.
- mcp-agy: Delegation to Google Antigravity.
- Constellation (this project): Registration, health, updates, and shared contracts.`,

  manifest: `# Constellation Manifest (~/.constellation/ecosystem.json)

The manifest is the single source of truth for all MCP servers in your environment.

Example:
\`\`\`json
{
  "version": "1",
  "servers": [
    {
      "name": "aurora-slides",
      "description": "Keynote-style presentation and interactive study engine",
      "repo": "https://github.com/DuongNAD/aurora-slides-mcp",
      "path": "D:/03_Development_Projects/Slide_Projects/my_projects/aurora_slides_mcp",
      "transport": "stdio",
      "command": "node",
      "args": ["D:/03_Development_Projects/Slide_Projects/my_projects/aurora_slides_mcp/dist/aurora.mjs"],
      "agents": ["claude", "antigravity", "cursor", "codex"],
      "build": "node scripts/build.mjs",
      "test": "node scripts/e2e.mjs",
      "health": { "timeoutMs": 20000 }
    }
  ]
}
\`\`\`

Secrets Policy:
- Secrets are referenced using \`\${secret:VAR_NAME}\`.
- Secrets resolve from the process environment or \`~/.constellation/secrets.json\`.
- Secret values are masked with '***' and never saved in plaintext in \`ecosystem.json\`.`,

  agents: `# Supported Coding Agents

Constellation manages registration across five coding agent targets:

1. Claude Code (\`claude\`):
   - Invokes \`claude mcp add --scope user\` / \`claude mcp remove\` CLI commands.
   - Inspects and synchronizes \`~/.claude.json\` as a reliable fallback.

2. Google Antigravity (\`antigravity\`):
   - Synchronizes managed entries across the 3 IDE/GUI Antigravity configuration files:
     * \`~/.gemini/antigravity/mcp_config.json\`
     * \`~/.gemini/config/mcp_config.json\`
     * \`~/.gemini/antigravity-ide/mcp_config.json\`
   - Preserves CRLF line endings, 2-space JSON indentation, and unmanaged servers.

3. Antigravity CLI (\`antigravity-cli\`):
   - Manages \`~/.gemini/antigravity-cli/mcp_config.json\` (used by mcp-agy subagents).
   - Keeps headless subagent configurations decoupled and lightweight.
   - Backwards compatibility: Existing manifests listing only "antigravity" target the IDE files; run 'eco_import' or edit entry to add "antigravity-cli".

4. Cursor IDE (\`cursor\`):
   - Manages \`~/.cursor/mcp.json\` (\`mcpServers\` dictionary).

5. OpenAI Codex (\`codex\`):
   - Manages \`~/.codex/config.toml\` (\`[mcp_servers.<name>]\` tables).
   - Minimal hand-written parser preserves other TOML sections and comments.`,

  health: `# MCP Server Health Checks

Constellation verifies server availability over stdio:
- Connects using the standard MCP SDK Client and StdioClientTransport.
- Executes client initialization and lists registered tools.
- Times startup latency and reports tool count and tool names.
- Enforces strict per-server timeouts (default 20,000 ms).
- Always terminates the child process cleanly.`,

  doctor: `# Ecosystem Doctor & Drift Diagnostic

The doctor checks:
1. Config Drift: Discrepancies between manifest and agent configuration files.
2. Antigravity Copies: Inconsistencies between different Antigravity config copies.
3. Missing Paths: Checks if repository paths, executables, or script files exist on disk.
4. Duplicate Names: Flags duplicate server declarations.
5. Unmanaged Servers: Identifies servers present in agents but absent from the manifest.
6. Secret Leaks: Detects plaintext API keys in configuration files.

Important Antigravity Note:
Antigravity binds tools when a conversation starts. Always open a new conversation 1-2 minutes after starting the application.`,

  update: `# Safe Updates & Builds

The \`eco_update\` tool updates git-backed MCP servers safely:
- Checks git status: If the working tree is dirty, skips pulling to protect changes.
- Pulls only with \`git pull --ff-only\` (never forces, never resets).
- Executes configured \`build\` scripts.
- Runs configured \`test\` scripts.
- Reports status and output for each step.`,

  contracts: `# Shared Ecosystem Contracts

Constellation maintains the shared specifications that keep ecosystem tools aligned:

1. \`aurora-progress-event.v1\`: Interactive learning events (quiz, predict, recall, complete, card) emitted by Aurora and consumed by Polaris and Vega.
2. \`learning-units\`: Standard folder markers (course.json, deck.json, polaris/brief.json) and SmartDrive SSD protection rules.
3. \`post-write-hook\`: Debounced \`smart-drive update <dir> --quiet\` notification hook.
4. \`source-labels\`: "Khóa học" / "Mở rộng" / "chưa xác minh" evidence labels.

Use \`eco_contracts\` to view schemas or validate .jsonl event files.`,

  rules: `# Safety & Operating Rules

1. Rolling Backups: Before writing any agent config file, Constellation creates \`<file>.bak.constellation\`.
2. Atomic Writes: All file writes occur via temporary files and atomic rename.
3. Masking: Any environment variable with KEY, TOKEN, SECRET, PASSWORD, or AUTH is masked as '***'.
4. Dry Runs: All mutation operations support \`dry_run\` to preview diffs before applying changes.
5. No Recursive Scans: Never run recursive scans of D:; access target folders directly.`,
};

export async function getGuideTopic(topic?: string): Promise<string> {
  if (!topic) {
    return [
      `Constellation MCP - Guide Overview`,
      "",
      `Available topics: ${TOPICS.join(", ")}`,
      "",
      GUIDE_DOCS.overview,
    ].join("\n");
  }

  const norm = topic.toLowerCase().trim() as GuideTopic;
  const doc = GUIDE_DOCS[norm];
  if (!doc) {
    return `Unknown topic '${topic}'. Available topics: ${TOPICS.join(", ")}`;
  }
  return doc;
}
