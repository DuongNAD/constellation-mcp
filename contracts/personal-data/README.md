# Contract: `personal-data`

## Purpose
The `personal-data` contract establishes the canonical ignore patterns and confidentiality boundary for the learner's MCP ecosystem (**Polaris**, **Aurora Slides**, **Vega**, **Orion**, **Sirius**, and **SmartDrive-OS**).

When developing, taking courses, or collaborating in public or shared repositories, **personal learning metrics**, **attempt journals**, **spaced-repetition memory intervals**, and **copyrighted third-party research copies** must never be committed to source control.

---

## Sensitive File Categories & Canonical Patterns

| Pattern | Category | Owner Project | Sensitivity Rationale | Remediation If Committed |
|---|---|---|---|---|
| `.vega/` | Personal learning data | Vega (`vega-mcp`) | Vega memory collection (`cards.json`, `reviews.jsonl`), FSRS review history, card stability/difficulty parameters, private learner ratings. | `git rm -r --cached .vega/` (commit removal; rewrite git history if pushed to a public remote) |
| `**/progress.jsonl` | Personal learning data | Aurora Slides (`aurora-slides-mcp`) / Vega / Polaris | Aurora interactive learning events (`aurora-progress-event.v1`): quiz responses, hypothesis predictions, recall outcomes, missed stations, timing. | `git rm --cached **/progress.jsonl` (commit removal; inspect history) |
| `aurora-progress-*.jsonl` | Personal learning data | Aurora Slides (`aurora-slides-mcp`) | Dated or exported learning progress dumps containing individual scores and answers. | `git rm --cached aurora-progress-*.jsonl` (commit removal; inspect history) |
| `orion-attempts.jsonl` | Personal learning data | Orion (`orion-mcp`) | Orion attempt history with hypothesis predictions, terminal experiment outcomes, self-evaluations, and failure logs. | `git rm --cached orion-attempts.jsonl` (commit removal; inspect history) |
| `**/polaris/captures/` | Third-party / copyright | Polaris (`polaris-mcp`) | Full-text captured articles, downloaded PDFs, video transcripts, proprietary lecture notes used as research evidence. | `git rm -r --cached **/polaris/captures/` (commit removal; rewrite git history to avoid copyright infringement) |
| `**/polaris/.cache/` | Regenerable cache | Polaris (`polaris-mcp`) | Raw query responses and HTTP payload caches from external APIs (OpenAlex, arXiv, CrossRef). Regenerable on demand. | `git rm -r --cached **/polaris/.cache/` (commit removal) |
| `.polaris/` | Personal learning data | Polaris (`polaris-mcp`) | Learner profile with study time slots, blackout dates, commitments and study-method preferences (`learner.json`). | `git rm -r --cached .polaris/` (commit removal; check history if published) |
| `.sirius/` | Personal learning data | Sirius (`sirius-mcp`) | Sirius execution journal: study sessions with minutes and outcomes, implementation intentions, task-triage decisions, and the derived `triage.json` read by `pick_today.py`. | `git rm -r --cached .sirius/` (commit removal; check history if published) |

---

## Detailed Specifications

### 1. Vega Memory Collection (`.vega/`)
- **Owner**: [Vega MCP](https://github.com/DuongNAD/vega-mcp)
- **Path layout**: `<workspace>/.vega/cards.json`, `<workspace>/.vega/reviews.jsonl`, `<workspace>/.vega/session/`
- **Why sensitive**: Contains the learner's personal knowledge cards, active recall flashcards, individual response latencies, and FSRS memory weights.
- **Gitignore pattern**: `.vega/`
- **Remediation**:
  ```bash
  git rm -r --cached .vega/
  git commit -m "chore: stop tracking personal Vega memory files"
  ```
  If published to a public repository, consider purging git history:
  ```bash
  git filter-repo --invert-paths --path .vega/
  ```

### 2. Aurora Interactive Learning Events (`**/progress.jsonl`)
- **Owner**: [Aurora Slides MCP](https://github.com/DuongNAD/aurora-slides-mcp), consumed by Polaris and Vega.
- **Path layout**: `<lesson_dir>/progress.jsonl` or `<deck_dir>/progress.jsonl`
- **Why sensitive**: Records real-time student interactions conforming to `aurora-progress-event.v1`. Every submitted quiz choice, prediction text, and recall checkpoint is logged with timestamps.
- **Also written by**: Mira players save the same events (`predict` and `complete`) to `<served_dir>/progress.jsonl` when served by `mira_preview`, and export `aurora-progress-mira-<slug>.jsonl`; both names are covered by the patterns of sections 2 and 3.
- **Gitignore pattern**: `**/progress.jsonl`
- **Remediation**:
  ```bash
  git rm --cached **/progress.jsonl
  git commit -m "chore: untrack personal progress event logs"
  ```

### 3. Exported Aurora Progress Dumps (`aurora-progress-*.jsonl`)
- **Owner**: [Aurora Slides MCP](https://github.com/DuongNAD/aurora-slides-mcp)
- **Path layout**: Files matching `aurora-progress-<date>.jsonl` or `aurora-progress-<id>.jsonl`
- **Why sensitive**: Standalone progress exports generated for backup or external evaluation containing personal quiz records.
- **Gitignore pattern**: `aurora-progress-*.jsonl`
- **Remediation**:
  ```bash
  git rm --cached aurora-progress-*.jsonl
  git commit -m "chore: untrack exported progress event files"
  ```

### 4. Orion Experiment Attempt History (`orion-attempts.jsonl`)
- **Owner**: Orion MCP (`orion-mcp`)
- **Path layout**: `<lab_dir>/orion-attempts.jsonl`
- **Why sensitive**: Preserves learner hypotheses, step-by-step experiment iterations, and automated test verdicts across laboratory exercises.
- **Gitignore pattern**: `orion-attempts.jsonl`
- **Remediation**:
  ```bash
  git rm --cached orion-attempts.jsonl
  git commit -m "chore: untrack Orion laboratory attempts"
  ```

### 5. Polaris Research Captures (`**/polaris/captures/`)
- **Owner**: [Polaris MCP](https://github.com/DuongNAD/polaris-mcp)
- **Path layout**: `<subject>/polaris/captures/<id>.md` or `<subject>/polaris/captures/<id>.pdf`
- **Why sensitive**: Contains complete local copies of copyrighted research papers, scientific preprints, book chapters, and proprietary web pages captured during research phases.
- **Gitignore pattern**: `**/polaris/captures/`
- **Remediation**:
  ```bash
  git rm -r --cached **/polaris/captures/
  git commit -m "chore: untrack external research captures"
  ```

### 6. Polaris API Query Cache (`**/polaris/.cache/`)
- **Owner**: [Polaris MCP](https://github.com/DuongNAD/polaris-mcp)
- **Path layout**: `<subject>/polaris/.cache/`
- **Why sensitive**: Temporary cache files that bloat git repositories. They are automatically recreated by Polaris upon calling research tools.
- **Gitignore pattern**: `**/polaris/.cache/`
- **Remediation**:
  ```bash
  git rm -r --cached **/polaris/.cache/
  git commit -m "chore: untrack polaris cache"
  ```

### 7. Polaris Learner Profile (`.polaris/`)
- **Owner**: [Polaris MCP](https://github.com/DuongNAD/polaris-mcp)
- **Path layout**: `<workspace>/.polaris/learner.json`
- **Why sensitive**: Contains the learner's private study time slots, blackout dates, weekly commitments, and study-method preferences.
- **Gitignore pattern**: `.polaris/`
- **Remediation**:
  ```bash
  git rm -r --cached .polaris/
  git commit -m "chore: untrack polaris learner profile"
  ```
  If published to a public repository, check commit history.

### 8. Sirius Execution Journal (`.sirius/`)
- **Owner**: [Sirius MCP](https://github.com/DuongNAD/sirius-mcp)
- **Path layout**: `<workspace>/.sirius/journal.jsonl` (append-only journal), `<workspace>/.sirius/active.json` (the running session timer), `<workspace>/.sirius/triage.json` (derived file read by the hub's `pick_today.py`), and an optional `<workspace>/.sirius/aliases.json`.
- **Why sensitive**: Records how the learner actually spends time: study sessions with minutes and outcomes, implementation intentions (if-then commitments), task-triage decisions (which overdue tasks were judged superseded, parked or snoozed), and the `triage.json` derived from those decisions.
- **Gitignore pattern**: `.sirius/`
- **Remediation**:
  ```bash
  git rm -r --cached .sirius/
  git commit -m "chore: untrack sirius execution journal"
  ```
  If published to a public repository, check commit history.

---

## Tooling Integration

### SmartDrive-OS (`smart-drive gitignore apply`)
SmartDrive-OS inspects workspace roots and applies these canonical patterns into a dedicated managed block inside `.gitignore`:

```gitignore
# >>> smart-drive managed >>>
.vega/
**/progress.jsonl
aurora-progress-*.jsonl
orion-attempts.jsonl
**/polaris/captures/
**/polaris/.cache/
.polaris/
.sirius/
# <<< smart-drive managed <<<
```

Re-running `smart-drive gitignore apply` updates the managed block idempotently without altering user-defined rules outside the delimiters.

### Polaris Automatic `.gitignore`
When Polaris creates or manages a course workspace, it automatically ensures `polaris/.gitignore` exists with:

```gitignore
captures/
.cache/
```

This acts as a second line of defense even if the workspace root `.gitignore` is missing or misconfigured.

### Sirius Automatic `.sirius/.gitignore`
Before every write into `<workspace>/.sirius/`, Sirius makes sure `.sirius/.gitignore` exists (content `*`; created when missing, never overwritten). The same second line of defense: the journal stays out of git even when the workspace root `.gitignore` lacks `.sirius/`.

---

## Validation Algorithm & Matching Rules

The Constellation contract validator checks whether a given `.gitignore` covers all 8 canonical patterns:

```bash
constellation contracts validate personal-data <path-to-.gitignore>
```

### Coverage Rules:
1. **Direct Match**:
   - Exact line match or normalized match ignoring leading `/`, leading `**/`, or trailing `/`.
   - E.g., `.vega` matches `.vega/`, `.sirius` matches `.sirius/`, `progress.jsonl` matches `**/progress.jsonl`, `polaris/captures/` matches `**/polaris/captures/`.
2. **Broader Parent Directory**:
   - If a directory rule ignores a parent directory, all sub-paths are considered covered.
   - E.g., `polaris/` or `polaris` or `**/polaris/` covers both `**/polaris/captures/` and `**/polaris/.cache/`.
   - `captures/` covers `**/polaris/captures/`.
   - `.cache/` covers `**/polaris/.cache/`.
3. **Broader Wildcard Pattern**:
   - `*.jsonl` or `**/*.jsonl` covers `**/progress.jsonl`, `aurora-progress-*.jsonl`, and `orion-attempts.jsonl`.
   - `aurora-*` covers `aurora-progress-*.jsonl`.
   - `orion-*` covers `orion-attempts.jsonl`.
   - `*` or `**` covers all patterns.

When any canonical patterns are uncovered, the validator exits with non-zero status and explicitly lists each missing pattern, its owning project, and why it is sensitive.
