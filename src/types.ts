/**
 * Core type definitions for Constellation MCP.
 */

export type AgentName = "claude" | "antigravity" | "antigravity-cli" | "cursor" | "codex";

export interface ServerHealthConfig {
  timeoutMs?: number;
}

export interface ServerEntry {
  name: string;
  description?: string;
  repo?: string;
  path?: string;
  transport: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
  agents?: AgentName[];
  build?: string;
  test?: string;
  health?: ServerHealthConfig;
}

export interface Manifest {
  version: string;
  servers: ServerEntry[];
}

export interface AgentServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface HealthResult {
  name: string;
  status: "ok" | "error";
  version?: string;
  toolCount?: number;
  tools?: string[];
  durationMs: number;
  error?: string;
}

export interface DiffEntry {
  agent: string;
  file: string;
  action: "create" | "update" | "delete" | "noop";
  before?: string;
  after?: string;
  changes: string[];
}

export interface GitRepoState {
  isRepo: boolean;
  branch?: string;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
}

export interface ServerStatusSummary {
  name: string;
  command: string;
  args: string[];
  agents: Record<AgentName, "in-sync" | "drift" | "missing" | "unmanaged" | "unsupported">;
  health?: {
    status: "ok" | "error" | "untested";
    durationMs?: number;
    toolCount?: number;
    error?: string;
  };
  git?: GitRepoState;
}

export type DoctorSeverity = "error" | "warning" | "info";
export type DoctorCategory =
  | "drift"
  | "antigravity_drift"
  | "missing_path"
  | "duplicate"
  | "unmanaged"
  | "secret_leak";

export interface DoctorIssue {
  severity: DoctorSeverity;
  category: DoctorCategory;
  server?: string;
  agent?: string;
  file?: string;
  message: string;
  fix?: string;
}

export interface DoctorReport {
  ok: boolean;
  summary: string;
  issues: DoctorIssue[];
  antigravityConsistent: boolean;
  recommendations: string[];
  stats: {
    manifestServers: number;
    agentConfigsChecked: number;
    driftCount: number;
    missingPathsCount: number;
  };
}

export interface UpdateStepResult {
  server: string;
  step: "pull" | "build" | "test";
  status: "ok" | "skipped" | "error";
  output?: string;
  error?: string;
}

export interface ContractInfo {
  name: string;
  title: string;
  description: string;
  type: "data" | "process" | "convention";
  schemaPath?: string;
  hasValidator: boolean;
}

export interface ContractValidationError {
  line?: number;
  path?: string;
  message: string;
}

export interface ContractValidationResult {
  ok: boolean;
  contract: string;
  file: string;
  totalLines: number;
  validLines: number;
  errors: ContractValidationError[];
}
