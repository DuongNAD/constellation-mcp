/**
 * personal-data contract specification and .gitignore validator.
 */
import { existsSync, readFileSync } from "node:fs";
import { ContractValidationError, ContractValidationResult } from "../types.js";

export interface PersonalDataPattern {
  pattern: string;
  category: "personal" | "third-party" | "regenerable";
  owner: string;
  ownerProject: string;
  description: string;
  remediation: string;
}

export const PERSONAL_DATA_PATTERNS: PersonalDataPattern[] = [
  {
    pattern: ".vega/",
    category: "personal",
    owner: "vega",
    ownerProject: "Vega (vega-mcp)",
    description: "Vega memory collection and review log (flashcards, FSRS intervals, private study ratings).",
    remediation: "Untrack with 'git rm -r --cached .vega/' then commit; consider history rewriting if pushed publicly.",
  },
  {
    pattern: "**/progress.jsonl",
    category: "personal",
    owner: "aurora-slides",
    ownerProject: "Aurora Slides (aurora-slides-mcp) / Vega / Polaris",
    description: "Aurora learning events: answers, predictions, missed stations, timing logs.",
    remediation: "Untrack with 'git rm --cached **/progress.jsonl' then commit; check history if published.",
  },
  {
    pattern: "aurora-progress-*.jsonl",
    category: "personal",
    owner: "aurora-slides",
    ownerProject: "Aurora Slides (aurora-slides-mcp)",
    description: "Exported or dated Aurora learning progress event logs containing answers and scores.",
    remediation: "Untrack with 'git rm --cached aurora-progress-*.jsonl' then commit; check history if published.",
  },
  {
    pattern: "orion-attempts.jsonl",
    category: "personal",
    owner: "orion",
    ownerProject: "Orion (orion-mcp)",
    description: "Orion attempt history with predictions, self-evaluation records, and learning attempts.",
    remediation: "Untrack with 'git rm --cached orion-attempts.jsonl' then commit; check history if published.",
  },
  {
    pattern: "**/polaris/captures/",
    category: "third-party",
    owner: "polaris",
    ownerProject: "Polaris (polaris-mcp)",
    description: "Captured full-text web pages, PDFs, and video transcripts (copyrighted study copies).",
    remediation: "Untrack with 'git rm -r --cached **/polaris/captures/' then commit; rewrite git history if copyrighted.",
  },
  {
    pattern: "**/polaris/.cache/",
    category: "regenerable",
    owner: "polaris",
    ownerProject: "Polaris (polaris-mcp)",
    description: "Cached search and API responses (OpenAlex, arXiv, CrossRef) which can be regenerated.",
    remediation: "Untrack with 'git rm -r --cached **/polaris/.cache/' then commit.",
  },
  {
    pattern: ".polaris/",
    category: "personal",
    owner: "polaris",
    ownerProject: "Polaris (polaris-mcp)",
    description: "Learner profile with study time slots, blackout dates, commitments and study-method preferences.",
    remediation: "Untrack with 'git rm -r --cached .polaris/' then commit; check history if published.",
  },
];

function globMatches(glob: string, text: string): boolean {
  if (glob === text) return true;
  const regexPattern = "^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
  try {
    return new RegExp(regexPattern).test(text);
  } catch {
    return false;
  }
}

/**
 * Checks whether an active .gitignore rule covers a given canonical pattern.
 */
export function isPatternCoveredByRule(targetPattern: string, rule: string): boolean {
  const normRule = rule.trim().replace(/\\/g, "/");
  if (!normRule || normRule.startsWith("#") || normRule.startsWith("!")) {
    return false;
  }

  // Universal wildcard
  if (normRule === "*" || normRule === "**" || normRule === "**/*") {
    return true;
  }

  const stripPrefix = (s: string) => s.replace(/^(\*\*\/|\/)/, "");
  const stripSlash = (s: string) => s.replace(/\/+$/, "");

  const cleanRule = stripPrefix(stripSlash(normRule));
  const cleanTarget = stripPrefix(stripSlash(targetPattern));

  // 1. Exact equality after stripping slashes and **/
  if (cleanRule === cleanTarget) {
    return true;
  }

  // 2. Direct folder or component matches
  switch (targetPattern) {
    case ".vega/":
      if (cleanRule === ".vega") return true;
      break;

    case ".polaris/":
      if (cleanRule === ".polaris") return true;
      break;

    case "**/progress.jsonl":
      if (cleanRule === "progress.jsonl") return true;
      break;

    case "aurora-progress-*.jsonl":
      if (cleanRule === "aurora-progress-*.jsonl") return true;
      break;

    case "orion-attempts.jsonl":
      if (cleanRule === "orion-attempts.jsonl") return true;
      break;

    case "**/polaris/captures/":
      if (
        cleanRule === "polaris/captures" ||
        cleanRule === "captures" ||
        cleanTarget.endsWith("/" + cleanRule)
      ) {
        return true;
      }
      break;

    case "**/polaris/.cache/":
      if (
        cleanRule === "polaris/.cache" ||
        cleanRule === ".cache" ||
        cleanTarget.endsWith("/" + cleanRule)
      ) {
        return true;
      }
      break;
  }

  // 3. Broader parent directory match (e.g. polaris/ or polaris/* covering polaris/captures)
  const dirRule = cleanRule.replace(/\/\*+$/, "");
  if (dirRule.length > 0 && (cleanTarget === dirRule || cleanTarget.startsWith(dirRule + "/"))) {
    return true;
  }

  // 4. Wildcard matching (e.g. *.jsonl, aurora-*, orion-*)
  if (cleanRule.includes("*")) {
    // Check against cleanTarget as well as filename component
    if (globMatches(cleanRule, cleanTarget)) {
      return true;
    }
    const targetFilename = cleanTarget.split("/").pop() ?? cleanTarget;
    if (globMatches(cleanRule, targetFilename)) {
      return true;
    }
  }

  return false;
}

/**
 * Returns true if any of the provided .gitignore rules covers the target pattern.
 */
export function isPatternCovered(targetPattern: string, gitignoreRules: string[]): boolean {
  for (const rule of gitignoreRules) {
    if (isPatternCoveredByRule(targetPattern, rule)) {
      return true;
    }
  }
  return false;
}

/**
 * Validates a .gitignore file against the personal-data canonical ignore patterns.
 */
export function validatePersonalDataGitignore(filePath: string): ContractValidationResult {
  if (!existsSync(filePath)) {
    return {
      ok: false,
      contract: "personal-data",
      file: filePath,
      totalLines: PERSONAL_DATA_PATTERNS.length,
      validLines: 0,
      errors: [{ message: `File not found: ${filePath}` }],
    };
  }

  const raw = readFileSync(filePath, "utf8");
  const rules = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  const missing: PersonalDataPattern[] = [];
  let coveredCount = 0;

  for (const p of PERSONAL_DATA_PATTERNS) {
    if (isPatternCovered(p.pattern, rules)) {
      coveredCount++;
    } else {
      missing.push(p);
    }
  }

  const errors: ContractValidationError[] = missing.map((p) => ({
    path: p.pattern,
    message: `Missing pattern '${p.pattern}' (${p.ownerProject}: ${p.description})`,
  }));

  return {
    ok: missing.length === 0,
    contract: "personal-data",
    file: filePath,
    totalLines: PERSONAL_DATA_PATTERNS.length,
    validLines: coveredCount,
    errors,
  };
}
