/**
 * Shared helpers for the JSON Lines contract validators (vega-card-inbox.v1, mira-embed.v1).
 *
 * A validator reads a UTF-8 file with one JSON object per line, checks every object, and reports line-numbered
 * errors in the same shape as the aurora-progress-event.v1 validator.
 */
import { existsSync, readFileSync } from "node:fs";
import { TextDecoder } from "node:util";
import { z } from "zod";
import type { ContractValidationError, ContractValidationResult } from "../types.js";
import { errMsg } from "../util.js";

/** One problem found in a single JSON Lines record. */
export interface LineProblem {
  /** Dotted path of the offending field; empty for the record itself. */
  path?: string;
  /** Human readable text that starts with the path ("key: ...") or "root: ..." for the record itself. */
  message: string;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Length in Unicode code points: the unit JSON Schema (maxLength) and Python's len() use, not UTF-16 units. */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/**
 * A string whose length in code points lies in [min, max]. With `trim`, leading and trailing whitespace is
 * ignored first, so a whitespace-only value counts as empty.
 */
export function boundedText(min: number, max: number, trim = false) {
  return z.string().superRefine((value, ctx) => {
    const n = codePointLength(trim ? value.trim() : value);
    if (n < min) {
      ctx.addIssue({
        code: "custom",
        message: min <= 1 ? "must not be empty" : `must be at least ${min} characters (got ${n})`,
      });
    } else if (n > max) {
      ctx.addIssue({ code: "custom", message: `must be at most ${max} characters (got ${n})` });
    }
  });
}

const ISO_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** ISO 8601 date-time with seconds and an explicit time zone (Z or +hh:mm), checked against the real calendar. */
export function isIsoDateTimeWithOffset(value: string): boolean {
  const m = ISO_DATE_TIME_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (m[7] !== "Z" && (Number(m[8]) > 23 || Number(m[9]) > 59)) return false;
  return true;
}

/** A trimmed string (1-64 characters) that is a real ISO 8601 date-time with Z or an offset. */
export function isoDateTimeText() {
  return z.string().superRefine((value, ctx) => {
    const trimmed = value.trim();
    if (codePointLength(trimmed) > 64 || !isIsoDateTimeWithOffset(trimmed)) {
      ctx.addIssue({
        code: "custom",
        message: "must be an ISO 8601 date-time with an offset or Z (e.g. 2026-10-12T21:04:10+07:00)",
      });
    }
  });
}

interface ZodIssueLike {
  code: string;
  path: PropertyKey[];
  message: string;
  keys?: string[];
}

function valueAt(root: unknown, path: PropertyKey[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

/**
 * Turns zod issues into line problems. `root` is the object the schema was run on (to tell a missing field from a
 * wrongly typed one); `prefix` is prepended to every reported path (for a schema run on a nested object).
 */
export function problemsFromZod(
  issues: readonly ZodIssueLike[],
  root: unknown,
  prefix: PropertyKey[] = [],
): LineProblem[] {
  const problems: LineProblem[] = [];
  for (const issue of issues) {
    const fullPath = [...prefix, ...issue.path];
    if (issue.code === "unrecognized_keys" && issue.keys) {
      for (const key of issue.keys) {
        const path = [...fullPath, key].map(String).join(".");
        problems.push({ path, message: `${path}: unknown field (unknown fields are rejected)` });
      }
      continue;
    }
    const path = fullPath.map(String).join(".");
    if (issue.code === "invalid_type" && valueAt(root, issue.path) === undefined) {
      problems.push({ path, message: `${path || "root"}: required field is missing` });
      continue;
    }
    problems.push({ path, message: `${path || "root"}: ${issue.message}` });
  }
  return problems;
}

/**
 * Validates a JSON Lines file: every non-blank line must be one JSON value accepted by `checkRecord`
 * (which returns the problems of that record, empty when it is valid). Errors carry 1-based file line numbers.
 * The file must be valid UTF-8; a leading BOM is dropped.
 */
export function validateJsonLinesFile(
  contract: string,
  filePath: string,
  checkRecord: (record: unknown) => LineProblem[],
): ContractValidationResult {
  const failure = (errors: ContractValidationError[], totalLines = 0): ContractValidationResult => ({
    ok: false,
    contract,
    file: filePath,
    totalLines,
    validLines: 0,
    errors,
  });

  if (!existsSync(filePath)) {
    return failure([{ message: `File not found: ${filePath}` }]);
  }

  let raw: string;
  try {
    // fatal: a mis-encoded file must be reported, never silently turned into U+FFFD characters.
    raw = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(filePath));
  } catch (e) {
    return failure([{ message: `File is not valid UTF-8 or cannot be read: ${errMsg(e)}` }]);
  }

  // A whole-file JSON array is a common mistake: say so once instead of failing every line.
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const whole: unknown = JSON.parse(trimmed);
      if (Array.isArray(whole)) {
        return failure(
          [
            {
              line: 1,
              message: `File is a JSON array; ${contract} files are JSON Lines (one JSON object per line, no enclosing array)`,
            },
          ],
          whole.length,
        );
      }
    } catch {
      // Not a single JSON document: fall through to the line-by-line check.
    }
  }

  const errors: ContractValidationError[] = [];
  let nonEmptyLines = 0;
  let badLines = 0;
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    nonEmptyLines++;
    const lineNum = i + 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      errors.push({ line: lineNum, message: `Malformed JSON line: ${errMsg(e)}` });
      badLines++;
      continue;
    }

    const problems = checkRecord(parsed);
    for (const problem of problems) {
      errors.push({
        line: lineNum,
        ...(problem.path ? { path: problem.path } : {}),
        message: problem.message,
      });
    }
    if (problems.length > 0) badLines++;
  }

  if (nonEmptyLines === 0) {
    errors.push({ message: "File contains no JSON Lines records" });
  }

  return {
    ok: errors.length === 0,
    contract,
    file: filePath,
    totalLines: nonEmptyLines,
    validLines: nonEmptyLines - badLines,
    errors,
  };
}
