# Constellation MCP: Ecosystem Control Plane Guide

Constellation is the control plane for the learner's MCP ecosystem:
- One manifest of servers (`~/.constellation/ecosystem.json`).
- One command to register them in every coding agent (Claude Code, Google Antigravity, Cursor, Codex).
- Stdio health checks and tool discovery.
- Drift detection engine across all agent configurations.
- Safe git-backed updates with fast-forward only.
- Shared contracts maintaining cross-project compatibility.

```mermaid
flowchart TD
  subgraph Ecosystem["Ecosystem by DuongNAD"]
    Polaris["Polaris MCP<br>(Course Architect & Retention)"]
    Aurora["Aurora Slides MCP<br>(Decks & Interactive Learning)"]
    SmartDrive["SmartDrive-OS<br>(SSD Governance & Search)"]
    McpAgy["mcp-agy<br>(Antigravity Delegation)"]
  end

  subgraph ControlPlane["Control Plane"]
    Constellation["Constellation MCP<br>(~/.constellation/ecosystem.json)"]
  end

  subgraph Agents["Coding Agents"]
    Claude["Claude Code<br>(~/.claude.json)"]
    Antigravity["Google Antigravity<br>(~/.gemini/*/mcp_config.json)"]
    Cursor["Cursor IDE<br>(~/.cursor/mcp.json)"]
    Codex["OpenAI Codex<br>(~/.codex/config.toml)"]
  end

  Constellation -->|"Manages & Registers"| Claude
  Constellation -->|"Manages & Syncs CRLF"| Antigravity
  Constellation -->|"Manages"| Cursor
  Constellation -->|"Manages TOML"| Codex

  Constellation -->|"Health & Updates"| Polaris
  Constellation -->|"Health & Updates"| Aurora
  Constellation -->|"Health & Updates"| SmartDrive
  Constellation -->|"Health & Updates"| McpAgy

  Aurora -->|"aurora-progress-event.v1"| Polaris
  Polaris -->|"post-write-hook"| SmartDrive
  Aurora -->|"post-write-hook"| SmartDrive
```

---

## Ecosystem Table

All projects by DuongNAD:

| Project | Role | Repository |
| :--- | :--- | :--- |
| **Polaris** | Course architect: sources, facts with locators, roadmap, schedule, error log | [polaris-mcp](https://github.com/DuongNAD/polaris-mcp) |
| **Aurora Slides** | Keynote-style lessons: quizzes, predict and trace slides, progress events | [aurora-slides-mcp](https://github.com/DuongNAD/aurora-slides-mcp) |
| **Vega** | FSRS memory engine and the single review queue (card inbox) | [vega-mcp](https://github.com/DuongNAD/vega-mcp) |
| **Orion** | Practice labs with real tests, tutoring ladder and PRIMM warm-up | [orion-mcp](https://github.com/DuongNAD/orion-mcp) |
| **Mira** | Code-tracing lab: real Python traces, line-by-line players with prediction gates | [mira-mcp](https://github.com/DuongNAD/mira-mcp) |
| **Rigel** | Grounded tutor: answers from the learner's lesson materials with [ref] citations | [rigel-mcp](https://github.com/DuongNAD/rigel-mcp) |
| **Sirius** | Execution loop: deadlines, triage, today router, session timer, weekly review | [sirius-mcp](https://github.com/DuongNAD/sirius-mcp) |
| **Constellation** | MCP registration, health checks and shared contracts | [constellation-mcp](https://github.com/DuongNAD/constellation-mcp) |
| **SmartDrive-OS** | SSD governance, index and learning search | [smart-drive-os](https://github.com/DuongNAD/smart-drive-os) |

### Connections

- Registers every server in Claude Code, Antigravity, Cursor and Codex, checks health and drift, and owns the shared contracts: `aurora-progress-event.v1`, `vega-card-inbox.v1`, `mira-embed.v1`, `personal-data`, `learning-units`, `post-write-hook`, `source-labels`.

---

## 1. Manifest (`ecosystem.json`)

Located at `~/.constellation/ecosystem.json` (or `$CONSTELLATION_HOME/ecosystem.json`).

### Schema Definition
- `version`: String version identifier (e.g. `"1"`).
- `servers`: Array of server configuration objects:
  - `name`: Unique server name (e.g. `"polaris"`).
  - `description`: Purpose of the MCP server.
  - `repo`: Optional Git repository URL.
  - `path`: Optional local filesystem path.
  - `transport`: Currently `"stdio"`.
  - `command`: Executable command (e.g. `"node"`, `"python"`).
  - `args`: Array of command line arguments.
  - `env`: Optional environment variables. Secrets use `${secret:NAME}` references.
  - `agents`: Target agents array (`["claude", "antigravity", "cursor", "codex"]`).
  - `build`: Optional build command.
  - `test`: Optional test command.
  - `health`: Optional `{ "timeoutMs": 20000 }`.

---

## 2. Supported Agents

1. **Claude Code (`claude`)**:
   - Registered via `claude mcp add --scope user` or fallback direct sync in `~/.claude.json`.
2. **Google Antigravity (`antigravity`)**:
   - Reconciles across `~/.gemini/antigravity/mcp_config.json`, `~/.gemini/config/mcp_config.json`, `~/.gemini/antigravity-ide/mcp_config.json`, and `~/.gemini/antigravity-cli/mcp_config.json`.
   - Preserves CRLF line endings and 2-space indentation.
3. **Cursor IDE (`cursor`)**:
   - Manages `~/.cursor/mcp.json`.
4. **OpenAI Codex (`codex`)**:
   - Manages `~/.codex/config.toml` (`[mcp_servers.<name>]` tables).

---

## 3. Tool Reference

- `eco_status {server?}`: Displays unified registration and drift matrix across all agents.
- `eco_import {dry_run?}`: Imports existing agent configurations into the manifest with secret masking.
- `eco_register {servers?, agents?, dry_run?}`: Registers servers in agent configuration files with rolling backups.
- `eco_unregister {server, agents?, dry_run?}`: Removes a server from targeted agent configurations.
- `eco_health {servers?, timeout_ms?}`: Executes stdio client handshakes and tool discovery.
- `eco_doctor`: Detects configuration drift, missing file paths, duplicate servers, and Antigravity copy mismatches.
- `eco_update {servers?, pull?, build?, test?}`: Performs safe `git pull --ff-only` on clean trees, then runs builds and tests.
- `eco_contracts {action, name?, file?}`: Lists shared contracts, displays specs, or validates data files (`aurora-progress-event.v1` events, `vega-card-inbox.v1` card lines, `mira-embed.v1` messages, `personal-data` .gitignore coverage).

---

## 4. Safety Principles

- **Rolling Backups**: Every write generates `<file>.bak.constellation`.
- **Atomic Writes**: Writes occur to temporary files and rename atomically.
- **Zero Secret Leaks**: Any environment variable matching `/KEY|TOKEN|SECRET|PASSWORD|AUTH/i` is masked as `"***"` and stored as `${secret:NAME}`.
- **Idempotent**: Re-running registration produces zero changes when files match.
- **No Recursive Scans**: Direct path access only; no whole-drive scanning.
