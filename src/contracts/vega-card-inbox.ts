/**
 * vega-card-inbox.v1 contract specification and validator.
 *
 * Producers (Polaris, Orion, Mira, Aurora, Sirius, Rigel, manual) drop card candidates as JSON Lines files into
 * <hub>/.vega/inbox/; Vega alone validates, de-duplicates by key and schedules them with FSRS. The rules below are
 * the line schema of contracts/vega-card-inbox.v1/README.md, applied the way the reference consumer (Vega) applies
 * them: values are trimmed first and lengths count Unicode code points.
 *
 * Amendment 2026-10-13 (backward compatible, still v1): producer "rigel" (Rigel, grounded Q&A over the learner's
 * lesson materials) and origin kind "rigel-ref" (a citable chunk of a lesson file). Nothing else changed.
 */
import { z } from "zod";
import type { ContractValidationResult } from "../types.js";
import {
  boundedText,
  isoDateTimeText,
  isPlainObject,
  type LineProblem,
  problemsFromZod,
  validateJsonLinesFile,
} from "./jsonl.js";

export const VEGA_INBOX_PRODUCERS = ["polaris", "orion", "mira", "aurora", "sirius", "rigel", "manual"] as const;
export const VEGA_INBOX_CARD_KINDS = ["basic", "cloze", "reverse"] as const;
export const VEGA_INBOX_ORIGIN_KINDS = [
  "polaris-fact",
  "polaris-errorlog",
  "polaris-selfcheck",
  "aurora-quiz",
  "aurora-predict",
  "orion-attempt",
  "mira-stop",
  "rigel-ref",
  "manual",
] as const;

export type VegaInboxProducer = (typeof VEGA_INBOX_PRODUCERS)[number];
export type VegaInboxCardKind = (typeof VEGA_INBOX_CARD_KINDS)[number];
export type VegaInboxOriginKind = (typeof VEGA_INBOX_ORIGIN_KINDS)[number];

const oneOf = (values: readonly string[]) => ({ error: `must be one of: ${values.join(", ")}` });

export const VegaCardInboxOriginSchema = z.strictObject({
  kind: z.enum(VEGA_INBOX_ORIGIN_KINDS, oneOf(VEGA_INBOX_ORIGIN_KINDS)),
  path: boundedText(1, 400, true).describe("File or folder the card comes from (rigel-ref: absolute path of the source file)"),
  locator: boundedText(0, 120, true).optional().describe("Place inside the origin, e.g. 'stop 3' or 'D3#12 · slide 7'"),
  href: boundedText(0, 400, true).optional().describe("Link that opens the origin, e.g. a Mira player with #stop-3"),
});

export const VegaCardInboxLineSchema = z.strictObject({
  v: z.literal(1, { error: "must be 1" }).describe("Contract schema version (1)"),
  t: isoDateTimeText().describe("ISO 8601 date-time with offset or Z"),
  producer: z.enum(VEGA_INBOX_PRODUCERS, oneOf(VEGA_INBOX_PRODUCERS)),
  key: boundedText(1, 200, true).describe("Stable dedupe key; must start with '<producer>:'"),
  subject: boundedText(1, 120, true).describe("Subject folder name or display name"),
  deck: boundedText(0, 120, true).optional().describe("Lesson, module, lab, or player title"),
  kind: z.enum(VEGA_INBOX_CARD_KINDS, oneOf(VEGA_INBOX_CARD_KINDS)).optional().describe("Defaults to basic"),
  front: boundedText(1, 600, true).describe("Learner-language prompt, one idea, no emoji"),
  back: boundedText(0, 1200, true).describe("Answer"),
  hint: boundedText(0, 200, true).optional(),
  hook: boundedText(0, 200, true).optional().describe("Memory hook"),
  origin: VegaCardInboxOriginSchema,
  tags: z
    .array(boundedText(1, 40, true))
    .max(10, {
      error: (issue) =>
        `must have at most 10 items (got ${Array.isArray(issue.input) ? issue.input.length : "more"})`,
    })
    .optional(),
  reason: boundedText(0, 200, true).optional().describe("Why the card was created"),
});

export type VegaCardInboxLine = z.infer<typeof VegaCardInboxLineSchema>;

// Same emoji test as the consumer: emoji-presentation characters and the emoji variation selector (U+FE0F).
const EMOJI_RE = new RegExp(`\\p{Emoji_Presentation}|${String.fromCodePoint(0xfe0f)}`, "u");
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

function codePointLabel(char: string): string {
  return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Checks one parsed inbox line: the field schema plus the rules that span fields (key prefix) or need more than a
 * type check (control characters in the key, emoji in front). Returns every problem found; empty means valid.
 */
export function checkVegaCardInboxLine(raw: unknown): LineProblem[] {
  if (!isPlainObject(raw)) {
    return [{ message: "root: record must be a JSON object" }];
  }

  const parsed = VegaCardInboxLineSchema.safeParse(raw);
  const problems = parsed.success ? [] : problemsFromZod(parsed.error.issues, raw);

  const key = typeof raw.key === "string" ? raw.key.trim() : "";
  if (key.length > 0) {
    if (CONTROL_RE.test(key)) {
      problems.push({ path: "key", message: "key: must not contain control characters (newline, tab, ...)" });
    } else if (
      typeof raw.producer === "string" &&
      (VEGA_INBOX_PRODUCERS as readonly string[]).includes(raw.producer)
    ) {
      const prefix = `${raw.producer}:`;
      if (!(key.startsWith(prefix) && key.length > prefix.length)) {
        problems.push({
          path: "key",
          message: `key: must start with '${prefix}' followed by an identifier (producer is '${raw.producer}')`,
        });
      }
    }
  }

  if (typeof raw.front === "string") {
    const emoji = EMOJI_RE.exec(raw.front.trim());
    if (emoji) {
      problems.push({
        path: "front",
        message: `front: must not contain emoji (found ${codePointLabel(emoji[0])})`,
      });
    }
  }

  return problems;
}

/** Validates a vega-card-inbox.v1 file: one card line per JSON Lines record, line-numbered errors. */
export function validateVegaCardInboxFile(filePath: string): ContractValidationResult {
  return validateJsonLinesFile("vega-card-inbox.v1", filePath, checkVegaCardInboxLine);
}
