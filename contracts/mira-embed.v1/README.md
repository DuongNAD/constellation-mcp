# Contract: `mira-embed.v1`

## Purpose
`mira-embed.v1` is the `postMessage` protocol between a **Mira** player and the **Aurora Slides** deck that embeds it in a `trace` slide.

A Mira player is one self-contained, offline HTML page (built with `mira_build`) that steps through a real Python trace line by line, with prediction gates where the learner types what will happen. Aurora shows that page in an `<iframe>` inside a lesson deck. The protocol lets the player tell the deck that it is ready, lets the deck pass its theme to the player, hands the keyboard back to the deck, and lets Aurora relay the learner's prediction results into its own progress pipeline (`aurora-progress-event.v1`), so Polaris (error log) and Vega (cards) receive them with no other change.

The protocol is fixed: Mira implements the player side, Aurora the parent side.

---

## Embedding

- The player detects embedding when `window.parent !== window` or its URL has `?embed=1`, and switches to a compact layout that fills the iframe.
- Player files carry `<meta name="mira-player" content="1">` and `<meta name="generator" content="mira-mcp ...">`. Aurora embeds a player file only when it contains the `mira-player` meta tag.
- Messages are plain JSON-compatible objects sent with `window.parent.postMessage(msg, "*")` (player to parent) and `iframe.contentWindow.postMessage(msg, ...)` (parent to player).

---

## Messages

Every message has the envelope `source`, `v` and `kind`. `v` is the protocol version and is always `1`.

| Direction | `source` | `kind` | Extra fields | When |
|---|---|---|---|---|
| player to parent | `"mira"` | `ready` | `title`, `steps`, `stops` | Once, when the player has loaded. |
| player to parent | `"mira"` | `event` | `event` | For each progress event (a prediction result, or the end of the trace). |
| player to parent | `"mira"` | `blur` | none | When the learner presses Escape inside the player. |
| parent to player | `"aurora"` | `hello` | `theme`, `accent?` | After `ready`, posted to that iframe's `contentWindow`. |

Envelopes are closed: a message must not carry fields that are not listed here (a v1 parent ignores them, the validator rejects them).

### 1. `ready` (player to parent)

```json
{"source":"mira","v":1,"kind":"ready","title":"Dò vòng lặp đếm số chẵn","steps":42,"stops":3}
```

| Field | Type | Rule |
|---|---|---|
| `title` | string | Player title, at most 200 chars. |
| `steps` | integer | Number of recorded trace steps, 0 or more. |
| `stops` | integer | Number of prediction stops, 0 or more. |

The parent needs `ready` only as the cue to send `hello`; the three fields describe the player.

### 2. `event` (player to parent)

```json
{"source":"mira","v":1,"kind":"event","event":{"v":1,"t":"2026-10-12T21:30:05+07:00","course":"python-master","lesson":"02-vong-lap","deck":"Dò vòng lặp đếm số chẵn","slide":14,"slideId":"mira-stop-1","type":"predict","title":"Sau lần lặp thứ hai, dem bằng bao nhiêu?","prediction":"1","rating":"right","output":"1"}}
```

`event` is an [`aurora-progress-event.v1`](../aurora-progress-event.v1/README.md) object (`v`, `t`, `deck`, `slide`, `type` are required there). A player sends only two event types:

| `event.type` | Parent behaviour | Notes |
|---|---|---|
| `predict` | **Relayed** into Aurora's progress pipeline | One per prediction stop. |
| `complete` | **Ignored** | Aurora emits its own deck completion. |

Other `aurora-progress-event.v1` types (`quiz`, `recall`, `card`) are not part of this protocol and must not be sent.

A `predict` event carries these fields, all required, with the limits the parent applies:

| Field | Type | Rule |
|---|---|---|
| `title` | string | The question asked at the stop, at most 200 chars. |
| `prediction` | string | What the learner typed, at most 2000 chars (may be empty). |
| `rating` | string | `"right"` or `"different"`. |
| `output` | string | The actual value as text, at most 300 chars. |
| `slideId` | string | `mira-stop-<k>` (matches `^mira-stop-\d+$`), where `<k>` is the stop number. |

The parent truncates longer strings instead of rejecting them, and drops a message whose rating or `slideId` is invalid; a sender must still stay within the limits.

### 3. `blur` (player to parent)

```json
{"source":"mira","v":1,"kind":"blur"}
```

Sent when the learner presses Escape inside the player. The deck takes the keyboard focus back, so the arrow keys navigate slides again.

### 4. `hello` (parent to player)

```json
{"source":"aurora","v":1,"kind":"hello","theme":"dark","accent":"#E8A23B"}
```

| Field | Type | Rule |
|---|---|---|
| `theme` | string | `"dark"` or `"light"`: the theme of the current slide or deck. |
| `accent` | string | Optional `#RRGGBB` (six hex digits). Omitted when the deck accent is not a hex colour. |

`hello` carries no learner data, only presentation settings.

---

## What the Parent Does (Aurora)

1. One `message` listener accepts only messages whose `event.source` is the `contentWindow` of an `<iframe>` inside a `trace` slide of the same document, **and** whose `data.source` is `"mira"`, **and** whose `data.v` is `1`. Everything else is ignored.
2. `ready`: post `hello` to that iframe.
3. `event` with `event.type === "predict"`: validate (strings, lengths truncated to the limits above, rating in the allowed set, `slideId` matching `^mira-stop-\d+$`) and re-emit it as a `predict` progress event of the trace slide. The re-emitted `slideId` is the slide's id (or `trace-<n>` when the slide has none) followed by `:` and the player's `slideId`, for example `s_trace_1:mira-stop-2`. Aurora's progress summary recognises Mira predictions by the `:mira-stop-` part. Anything invalid is dropped silently.
4. `blur`: move the focus back to the deck.
5. When Aurora's `STATIC` flag is set, nothing is relayed (the same rule as for every other Aurora event).

---

## Security Notes

- **Trust only your own frames.** The parent accepts a message only when its `source` window is the `contentWindow` of one of its own `trace` iframes. A message from any other window (another iframe, a popup, a script in another tab) is ignored.
- **Fixed envelope.** The parent requires `data.source === "mira"` and `data.v === 1`; a player ignores anything that is not a well-formed `hello` from `"aurora"` with `v === 1`.
- **Offline pages have an opaque origin.** Players are offline pages and often run from `file://`, where `event.origin` is the opaque string `"null"` and cannot identify them; the player therefore posts with target origin `"*"`. For that reason a message must never contain a secret, and `hello` carries only theme and accent. Frame identity is the check, not the origin.
- **Validate, then relay.** The parent re-validates every field and re-creates the progress event itself; it never forwards the player's object as is.
- **Treat strings as text.** Never insert message strings into the page as HTML and never evaluate them.
- **`blur` only moves focus.** It cannot trigger navigation or any other action.

---

## Versioning

`v: 1` is the only version. An incompatible change gets a new `v` and a new contract name (`mira-embed.v2`); a v1 parent and a v1 player ignore messages with another `v`.

---

## Validation

```bash
constellation contracts validate mira-embed.v1 <path-to-messages.jsonl>
```

The same check is available as `eco_contracts { action: "validate", name: "mira-embed.v1", file }`. The file holds one message object per line, in either direction (for example a captured transcript of a player and its deck). The validator checks the shape of each message the way a conforming sender must produce it, reports every problem per line (`Line 6: event.rating: must be 'right' or 'different'`) and prints an OK summary such as `OK: Contract 'mira-embed.v1' valid (8/8 lines)`.

## Files in This Folder

- `schema.json`: JSON Schema (draft-07) for one message; `oneOf` the four message kinds, with the event narrowed as described above.
- `fixtures/valid.jsonl`: valid messages: `ready`, `hello` (with and without `accent`), `predict` events (right and different), a `complete` event and `blur`.
- `fixtures/invalid.jsonl`: one violation per line (wrong source, wrong version, unknown kind, hello with the player source, missing fields, bad rating, bad `slideId`, over-long title, event type outside the protocol, bad accent, unknown field, malformed JSON, and more).
