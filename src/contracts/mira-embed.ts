/**
 * mira-embed.v1 contract specification and validator.
 *
 * postMessage protocol between a Mira player (offline HTML page in an iframe) and the Aurora Slides deck that
 * embeds it in a `trace` slide:
 *
 *   player -> parent  {source:"mira", v:1, kind:"ready", title, steps, stops}
 *                     {source:"mira", v:1, kind:"event", event:<aurora-progress-event.v1 object>}
 *                     {source:"mira", v:1, kind:"blur"}
 *   parent -> player  {source:"aurora", v:1, kind:"hello", theme:"dark"|"light", accent?:"#RRGGBB"}
 *
 * The validator reads a JSON Lines file with one message per line (for example a captured transcript, or the
 * fixtures of this contract) and checks the shape of every message the way a conforming sender must produce it.
 */
import { z } from "zod";
import type { ContractValidationResult } from "../types.js";
import {
  boundedText,
  isPlainObject,
  type LineProblem,
  problemsFromZod,
  validateJsonLinesFile,
} from "./jsonl.js";
import { ProgressEventV1Schema } from "./progress-event.js";

export const MIRA_EMBED_PLAYER_SOURCE = "mira";
export const MIRA_EMBED_PARENT_SOURCE = "aurora";
export const MIRA_EMBED_PLAYER_KINDS = ["ready", "event", "blur"] as const;
export const MIRA_EMBED_PARENT_KINDS = ["hello"] as const;
/** Event types a player may send: predict is relayed by the parent, complete is ignored by it. */
export const MIRA_EMBED_EVENT_TYPES = ["predict", "complete"] as const;
export const MIRA_EMBED_RATINGS = ["right", "different"] as const;
export const MIRA_EMBED_THEMES = ["dark", "light"] as const;
/** Limits of the relayed predict event (the parent truncates longer strings; a sender must stay within them). */
export const MIRA_EMBED_LIMITS = { title: 200, prediction: 2000, output: 300, readyTitle: 200 } as const;
export const MIRA_EMBED_STOP_ID_RE = /^mira-stop-\d+$/;
export const MIRA_EMBED_ACCENT_RE = /^#[0-9A-Fa-f]{6}$/;

const playerSource = z.literal(MIRA_EMBED_PLAYER_SOURCE, {
  error: "must be 'mira' (messages sent by the player)",
});
const parentSource = z.literal(MIRA_EMBED_PARENT_SOURCE, {
  error: "must be 'aurora' (messages sent by the parent deck)",
});
const version = z.literal(1, { error: "must be 1" });
const count = z.number({ error: "must be a non-negative integer" }).int({ error: "must be a non-negative integer" }).min(0, {
  error: "must be a non-negative integer",
});

export const MiraReadyMessageSchema = z.strictObject({
  source: playerSource,
  v: version,
  kind: z.literal("ready"),
  title: boundedText(0, MIRA_EMBED_LIMITS.readyTitle).describe("Player title"),
  steps: count.describe("Number of recorded trace steps"),
  stops: count.describe("Number of prediction stops"),
});

export const MiraEventMessageSchema = z.strictObject({
  source: playerSource,
  v: version,
  kind: z.literal("event"),
  event: z.looseObject({}).describe("An aurora-progress-event.v1 object (checked by checkMiraEmbedEvent)"),
});

export const MiraBlurMessageSchema = z.strictObject({
  source: playerSource,
  v: version,
  kind: z.literal("blur"),
});

export const AuroraHelloMessageSchema = z.strictObject({
  source: parentSource,
  v: version,
  kind: z.literal("hello"),
  theme: z.enum(MIRA_EMBED_THEMES, { error: "must be 'dark' or 'light'" }),
  accent: z
    .string()
    .regex(MIRA_EMBED_ACCENT_RE, { error: "must be #RRGGBB (six hex digits)" })
    .optional()
    .describe("Omitted when the deck accent is not a hex colour"),
});

/** A predict event as the parent relays it: aurora-progress-event.v1 narrowed to what Mira players send. */
export const MiraPredictEventSchema = ProgressEventV1Schema.extend({
  type: z.literal("predict"),
  title: boundedText(0, MIRA_EMBED_LIMITS.title),
  prediction: boundedText(0, MIRA_EMBED_LIMITS.prediction),
  rating: z.enum(MIRA_EMBED_RATINGS, { error: "must be 'right' or 'different'" }),
  output: boundedText(0, MIRA_EMBED_LIMITS.output),
  slideId: z.string().regex(MIRA_EMBED_STOP_ID_RE, { error: "must match mira-stop-<k>, for example mira-stop-1" }),
});

/** A complete event is a plain aurora-progress-event.v1 object; the parent ignores it. */
export const MiraCompleteEventSchema = ProgressEventV1Schema.extend({
  type: z.literal("complete"),
});

export type MiraReadyMessage = z.infer<typeof MiraReadyMessageSchema>;
export type MiraEventMessage = z.infer<typeof MiraEventMessageSchema>;
export type MiraBlurMessage = z.infer<typeof MiraBlurMessageSchema>;
export type AuroraHelloMessage = z.infer<typeof AuroraHelloMessageSchema>;
export type MiraPredictEvent = z.infer<typeof MiraPredictEventSchema>;

const MESSAGE_SCHEMAS: Record<string, z.ZodType> = {
  ready: MiraReadyMessageSchema,
  event: MiraEventMessageSchema,
  blur: MiraBlurMessageSchema,
  hello: AuroraHelloMessageSchema,
};

/** Checks the `event` object carried by a `kind: "event"` message (paths are reported as event.<field>). */
export function checkMiraEmbedEvent(event: Record<string, unknown>): LineProblem[] {
  const type = event.type;
  if (type === undefined) {
    return [{ path: "event.type", message: "event.type: required field is missing" }];
  }
  if (type !== "predict" && type !== "complete") {
    return [
      {
        path: "event.type",
        message:
          "event.type: must be 'predict' or 'complete' (other aurora-progress-event.v1 types are not part of mira-embed.v1)",
      },
    ];
  }
  const schema = type === "predict" ? MiraPredictEventSchema : MiraCompleteEventSchema;
  const parsed = schema.safeParse(event);
  return parsed.success ? [] : problemsFromZod(parsed.error.issues, event, ["event"]);
}

/** Checks one parsed message, in either direction. Returns every problem found; empty means valid. */
export function checkMiraEmbedMessage(raw: unknown): LineProblem[] {
  if (!isPlainObject(raw)) {
    return [{ message: "root: message must be a JSON object" }];
  }

  const kind = raw.kind;
  if (typeof kind !== "string" || !Object.hasOwn(MESSAGE_SCHEMAS, kind)) {
    // Without a known kind the field set is unknown, so only the envelope can be checked.
    const problems: LineProblem[] = [
      kind === undefined
        ? { path: "kind", message: "kind: required field is missing" }
        : {
            path: "kind",
            message:
              "kind: must be one of ready, event, blur (sent by the player, source 'mira') or hello (sent by the parent, source 'aurora')",
          },
    ];
    if (raw.source === undefined) {
      problems.push({ path: "source", message: "source: required field is missing" });
    } else if (raw.source !== MIRA_EMBED_PLAYER_SOURCE && raw.source !== MIRA_EMBED_PARENT_SOURCE) {
      problems.push({ path: "source", message: "source: must be 'mira' or 'aurora'" });
    }
    if (raw.v === undefined) {
      problems.push({ path: "v", message: "v: required field is missing" });
    } else if (raw.v !== 1) {
      problems.push({ path: "v", message: "v: must be 1" });
    }
    return problems;
  }

  const parsed = MESSAGE_SCHEMAS[kind]!.safeParse(raw);
  const problems = parsed.success ? [] : problemsFromZod(parsed.error.issues, raw);
  if (kind === "event" && isPlainObject(raw.event)) {
    problems.push(...checkMiraEmbedEvent(raw.event));
  }
  return problems;
}

/** Validates a mira-embed.v1 file: one postMessage payload per JSON Lines record, line-numbered errors. */
export function validateMiraEmbedFile(filePath: string): ContractValidationResult {
  return validateJsonLinesFile("mira-embed.v1", filePath, checkMiraEmbedMessage);
}
