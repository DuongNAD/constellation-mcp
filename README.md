[Tiếng Việt](README.vi.md) | **English**

# Constellation MCP

Control plane of the learner's MCP ecosystem: one manifest of servers, one command to register them across coding agents (Claude Code, Google Antigravity, Antigravity CLI, Cursor, Codex), automated health checks, drift doctor, safe updates, and shared contracts.

```mermaid
flowchart TD
  subgraph Ecosystem["Ecosystem by DuongNAD"]
    Polaris["Polaris MCP\n(Course Architect & Retention)"]
    Aurora["Aurora Slides MCP\n(Keynote Decks & Practice)"]
    SmartDrive["SmartDrive-OS\n(SSD Governance & Index)"]
    McpAgy["mcp-agy\n(Antigravity Delegation)"]
  end

  subgraph ControlPlane["Control Plane"]
    Constellation["Constellation MCP\n(~/.constellation/ecosystem.json)"]
  end

  subgraph Agents["Coding Agents"]
    Claude["Claude Code\n(~/.claude.json)"]
    Antigravity["Google Antigravity IDE\n(~/.gemini/*/mcp_config.json)"]
    AntigravityCli["Antigravity CLI\n(~/.gemini/antigravity-cli/mcp_config.json)"]
    Cursor["Cursor IDE\n(~/.cursor/mcp.json)"]
    Codex["OpenAI Codex\n(~/.codex/config.toml)"]
  end

  Constellation -->|Registers & Syncs| Claude
  Constellation -->|Registers & Syncs CRLF| Antigravity
  Constellation -->|Registers & Syncs CLI| AntigravityCli
  Constellation -->|Registers & Syncs| Cursor
  Constellation -->|Registers & Syncs TOML| Codex

  Constellation -->|Health & Updates| Polaris
  Constellation -->|Health & Updates| Aurora
  Constellation -->|Health & Updates| SmartDrive
  Constellation -->|Health & Updates| McpAgy

  Aurora -.->|aurora-progress-event.v1| Polaris
  Polaris -.->|post-write-hook| SmartDrive
  Aurora -.->|post-write-hook| SmartDrive
```

---

## Why Constellation

When orchestrating multiple MCP servers across different coding assistants, several points of friction arise:
1. Each server must be manually added to Claude Code and multiple Antigravity configuration files (`~/.gemini/antigravity`, `~/.gemini/config`, and `~/.gemini/antigravity-ide` `mcp_config.json` with CRLF line endings) as well as `~/.gemini/antigravity-cli/mcp_config.json`.
2. Different IDE agents overwrite or desynchronize config files.
3. Starting conversations before a server finishes initialization leads to missing tool binding.
4. Headless subagents (like `mcp-agy`) need lightweight configurations without every heavy GUI tool loaded.
5. Shared contracts between tools (e.g. progress event v1, learning-unit markers, post-write hooks, and source labels) drift if not anchored in a single source of truth.

Constellation unifies all configuration and verification into a single, automated control plane.

---

## Principles

1. **Never Lose a Config**: Rolling backups (`<file>.bak.constellation`) are created before the run's first change, ensuring a run is fully reversible. Each config file is written at most once per run. Writes are atomic and preserve original line endings (`CRLF`/`LF`) and 2-space indentation. Unmanaged entries are left untouched.
2. **Never Leak Secrets**: Environment variables matching `/KEY|TOKEN|SECRET|PASSWORD|AUTH/i` are masked as `"***"` across all outputs and diffs. The manifest stores references (`${secret:NAME}`) rather than plaintext secrets.
3. **Idempotent and Explainable**: Every command supports a dry run that produces exact diffs before touching disk.
4. **Toolchain Discipline**: Built with TypeScript into a single standalone bundle (`dist/constellation.mjs`) using an external toolchain (`CONSTELLATION_TOOLCHAIN`), keeping exFAT workspaces free of `node_modules`.

---

## Supported Agents

- **Claude Code** (`claude`): Invokes `claude mcp add` / `claude mcp remove` CLI commands; inspects and updates `~/.claude.json`.
- **Google Antigravity** (`antigravity`): Keeps the 3 IDE/GUI copies in sync (`~/.gemini/antigravity`, `~/.gemini/config`, `~/.gemini/antigravity-ide`).
- **Antigravity CLI** (`antigravity-cli`): Manages `~/.gemini/antigravity-cli/mcp_config.json` for headless subagents (used by `mcp-agy`). Existing manifests listing only `"antigravity"` target the IDE files; run `import` to update.
- **Cursor IDE** (`cursor`): Manages `~/.cursor/mcp.json`.
- **OpenAI Codex** (`codex`): Manages `~/.codex/config.toml` tables.

---

## Installation & Connection

### 1. Build the Binary
```bash
# Set external toolchain path
$env:CONSTELLATION_TOOLCHAIN = "C:\Users\Admin\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\aurora-slides\toolchain"

# Typecheck and bundle
node scripts/build.mjs --check
```

### 2. Connect as an MCP Server
Add Constellation to your agent configuration:

```json
{
  "mcpServers": {
    "constellation": {
      "command": "node",
      "args": ["D:/03_Development_Projects/ai_agents/constellation_mcp/dist/constellation.mjs"]
    }
  }
}
```

---

## Tools Reference

| Tool Name | Purpose |
|---|---|
| `eco_status` | Status matrix showing server registration across all agents, sync state, and Git status. |
| `eco_import` | Scans existing agent configs and bootstraps `~/.constellation/ecosystem.json` with secret references. |
| `eco_register` | Synchronizes servers from manifest into Claude Code, Antigravity, Antigravity CLI, Cursor, and Codex. |
| `eco_unregister` | Safely removes a server from targeted agent configurations. |
| `eco_health` | Starts child servers over stdio, performs client handshakes, lists tools, and records latencies. |
| `eco_doctor` | Detects config drift, missing file paths, Antigravity copy mismatches, and groups unmanaged servers. |
| `eco_update` | Pulls (`git pull --ff-only` on clean trees) and runs configured `build` and `test` scripts. |
| `eco_contracts` | Lists shared contracts, displays specifications, and validates JSON/JSONL progress event files. |

---

## CLI Reference

The CLI mirrors all MCP tools:

```bash
# View status
node dist/constellation.mjs status

# Import from existing agent configs
node dist/constellation.mjs import --dry-run
node dist/constellation.mjs import

# Register servers
node dist/constellation.mjs register --dry-run
node dist/constellation.mjs register polaris aurora-slides

# Health check
node dist/constellation.mjs health

# Doctor diagnostic
node dist/constellation.mjs doctor

# Validate contract fixtures
node dist/constellation.mjs contracts validate aurora-progress-event.v1 contracts/fixtures/valid-progress.jsonl
```

---

## Shared Contracts

1. [`aurora-progress-event.v1`](contracts/aurora-progress-event.v1/README.md): Interactive learning event specification emitted by Aurora and consumed by Polaris.
2. [`learning-units`](contracts/learning-units/README.md): Protected folder markers (`course.json`, `deck.json`, `polaris/brief.json`) and SmartDrive SSD rules.
3. [`post-write-hook`](contracts/post-write-hook/README.md): Debounced `smart-drive update <dir> --quiet` notification standard.
4. [`source-labels`](contracts/source-labels/README.md): "Khóa học" / "Mở rộng" / "chưa xác minh" label mappings.

---

## Version History

- **0.1.1** (2026-10-11):
  - **Reversible Backups**: Batch changes per config file; each file is written at most once per run, and rolling backups (`*.bak.constellation`) capture the exact state before the run.
  - **Antigravity CLI Agent Target**: Split `antigravity-cli` (`~/.gemini/antigravity-cli/mcp_config.json`) from `antigravity` (3 IDE copies) to support minimal subagent setups without spurious drift warnings.
  - **Compact Doctor Report**: Group unmanaged servers into a single line per agent; cleanly report empty manifests with import guidance; maintain one-line drift reporting with exact fixes.
- **0.1.0** (2026-10-11): Initial release with 9 MCP tools, CLI, multi-agent registration, stdio health checks, drift diagnostics, safe update engine, and shared contracts validation.

---

## License

MIT (c) 2026 DuongNAD
