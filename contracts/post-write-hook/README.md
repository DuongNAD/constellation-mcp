# Contract: `post-write-hook`

## Purpose
The `post-write-hook` process contract defines the asynchronous notification protocol between learning tools (**Polaris**, **Aurora Slides**, **Constellation**) and **SmartDrive-OS**.

Whenever an agent makes modifications to learning materials or ecosystem configurations, it fires a quiet background update command so SmartDrive can incrementally index changes without blocking the learner's interactive workflow.

---

## Hook Command

```bash
smart-drive update <directory> --quiet
```

- When overridden via environment variables, tools use the configured executable path (e.g. `POLARIS_SMARTDRIVE_CMD` or `CONSTELLATION_SMARTDRIVE_CMD`).

---

## Debouncing & Coalescing Rules

1. **2-Second Window**:
   - Multiple sequential writes to the same workspace or subject within a 2-second interval must be coalesced into a single trailing hook execution.
2. **Non-Blocking**:
   - Hook executions must run asynchronously in the background (`child_process.exec` or unref'd subprocess) without blocking MCP tool responses.
3. **Graceful Degradation**:
   - If SmartDrive CLI is not installed or returns an error, the caller must ignore the failure and continue operation without interrupting the user.

---

## How to Disable

To disable the post-write notification hook in specific environments (e.g. during offline unit tests or CI pipelines):

- Set `POLARIS_SMARTDRIVE=off`
- Set `SMARTDRIVE_HOOK=off`
- Set `CONSTELLATION_SMARTDRIVE=off`
