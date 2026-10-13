/**
 * Shared Contracts Registry for the Learner MCP Ecosystem.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ContractInfo, ContractValidationResult } from "../types.js";
import { validateProgressFile } from "./progress-event.js";
import { validatePersonalDataGitignore } from "./personal-data.js";
import { validateVegaCardInboxFile } from "./vega-card-inbox.js";
import { validateMiraEmbedFile } from "./mira-embed.js";

export * from "./progress-event.js";
export * from "./personal-data.js";
export * from "./vega-card-inbox.js";
export * from "./mira-embed.js";
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
      "Canonical ignore patterns for sensitive personal learning data (Vega memory, Aurora progress events, Orion attempts, Polaris learner profile, Sirius execution journal) and third-party/regenerable files (Polaris captures, cache).",
    type: "data",
    schemaPath: join(CONTRACT_ROOT, "personal-data", "patterns.json"),
    hasValidator: true,
  },
  "vega-card-inbox.v1": {
    name: "vega-card-inbox.v1",
    title: "Vega Card Inbox Contract v1",
    description:
      "One adaptive review queue: Polaris, Orion, Mira, Rigel (and Aurora, Sirius, manual) drop card candidates as JSON Lines files in <hub>/.vega/inbox/; Vega alone validates, de-duplicates by key and schedules them with FSRS.",
    type: "data",
    schemaPath: join(CONTRACT_ROOT, "vega-card-inbox.v1", "schema.json"),
    hasValidator: true,
  },
  "mira-embed.v1": {
    name: "mira-embed.v1",
    title: "Mira Player Embed Protocol v1",
    description:
      "postMessage protocol between a Mira code-tracing player (iframe) and the Aurora Slides deck that embeds it in a trace slide: ready, event and blur from the player, hello from the deck.",
    type: "protocol",
    schemaPath: join(CONTRACT_ROOT, "mira-embed.v1", "schema.json"),
    hasValidator: true,
  },
};

/** Short names accepted next to the canonical contract names. */
const CONTRACT_ALIASES: Record<string, string> = {
  "progress-event": "aurora-progress-event.v1",
  "aurora-progress-event": "aurora-progress-event.v1",
  personal: "personal-data",
  gitignore: "personal-data",
  "vega-card-inbox": "vega-card-inbox.v1",
  "card-inbox": "vega-card-inbox.v1",
  "mira-embed": "mira-embed.v1",
};

/** Resolves a contract name or alias to the canonical name (unknown names are returned trimmed). */
export function resolveContractName(name: string): string {
  const norm = name.trim();
  if (CONTRACTS[norm]) return norm;
  return CONTRACT_ALIASES[norm.toLowerCase()] ?? norm;
}

export function listContracts(): ContractInfo[] {
  return Object.values(CONTRACTS);
}

export function showContract(name: string): string {
  const canonical = resolveContractName(name);
  const info = CONTRACTS[canonical];
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
  const canonical = resolveContractName(name);
  switch (canonical) {
    case "aurora-progress-event.v1":
      return validateProgressFile(filePath);
    case "personal-data":
      return validatePersonalDataGitignore(filePath);
    case "vega-card-inbox.v1":
      return validateVegaCardInboxFile(filePath);
    case "mira-embed.v1":
      return validateMiraEmbedFile(filePath);
  }

  const validators = Object.values(CONTRACTS)
    .filter((c) => c.hasValidator)
    .map((c) => `'${c.name}'`)
    .join(", ");
  return {
    ok: false,
    contract: name,
    file: filePath,
    totalLines: 0,
    validLines: 0,
    errors: [
      {
        message: `Contract '${name}' does not have an automated data validator (type: ${CONTRACTS[canonical]?.type ?? "unknown"}). Available validators: ${validators}`,
      },
    ],
  };
}

/**
 * The counts of a validation result in the wording of the surface that prints them. The unit differs by contract:
 * events (aurora-progress-event.v1), cards (vega-card-inbox.v1), messages (mira-embed.v1), patterns (personal-data).
 */
export function validationSummary(res: ContractValidationResult, surface: "mcp" | "cli"): string {
  const counts = `${res.validLines}/${res.totalLines}`;
  if (res.contract === "personal-data") {
    return res.ok && surface === "mcp" ? `${counts} pattern(s) covered` : `${counts} patterns covered`;
  }
  if (surface === "cli") {
    return `${counts} lines`;
  }
  if (!res.ok) {
    return `${counts} lines valid`;
  }
  const unit = res.contract === "vega-card-inbox.v1" ? "card" : res.contract === "mira-embed.v1" ? "message" : "event";
  return `${counts} ${unit} line(s) valid`;
}
