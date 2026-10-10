/**
 * Helper to generate JSON Schema from Zod schema for aurora-progress-event.v1.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import { ProgressEventV1Schema } from "./progress-event.js";

export function generateProgressEventJsonSchema(): object {
  return zodToJsonSchema(ProgressEventV1Schema as any, {
    name: "aurora-progress-event.v1",
    target: "jsonSchema7",
    definitions: {},
  });
}
