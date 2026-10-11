/**
 * Shared Contracts Registry for the Learner MCP Ecosystem.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ContractInfo, ContractValidationResult } from "../types.js";
import { validateProgressFile } from "./progress-event.js";
import { validatePersonalDataGitignore } from "./personal-data.js";

export * from "./progress-event.js";
export * from "./personal-data.js";
export * from "./generate-schema.js";

function findContractRoot(): string {
  const base = resolve(
    typeof __dirname !== "undefined"
      ? __dirname
      : dirname(fileURLToPath(import.meta.url)),
  );
  const candidates = [
    resolve(base, "..", "contracts"),
    resolve(base, "..", "..", "contracts"),
    resolve(process.cwd(), "contracts"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return candidates[0]!;
}

const CONTRACT_ROOT = findContractRoot();

export const CONTRACTS: Record<string, ContractInfo> = {
  "aurora-progress-event.v1": {
    name: "aurora-progress-event.v1",
    title: "Aurora Learning Progress Event Contract v1",
    description:
      "Structured learning events emitted by Aurora Slides (quiz, predict, recall, complete, card) and ingested by Polaris (Error Log & spaced review) and Vega (FSRS memory engine).",
    type: "data",
    schemaPath: join(CONTRACT_ROOT, "aurora-progress-event.v1", "schema.json"),
    hasValidator: true,
  },
  "learning-units": {
    name: "learning-units",
    title: "Learning Units & Workspace Folder Markers",
    description:
      "Folder markers (course.json, deck.json, polaris/brief.json) and SmartDrive SSD protection and indexing rules.",
    type: "convention",
    hasValidator: false,
  },
  "post-write-hook": {
    name: "post-write-hook",
    title: "SmartDrive Post-Write Hook",
    description:
      "Asynchronous debounced notification 'smart-drive update <dir> --quiet' triggered after course, roadmap, and ecosystem manifest changes.",
    type: "process",
    hasValidator: false,
  },
  "source-labels": {
    name: "source-labels",
    title: "Course and Extension Source Labels",
    description:
      "Label conventions ('Khóa học', 'Mở rộng', 'chưa xác minh') mapping between Aurora slide citations and Polaris verified facts.",
    type: "convention",
    hasValidator: false,
  },
  "personal-data": {
    name: "personal-data",
    title: "Personal Learning Data & Sensitive Files Ignore Contract",
    description:
      "Canonical ignore patterns for sensitive personal learning data (Vega memory, Aurora progress events, Orion attempts, Polaris learner profile) and third-party/regenerable files (Polaris captures, cache).",
    type: "data",
    schemaPath: join(CONTRACT_ROOT, "personal-data", "patterns.json"),
    hasValidator: true,
  },
};

export function listContracts(): ContractInfo[] {
  return Object.values(CONTRACTS);
}

export function showContract(name: string): string {
  const norm = name.trim();
  const info = CONTRACTS[norm];
  if (!info) {
    return `Contract '${name}' not found. Available contracts:\n${Object.keys(CONTRACTS).map((k) => `  - ${k}`).join("\n")}`;
  }

  const docPath = join(CONTRACT_ROOT, info.name, "README.md");
  if (existsSync(docPath)) {
    return readFileSync(docPath, "utf8");
  }

  return `# ${info.title} (${info.name})\n\nType: ${info.type}\n\n${info.description}`;
}

export function validateContract(name: string, filePath: string): ContractValidationResult {
  const norm = name.trim();
  if (norm === "aurora-progress-event.v1" || norm === "progress-event") {
    return validateProgressFile(filePath);
  }
  if (norm === "personal-data" || norm === "personal" || norm === "gitignore") {
    return validatePersonalDataGitignore(filePath);
  }

  return {
    ok: false,
    contract: name,
    file: filePath,
    totalLines: 0,
    validLines: 0,
    errors: [
      {
        message: `Contract '${name}' does not have an automated data validator (type: ${CONTRACTS[name]?.type ?? "unknown"}). Available validators: 'aurora-progress-event.v1', 'personal-data'`,
      },
    ],
  };
}
