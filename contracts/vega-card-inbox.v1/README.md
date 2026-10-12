# Contract: `vega-card-inbox.v1`

## Purpose
`vega-card-inbox.v1` is the single entry point for review items in the learner's MCP ecosystem. It is shared by **Vega** (the consumer), **Polaris**, **Orion** and **Mira** (producers; **Aurora** and **Sirius** are also allowed producers) and **Constellation** (the validator).

Evidence on spaced practice (Latimier et al. 2021; Lindsey et al. 2014; Rawson and Dunlosky 2011) favours one adaptive spacing scheduler over several fixed ones, and two schedulers create review debt. So every producer of review items (Polaris error log and lesson self-checks, Orion repeated failures, Mira missed prediction stops, future Aurora exports) drops **card candidates** into Vega's inbox, and **Vega alone** validates, deduplicates and schedules them with FSRS. Producers never write `.vega/cards.json` or `.vega/reviews.jsonl`.

---

## Location and Files

- **Folder**: `<hub>/.vega/inbox/` (hub = the learning hub root, default `D:/02_Learning_Knowledge`; each producer uses its usual hub setting). Create the folder if it is missing.
- **One new file per producer batch**: `<producer>-<YYYYMMDDTHHmmss>-<6 lowercase hex>.jsonl`, for example `mira-20261012T213005-a1b2c3.jsonl`. UTF-8, one JSON object per line, trailing newline.
- **Atomic writes**: write `<name>.jsonl.tmp` in the same folder, then rename. Consumers ignore `*.tmp`. Producers never append to or rewrite an existing inbox file.
- **After processing**, Vega moves the file to `<hub>/.vega/inbox/done/` and writes the invalid lines (with an added `_error` field) to `<hub>/.vega/inbox/rejected/<same file name>`. Files in `rejected/` therefore intentionally fail this contract's validator.
- **Personal data**: everything under `.vega/` is git-ignored by the [`personal-data`](../personal-data/README.md) contract.

---

## Line Schema

Every line is one JSON object. **Unknown fields are rejected**, at the top level and inside `origin`.

| Field | Type | Rule |
|---|---|---|
| `v` | integer | Required, literal `1`. |
| `t` | string | Required, ISO 8601 date-time with an offset or `Z` (for example `2026-10-12T21:04:10+07:00`). |
| `producer` | string | Required, one of `polaris`, `orion`, `mira`, `aurora`, `sirius`, `manual`. |
| `key` | string | Required, 1-200 chars, stable dedupe key. MUST start with `<producer>:` followed by an identifier. |
| `subject` | string | Required, 1-120 chars (subject folder name such as `Machine_Learning`, or its display name). |
| `deck` | string | Optional, at most 120 chars (lesson, module, lab, or player title). |
| `kind` | string | Optional: `basic` (default), `cloze`, `reverse`. |
| `front` | string | Required, 1-600 chars, learner language (Vietnamese). Inline markup allowed (`**bold**`, `` `code` ``, `$math$`, `[[cloze]]` for kind `cloze`). One idea per card. No emoji. |
| `back` | string | Required, 0-1200 chars (may be empty). |
| `hint` | string | Optional, at most 200 chars. |
| `hook` | string | Optional, at most 200 chars (memory hook). |
| `origin` | object | Required: `kind` is one of `polaris-fact`, `polaris-errorlog`, `polaris-selfcheck`, `aurora-quiz`, `aurora-predict`, `orion-attempt`, `mira-stop`, `manual`; `path` is a string of 1-400 chars (file or folder); `locator` is optional, at most 120 chars; `href` is optional, at most 400 chars (a link that opens the origin, for example a Mira player with `#stop-3`). |
| `tags` | string[] | Optional, at most 10 items, each 1-40 chars. |
| `reason` | string | Optional, at most 200 chars: why the card was created (for example `Dự đoán sai ở điểm dừng 3`). |

**Example line** (wrapped here for reading; a real line is one physical line):

```json
{"v":1,"t":"2026-10-12T21:30:05+07:00","producer":"mira","key":"mira:dem-chan:stop-3","subject":"Python_Master",
 "front":"Dò `for x in [3, 8, 5, 12]: dem += x % 2 == 0` với `dem = 0`: sau lần lặp thứ hai, `dem` bằng bao nhiêu?",
 "back":"`1`: với `x = 3` biểu thức là `False` (cộng 0); với `x = 8` là `True` (cộng 1).",
 "origin":{"kind":"mira-stop","path":"Python_Master/mira/dem-chan/index.html","locator":"stop 3",
           "href":"file:///D:/02_Learning_Knowledge/Python_Master/mira/dem-chan/index.html#stop-3"},
 "tags":["mira"],"reason":"Dự đoán sai ở điểm dừng 3"}
```

### How the rules are applied

The reference consumer (Vega) and the Constellation validator apply the table the same way:

- **Trimming**: leading and trailing whitespace is ignored before any length check, so a whitespace-only value counts as empty.
- **Length unit**: lengths count Unicode code points (characters), like JSON Schema `maxLength` and Python `len()`, not UTF-16 units or bytes.
- **Time**: `t` must be a real calendar date and time (month 1-12, existing day, hour 0-23, minute and second 0-59) with `Z` or an offset such as `+07:00`.
- **Key**: `key` must start with `<producer>:` and have at least one more character, and must not contain control characters (newline, tab, ...).
- **Emoji**: `front` must not contain emoji (emoji-presentation characters or the emoji variation selector U+FE0F). Producers should keep every learner-facing field emoji-free.
- **Unknown fields**: rejected at the top level and inside `origin`.
- **Encoding**: the file must be valid UTF-8. A leading BOM is tolerated, but producers should write UTF-8 without BOM. The validator reports a JSON array in place of JSON Lines as one error.

---

## Consumer Rules (Vega)

- Ingest on `vega_sync` (before reading progress events) and on `vega_inbox { action: "ingest" }`.
- Per line: validate; if a card with the same `key` exists (active, suspended or soft-deleted), skip it as a duplicate; otherwise create a new card (FSRS state New, `created` = the line's `t`, plus `subject`, `deck`, `kind`, `front`, `back`, `hint`, `hook`, `origin`, `tags` and `key`).
- After a file is processed: move it to `<hub>/.vega/inbox/done/`; write invalid lines (with an added `_error` field) to `<hub>/.vega/inbox/rejected/<same file name>`. Ingest is idempotent (keys) and never touches other files.
- Report: files read, cards created, duplicates skipped, lines rejected (with reasons).

---

## Producer Key Conventions

| Producer | Key shape |
|---|---|
| Polaris error log | `polaris:<subject folder name>:<entry id>` (entry ids like `ERR_2026-10-12_ab12cd`) |
| Polaris lesson self-check | `polaris:<subject folder name>:selfcheck:<module id>:<index>` |
| Orion | `orion:<lab folder name>:<check key>` |
| Mira | `mira:<player slug>:stop-<k>` |

A key must stay stable for the same underlying item: it is how Vega recognises a duplicate across batches.

---

## Card Content Guidance (Producers)

- **Quiz miss**: `front` = the question; `back` = the correct answer (plus a short explanation).
- **Prediction miss** (Aurora predict, Mira stop): `front` = what to predict, with the minimal code context in inline code (for example ``Dò `tong_chu_so(-4567)`: sau dòng 6 ở vòng lặp đầu, `tong` bằng bao nhiêu?``); `back` = the real value and why; `origin.href` opens the exact place.
- **Error log entry**: `front` = the situation to re-solve (never "reread X"); `back` = the root cause and the rule or fix.
- **Self-check**: `front` = the question; `back` = the answer.

---

## Validation

```bash
constellation contracts validate vega-card-inbox.v1 <path-to-file.jsonl>
```

The same check is available as `eco_contracts { action: "validate", name: "vega-card-inbox.v1", file }`. It reports every problem per line (`Line 4: front: must be at most 600 characters (got 601)`) and an OK summary such as `OK: Contract 'vega-card-inbox.v1' valid (8/8 lines)`.

The validator checks line content only. File naming, atomic writes and the `done/` and `rejected/` folders are producer and consumer responsibilities and are not checked.

## Files in This Folder

- `schema.json`: JSON Schema (draft-07) for one line. It covers structure, enums, lengths and the producer-key prefix rule. Two rules are enforced by the Constellation validator only because portable JSON Schema cannot express them: no emoji in `front`, and `t` being a real calendar date-time.
- `fixtures/valid.jsonl`: valid lines from several producers (Polaris error log and self-check, Orion, Mira, Aurora, manual cloze and reverse, Sirius).
- `fixtures/invalid.jsonl`: one violation per line (missing key, wrong producer prefix, unknown field, over-long front, bad origin kind, malformed JSON, and more); the validator reports each by line number.
