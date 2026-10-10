# Constellation MCP - plan and design

Constellation is the control plane of the learner's MCP ecosystem: one manifest of servers, one command to register
them in every coding agent, health checks, drift detection, safe updates, and the shared contracts that keep the
projects compatible. It is a TypeScript MCP server + CLI, built like its sister projects.

Ecosystem (all by DuongNAD):
- Polaris (https://github.com/DuongNAD/polaris-mcp): course architect (profile, research, roadmap, schedule).
- Aurora Slides (https://github.com/DuongNAD/aurora-slides-mcp): lessons, practice and progress events.
- SmartDrive-OS (https://github.com/DuongNAD/smart-drive-os): exFAT SSD governance, index and learning search.
- mcp-agy: delegates coding work to Google Antigravity.
- Constellation (this project): registration, health, updates, contracts.

## Why
Observed on 2026-10-10 while connecting Aurora and Polaris: each server had to be added by hand to Claude Code and to
three Antigravity config files (~/.gemini/antigravity, ~/.gemini/config and ~/.gemini/antigravity-ide
mcp_config.json, CRLF line endings, backups); Antigravity's own agent copied one config over the others; a
conversation opened before a server finished loading reported "tool ... is not enabled for server ..."; and the
contracts between projects (progress event v1, learning-unit markers, the post-write hook, source labels) were
described separately in three READMEs. Constellation makes all of that one source of truth with one command.

## Principles
1. Never lose a config: back up before writing (one rolling backup per file, `*.bak.constellation`), write
   atomically, keep each file's line endings and indentation, change only the entries it manages.
2. Never leak secrets: env values whose name contains KEY, TOKEN, SECRET, PASSWORD or AUTH are masked in every output
   and are never copied into the manifest or the repository; existing env blocks in agent configs are preserved.
3. Idempotent and explainable: every write has a dry run that prints the exact diff; re-running changes nothing.
4. Same toolchain discipline: TypeScript, one bundled dist/constellation.mjs, toolchain outside the project
   (CONSTELLATION_TOOLCHAIN, falling back to the Aurora toolchain), no node_modules on D: (exFAT, 512 KB clusters),
   no recursive scans of D:.

## Manifest
User manifest at ~/.constellation/ecosystem.json (path override CONSTELLATION_HOME); a documented example in the repo
(examples/ecosystem.example.json, with no secrets). Entry:
`{name, description, repo?, path?, transport: "stdio", command, args, env?: {NAME: "${secret:NAME}" or plain non-secret
value}, agents: ["claude", "antigravity", "cursor", "codex"], build?, test?, health?: {timeoutMs}}`.
Secrets: `${secret:NAME}` references resolve from the process environment or ~/.constellation/secrets.json (never in
the repo); when importing, secret values found in agent configs are not copied: the entry keeps the reference and the
agent config keeps its value.

## Agents (targets)
- Claude Code: through the `claude mcp` CLI (`add --scope user`, `remove`, `get`, `list`), command from
  CONSTELLATION_CLAUDE_CMD or `claude` on PATH; fallback, read-only inspection of ~/.claude.json.
- Antigravity: the JSON files ~/.gemini/antigravity/mcp_config.json, ~/.gemini/config/mcp_config.json,
  ~/.gemini/antigravity-ide/mcp_config.json (and ~/.gemini/antigravity-cli/mcp_config.json when it exists); all kept in
  sync for managed entries; unmanaged entries untouched.
- Cursor: ~/.cursor/mcp.json. Codex: ~/.codex/config.toml ([mcp_servers.<name>] tables; minimal, careful TOML edits).
- Paths resolve from the user's home (USERPROFILE / HOME) so tests can point them at a temp folder.
Reference for config formats and edge cases (read only): SmartDrive-OS smart_drive/mcp/registrar.py.

## Tools (v0.1) and CLI
- `eco_status`: one table: each server, which agents have it (and whether the entry matches the manifest), last
  health result, repo state (branch, dirty, ahead/behind) when `path` is a git repo.
- `eco_import {dry_run?}`: bootstrap or refresh the manifest from the existing agent configs (union, de-duplicated,
  secrets turned into references).
- `eco_register {servers?, agents?, dry_run?}` and `eco_unregister {server, agents?, dry_run?}`.
- `eco_health {servers?}`: start each server over stdio with the MCP SDK client, initialize, list tools; report
  start-up time, server name/version, tool count, errors; time-boxed; servers are stopped afterwards.
- `eco_doctor`: drift between agent configs and the manifest (including the Antigravity copies), entries whose command
  or script path does not exist, duplicate names, servers present in agents but not in the manifest, and the
  Antigravity note (tools bind when a conversation starts; open a new conversation 1-2 minutes after the app starts).
- `eco_update {servers?, pull?, build?, test?}`: for git-backed servers: `git pull --ff-only` only when the tree is
  clean, then the manifest's build and test commands; never force, never reset; report each step.
- `eco_contracts {action: list | show | validate, name?, file?}`: the shared contracts (below); validate a JSONL or JSON
  file against a contract and report line-level errors.
- Prompts: `ecosystem_setup` (import -> review -> register with dry run -> health -> doctor) and `ecosystem_doctor`.
- CLI mirrors the tools: `status`, `import`, `register`, `unregister`, `health`, `doctor`, `update`, `contracts`,
  `version`, `help`; `--json` for machine output; `--dry-run`.

## Contracts (contracts/ folder, the single source of truth)
- `aurora-progress-event.v1`: the learning event line written by Aurora and read by Polaris (fields: v, t, course,
  lesson, deck, slide, slideId, type quiz|predict|recall|complete and their payloads, optional quiz chosenText,
  answerText, explanation). Zod schema -> generated JSON Schema file + valid and invalid fixtures.
- `learning-units`: folder markers (course.json, deck.json, polaris/brief.json) and what tools may and may not do to
  them (SmartDrive protection rules).
- `post-write-hook`: `smart-drive update <dir> --quiet` (who calls it, when, how to disable).
- `source-labels`: "Khóa học" / "Mở rộng" / "chưa xác minh" and how Aurora `source` and Polaris fact labels map.
Each contract has a Markdown page and, where it is data, a JSON Schema and fixtures that other repositories can use
in their own tests.

## Layout and build
src/ (manifest, agents/{claude, antigravity, cursor, codex}, health, doctor, update, contracts, index = MCP + CLI),
contracts/, examples/, guide/GUIDE.md, scripts/build.mjs, scripts/e2e.mjs, README.md (English) and README.vi.md
(Vietnamese) with the ecosystem map, LICENSE (MIT).

## Tests (e2e, all under %TEMP%)
A fake home with the four agent config locations (Antigravity files with CRLF and an unrelated server whose env
holds a fake secret), a fake `claude` command that logs its arguments, and a tiny fake MCP server script. Checks:
import masks and references the secret; register is idempotent, keeps CRLF and unrelated entries, writes one rolling
backup, and dry run changes nothing; drift detection finds a hand-edited Antigravity copy; health reports the fake
server's tools and timing and a broken server's error; unregister removes only the managed entry; contracts validate
the fixtures (valid passes, invalid fails with line numbers); no secret value appears in any output.

## Status
- 2026-10-11: plan written; v0.1 to be built.
