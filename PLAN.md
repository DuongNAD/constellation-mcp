# Constellation MCP - plan and design

Constellation is the control plane of the learner's MCP ecosystem: one manifest of servers, one command to register
them in every coding agent, health checks, drift detection, safe updates, and the shared contracts that keep the
projects compatible. It is a TypeScript MCP server + CLI, built like its sister projects.

Ecosystem (all by DuongNAD):
- Polaris (https://github.com/DuongNAD/polaris-mcp): course architect (profile, research, roadmap, schedule).
- Aurora Slides (https://github.com/DuongNAD/aurora-slides-mcp): lessons, practice and progress events.
- Vega (https://github.com/DuongNAD/vega-mcp): FSRS spaced repetition memory engine.
- Orion (https://github.com/DuongNAD/orion-mcp): practice labs with real tests and tutoring-ladder hints.
- Sirius (https://github.com/DuongNAD/sirius-mcp): execution loop: deadline sentinel, task triage, today router,
  session timer, weekly plan-vs-actual review.
- Mira (https://github.com/DuongNAD/mira-mcp): code-tracing lab: real Python traces, line-by-line players with
  prediction gates, embeddable in Aurora `trace` slides.
- Rigel (rigel-mcp): grounded Q&A over the learner's lesson materials, refs and coverage; feeds the Vega inbox.
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
1. Never lose a config: back up before writing (one rolling backup per file per run, `*.bak.constellation`, preserving
   the state before the run's first change), write atomically, keep each file's line endings and indentation, change
   only the entries it manages. Write each config file at most once per run.
2. Never leak secrets: env values whose name contains KEY, TOKEN, SECRET, PASSWORD or AUTH are masked in every output
   and are never copied into the manifest or the repository; existing env blocks in agent configs are preserved.
3. BOM-tolerant and credential-safe: strip leading UTF-8 BOM (`\uFEFF`) on reads; doctor reports a notice; register rewrites cleanly without a BOM. Preserve and merge unmanaged env keys present in agent configs so local credentials are never erased.
4. Idempotent and explainable: every write has a dry run that prints the exact diff; re-running changes nothing.
5. Same toolchain discipline: TypeScript, one bundled dist/constellation.mjs, toolchain outside the project
   (CONSTELLATION_TOOLCHAIN, falling back to the Aurora toolchain), no node_modules on D: (exFAT, 512 KB clusters),
   no recursive scans of D:.

## Manifest
User manifest at ~/.constellation/ecosystem.json (path override CONSTELLATION_HOME); a documented example in the repo
(examples/ecosystem.example.json, with no secrets). Entry:
`{name, description, repo?, path?, transport: "stdio", command, args, env?: {NAME: "${secret:NAME}" or plain non-secret
value}, agents: ["claude", "antigravity", "antigravity-cli", "cursor", "codex"], build?, test?, health?: {timeoutMs}}`.
Secrets: `${secret:NAME}` references resolve from the process environment or ~/.constellation/secrets.json (never in
the repo); when importing, secret values found in agent configs are not copied: the entry keeps the reference and the
agent config keeps its value.

## Agents (targets)
- Claude Code (`claude`): through the `claude mcp` CLI (`add --scope user`, `remove`, `get`, `list`), command from
  CONSTELLATION_CLAUDE_CMD or `claude` on PATH; fallback, read-only inspection of ~/.claude.json.
- Antigravity IDE (`antigravity`): the JSON files ~/.gemini/antigravity/mcp_config.json, ~/.gemini/config/mcp_config.json,
  ~/.gemini/antigravity-ide/mcp_config.json; all 3 kept in sync for managed entries; unmanaged entries untouched.
- Antigravity CLI (`antigravity-cli`): ~/.gemini/antigravity-cli/mcp_config.json; used specifically by mcp-agy subagents
  so headless subagent configs remain decoupled and lightweight. Existing manifests listing only "antigravity" target
  the IDE files until `import` is run again or entries are edited.
- Cursor (`cursor`): ~/.cursor/mcp.json.
- Codex (`codex`): ~/.codex/config.toml ([mcp_servers.<name>] tables; minimal, careful TOML edits).
- Paths resolve from the user's home (USERPROFILE / HOME) so tests can point them at a temp folder.
Reference for config formats and edge cases (read only): SmartDrive-OS smart_drive/mcp/registrar.py.

## Tools and CLI
- `eco_status`: one table: each server, which agents have it (and whether the entry matches the manifest), last
  health result, repo state (branch, dirty, ahead/behind) when `path` is a git repo.
- `eco_import {dry_run?}`: bootstrap or refresh the manifest from the existing agent configs (union, de-duplicated,
  secrets turned into references; assigns `antigravity-cli` only to servers found in that file).
- `eco_register {servers?, agents?, dry_run?}` and `eco_unregister {server?, servers?, agents?, dry_run?, forget?}`: collects all changes
  per file and writes each file at most once with a single pre-run backup; `--forget` removes from manifest.
- `eco_health {servers?}`: start each server over stdio with the MCP SDK client, initialize, list tools; report
  start-up time, server name/version, tool count, errors; time-boxed; servers are stopped afterwards.
- `eco_doctor`: drift between agent configs and the manifest (including Antigravity copies and environment variable drift reported by key name only), file integrity diagnostics (UTF-8 BOM notice, single parse error reporting per file to avoid false missing server errors), entries whose command
  or script path does not exist, duplicate names, grouped unmanaged servers (one line per agent), clean notice when
  manifest is empty suggesting `import`, and the Antigravity note (tools bind when a conversation starts).
- `eco_update {servers?, pull?, build?, test?}`: for git-backed servers: `git pull --ff-only` only when the tree is
  clean, then the manifest's build and test commands; never force, never reset; report each step.
- `eco_contracts {action: list | show | validate, name?, file?}`: the shared contracts (below); validate a JSONL or JSON
  file against a contract and report line-level errors.
- Prompts: `ecosystem_setup` (import -> review -> register with dry run -> health -> doctor) and `ecosystem_doctor`.
- CLI mirrors the tools: `status`, `import`, `register`, `unregister`, `health`, `doctor`, `update`, `contracts`,
  `version`, `help`; `--json` for machine output; `--dry-run`; `--forget`.

## Contracts (contracts/ folder, the single source of truth)
- `aurora-progress-event.v1`: the learning event line written by Aurora and read by Polaris & Vega (fields: v, t, course,
  lesson, deck, slide, slideId, type quiz|predict|recall|complete|card and their payloads, quiz chosenText,
  answerText, explanation; card, rating: again/hard/good/easy, ms). Zod schema -> generated JSON Schema file + valid and invalid fixtures.
- `learning-units`: folder markers (course.json, deck.json, polaris/brief.json) and what tools may and may not do to
  them (SmartDrive protection rules).
- `post-write-hook`: `smart-drive update <dir> --quiet` (who calls it, when, how to disable).
- `source-labels`: "Khóa học" / "Mở rộng" / "chưa xác minh" and how Aurora `source` and Polaris fact labels map.
- `personal-data`: canonical ignore patterns for personal learning data (.vega/, **/progress.jsonl, aurora-progress-*.jsonl, orion-attempts.jsonl, .polaris/, .sirius/) and third-party/regenerable files (**/polaris/captures/, **/polaris/.cache/). Includes machine-readable patterns.json and automated .gitignore validator (8 patterns).
- `vega-card-inbox.v1`: the one entry point for review items. Producers (polaris, orion, mira, aurora, sirius, rigel, manual) write
  JSONL card candidates (fields: v, t, producer, key `<producer>:...`, subject, deck, kind basic|cloze|reverse, front, back, hint,
  hook, origin {kind, path, locator, href}, tags, reason; unknown fields rejected) to `<hub>/.vega/inbox/<producer>-<stamp>-<hex>.jsonl`;
  Vega alone validates, de-duplicates by key and schedules with FSRS. Zod validator mirrors the reference consumer (trimmed values,
  code-point lengths, calendar-checked `t`, no emoji in front) and reports per-line errors. Amendment 2026-10-13 (backward
  compatible, still v1): producer `rigel` (Rigel, key `rigel:<subject or course>:<ref>:<first 8 hex of sha1(front)>`) and origin
  kind `rigel-ref` (a citable chunk of a lesson file: `path` = absolute source file, `locator` = `<ref> · <slide/page/section>`,
  `href` optional); consumer and validator accept both values, nothing else changes.
- `mira-embed.v1`: the postMessage protocol between a Mira player and the Aurora deck that embeds it in a `trace` slide:
  player -> parent `ready {title, steps, stops}`, `event {event}` (aurora-progress-event.v1; `predict` relayed, `complete`
  ignored) and `blur`; parent -> player `hello {theme, accent?}`. The parent accepts only messages from its own trace iframes with
  source "mira" and v 1. Validator reads one message per line, in either direction.
Each contract has a Markdown page and, where it is data, a JSON Schema / pattern registry and fixtures that other repositories can use
in their own tests (`contracts/<name>/schema.json`, `contracts/<name>/fixtures/valid|invalid.jsonl`).

## Layout and build
src/ (manifest, agents/{claude, antigravity, cursor, codex}, health, doctor, update, contracts, index = MCP + CLI),
contracts/, examples/, guide/GUIDE.md, scripts/build.mjs, scripts/e2e.mjs, README.md (English) and README.vi.md
(Vietnamese) with the ecosystem map, LICENSE (MIT).

## Tests (e2e, all under %TEMP%)
A fake home with the agent config locations (Antigravity files with CRLF and an unrelated server whose env holds a
fake secret, Antigravity CLI config, Codex TOML, Cursor, Claude), a fake `claude` command that logs its arguments,
and fake MCP server scripts. Checks:
- import masks and references the secret, assigns `antigravity-cli` only to servers present in CLI config;
- register is idempotent, keeps CRLF and unrelated entries, writes each file once per run, and leaves a backup equal to the original file;
- a server targeted at "antigravity" but not "antigravity-cli" is not added to the CLI file and the doctor reports no drift for it;
- doctor groups unmanaged servers into one line per agent, and reports empty manifests cleanly;
- health reports fake server tools and timing, broken server error;
- multi-server unregister writes each file once with a pre-run backup; `--forget` removes manifest entries; second run is a no-op;
- contracts validate valid/invalid fixtures with line numbers (including card events);
- `vega-card-inbox.v1` and `mira-embed.v1`: `list`/`show`/`validate` over MCP and CLI, valid fixtures pass, every invalid fixture
  line is reported by number and rule, boundary cases generated under %TEMP% (600/601 chars, 10/11 tags, calendar dates, BOM, empty
  file, JSON array), and each `schema.json` agrees with the validator on every fixture line (ajv from the toolchain);
  the `rigel` producer and `rigel-ref` origin kind (valid and invalid fixture line, key prefix rule in the validator and in `schema.json`,
  amendment documented in the contract README);
- `personal-data`: valid `.gitignore` fixtures cover 8/8 patterns, a 0.1.6-style block reports `.sirius/` missing, and
  `patterns.json`, the README table and the fixtures list the same patterns as the validator.

## Status
- 2026-10-13: v0.1.8 released. `vega-card-inbox.v1` amended (backward compatible, still v1): producer `rigel` (Rigel) and origin kind
  `rigel-ref` added to the validator, `schema.json` (enums and the `rigel:` key prefix rule), the contract README (amendment section, key
  conventions) and the fixtures (one valid and one invalid `rigel` line); Rigel (rigel-mcp) added to the ecosystem lists (guide overview,
  server instructions, README tables and diagrams), no repository link.
- 2026-10-12: v0.1.7 released. New shared contracts `vega-card-inbox.v1` (one adaptive review queue: producers drop card
  candidates in `<hub>/.vega/inbox/`, Vega alone validates, dedupes and schedules) and `mira-embed.v1` (postMessage protocol between
  Mira players and Aurora `trace` slides), each with README, JSON Schema, fixtures and a line validator reachable through
  `eco_contracts` and `constellation contracts validate`; `personal-data` gains `.sirius/` (8 patterns); Orion, Sirius and Mira added
  to the guide overview, server instructions, README tables and diagram. New contracts are patch releases, as with `personal-data` in 0.1.3.
- 2026-10-11: v0.1.6 released. Register resolves ${secret:NAME} (env, then ~/.constellation/secrets.json) instead of
  writing the placeholder, refuses unresolvable secrets, and compares real values so rotated keys propagate; doctor
  flags leftover placeholders and secrets that differ from the store.
- 2026-10-11: v0.1.5 released. UTF-8 BOM tolerance on JSON reads with doctor notices and clean BOM-less rewrites on register; resilient file-level parse error reporting without cascading false missing server warnings; env drift detection reporting unmanaged server env keys by name only (values masked) with fix instructions; registration merges and preserves unmanaged env keys without data loss.
- 2026-10-11: v0.1.4 released. Added ".polaris/" as 7th canonical ignore pattern to personal-data contract protecting Polaris learner profiles (<hub>/.polaris/learner.json), updated valid .gitignore fixtures, docs, and e2e test expectations (7/7 patterns).
- 2026-10-11: v0.1.3 released. Added "personal-data" shared contract with machine-readable patterns.json, canonical ignore patterns for Vega (.vega/), Aurora (progress.jsonl), Orion (orion-attempts.jsonl), and Polaris (captures, cache), automated .gitignore validation CLI/MCP with parent directory and wildcard support, and SmartDrive-OS managed block alignment.
- 2026-10-11: v0.1.2 released. Added "card" event to aurora-progress-event.v1 contract for Vega FSRS memory engine integration, multi-server unregister with atomic single-write per file and pre-run backup, and --forget manifest removal.
- 2026-10-11: v0.1.1 released. Fixed backups to be fully reversible with single backup/write per run, split `antigravity-cli` agent target, compact doctor reports with grouped unmanaged servers and empty manifest handling.
- 2026-10-11: v0.1.0 built and verified with TypeScript typecheck, e2e integration tests, stdio health checks, drift doctor, and shared contract validation.
