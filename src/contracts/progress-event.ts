/**
 * aurora-progress-event.v1 contract specification and validator.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { ContractValidationError, ContractValidationResult } from "../types.js";
import { errMsg } from "../util.js";

export const ProgressEventV1Schema = z.object({
  v: z.literal(1).describe("Contract schema version (1)"),
  t: z.string().min(1).describe("ISO 8601 timestamp"),
  course: z.string().nullable().optional(),
  lesson: z.string().nullable().optional(),
  deck: z.string().min(1).describe("Slide deck name / slug"),
  slide: z.number().int().min(0).describe("Slide index (0-based)"),
  slideId: z.string().nullable().optional(),
  type: z.enum(["quiz", "predict", "recall", "complete", "card"]).describe("Event category"),

  // Quiz fields
  question: z.string().max(200).optional(),
  chosen: z.array(z.number().int()).optional(),
  chosenText: z.array(z.string().max(160)).optional(),
  answer: z.array(z.number().int()).optional(),
  answerText: z.array(z.string().max(160)).optional(),
  explanation: z.string().max(300).optional(),
  correct: z.boolean().optional(),

  // Predict fields
  title: z.string().optional(),
  prediction: z.string().max(2000).optional(),
  rating: z.enum(["right", "different", "got", "missed", "again", "hard", "good", "easy"]).optional(),
  output: z.string().max(300).optional(),

  // Recall fields
  palace: z.string().optional(),
  station: z.number().int().optional(),
  place: z.string().optional(),
  item: z.string().optional(),

  // Complete fields
  slides: z.number().int().optional(),
  quiz: z.string().nullable().optional(),
  predictions: z.string().nullable().optional(),

  // Card fields (SRS / Vega)
  card: z.string().optional(),
  ms: z.number().int().min(0).optional(),
});

export type ProgressEventV1 = z.infer<typeof ProgressEventV1Schema>;

export function validateProgressFile(filePath: string): ContractValidationResult {
  if (!existsSync(filePath)) {
    return {
      ok: false,
      contract: "aurora-progress-event.v1",
      file: filePath,
      totalLines: 0,
      validLines: 0,
      errors: [{ message: `File not found: ${filePath}` }],
    };
  }

  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const errors: ContractValidationError[] = [];
  let validCount = 0;
  let nonEmptyLines = 0;

  // Check if file is single JSON object or array
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        arr.forEach((item, idx) => {
          const res = ProgressEventV1Schema.safeParse(item);
          if (res.success) {
            validCount++;
          } else {
            res.error.issues.forEach((iss) => {
              errors.push({
                line: idx + 1,
                path: iss.path.join("."),
                message: `${iss.path.join(".") || "root"}: ${iss.message}`,
              });
            });
          }
        });
        return {
          ok: errors.length === 0,
          contract: "aurora-progress-event.v1",
          file: filePath,
          totalLines: arr.length,
          validLines: validCount,
          errors,
        };
      }
    } catch (e) {
      return {
        ok: false,
        contract: "aurora-progress-event.v1",
        file: filePath,
        totalLines: 1,
        validLines: 0,
        errors: [{ line: 1, message: `Invalid JSON syntax: ${errMsg(e)}` }],
      };
    }
  }

  // JSONL line-by-line parsing
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    nonEmptyLines++;
    const lineNum = i + 1;

    try {
      const parsed = JSON.parse(line);
      const res = ProgressEventV1Schema.safeParse(parsed);
      if (res.success) {
        validCount++;
      } else {
        res.error.issues.forEach((iss) => {
          errors.push({
            line: lineNum,
            path: iss.path.join("."),
            message: `${iss.path.join(".") || "root"}: ${iss.message}`,
          });
        });
      }
    } catch (e) {
      errors.push({
        line: lineNum,
        message: `Malformed JSON line: ${errMsg(e)}`,
      });
    }
  }

  return {
    ok: errors.length === 0 && nonEmptyLines > 0,
    contract: "aurora-progress-event.v1",
    file: filePath,
    totalLines: nonEmptyLines,
    validLines: validCount,
    errors,
  };
}
