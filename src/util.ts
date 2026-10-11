/**
 * Common utilities for Constellation MCP: path resolution, atomic writes,
 * rolling backups, secret masking, formatting.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const VERSION = "0.1.6";

export const SECRET_KEY_REGEX = /KEY|TOKEN|SECRET|PASSWORD|AUTH/i;

export function stripBom(str: string): string {
  if (str.charCodeAt(0) === 0xfeff || str.startsWith("\ufeff")) {
    return str.slice(1);
  }
  return str;
}

export function hasBom(str: string): boolean {
  return str.charCodeAt(0) === 0xfeff || str.startsWith("\ufeff");
}

export interface ReadJsonResult<T = any> {
  data: T | null;
  raw: string;
  hasBom: boolean;
  lineEnding: "\r\n" | "\n";
  exists: boolean;
  parseError?: Error;
}

export function readJsonFile<T = any>(filePath: string): ReadJsonResult<T> {
  const absPath = resolve(filePath);
  if (!existsSync(absPath)) {
    return {
      data: null,
      raw: "",
      hasBom: false,
      lineEnding: process.platform === "win32" ? "\r\n" : "\n",
      exists: false,
    };
  }
  try {
    const raw = readFileSync(absPath, "utf8");
    const bom = hasBom(raw);
    const content = bom ? raw.slice(1) : raw;
    const lineEnding = detectLineEnding(raw);
    const parsed = JSON.parse(content);
    return {
      data: parsed as T,
      raw,
      hasBom: bom,
      lineEnding,
      exists: true,
    };
  } catch (e) {
    const raw = existsSync(absPath) ? readFileSync(absPath, "utf8") : "";
    return {
      data: null,
      raw,
      hasBom: hasBom(raw),
      lineEnding: detectLineEnding(raw),
      exists: true,
      parseError: e instanceof Error ? e : new Error(String(e)),
    };
  }
}

export function getHomeDir(): string {
  if (process.env.USERPROFILE) return resolve(process.env.USERPROFILE);
  if (process.env.HOME) return resolve(process.env.HOME);
  try {
    return resolve(homedir());
  } catch {
    return process.platform === "win32" ? "C:\\Users\\Default" : "/tmp";
  }
}

export function getConstellationHome(): string {
  if (process.env.CONSTELLATION_HOME) {
    return resolve(process.env.CONSTELLATION_HOME);
  }
  return join(getHomeDir(), ".constellation");
}

export function parseCommandString(cmdStr: string): { cmd: string; args: string[] } {
  const trimmed = cmdStr.trim();
  const matchRegex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  const parts: string[] = [];
  let match;
  while ((match = matchRegex.exec(trimmed)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[0] ?? "");
  }
  return {
    cmd: parts[0] || "",
    args: parts.slice(1),
  };
}

export function unescapeTomlString(str: string): string {
  try {
    return JSON.parse(`"${str}"`);
  } catch {
    return str.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_REGEX.test(key);
}

export function isSecretReference(val: string): boolean {
  return typeof val === "string" && val.startsWith("${secret:") && val.endsWith("}");
}

export function extractSecretName(val: string): string | null {
  const match = /^\$\{secret:([A-Za-z0-9_]+)\}$/.exec(val.trim());
  return match ? (match[1] ?? null) : null;
}

export function maskSecretsInEnv(env?: Record<string, string>): Record<string, string> | undefined {
  if (!env) return undefined;
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (isSecretKey(k)) {
      masked[k] = "***";
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

export function maskSecretsInObject<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => maskSecretsInObject(item)) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === "env" && v && typeof v === "object" && !Array.isArray(v)) {
      result[k] = maskSecretsInEnv(v as Record<string, string>);
    } else if (isSecretKey(k) && typeof v === "string") {
      result[k] = "***";
    } else {
      result[k] = maskSecretsInObject(v);
    }
  }
  return result as T;
}

export function detectLineEnding(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

export function createRollingBackup(filePath: string): string | null {
  const absPath = resolve(filePath);
  if (!existsSync(absPath)) return null;
  const backupPath = `${absPath}.bak.constellation`;
  try {
    copyFileSync(absPath, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}

export function atomicWriteFile(filePath: string, content: string): void {
  const absPath = resolve(filePath);
  const dir = dirname(absPath);
  mkdirSync(dir, { recursive: true });

  const tempPath = join(dir, `.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`);
  try {
    writeFileSync(tempPath, content, "utf8");
    try {
      renameSync(tempPath, absPath);
    } catch {
      // Windows file replacement fallback
      copyFileSync(tempPath, absPath);
      unlinkSync(tempPath);
    }
  } catch (err) {
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // ignore
      }
    }
    throw err;
  }
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA).sort();
  const keysB = Object.keys(objB).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const k = keysA[i]!;
    if (k !== keysB[i]) return false;
    if (!deepEqual(objA[k], objB[k])) return false;
  }
  return true;
}

export function formatTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return headers.join(" | ");
  }
  const widths = headers.map((h, i) => {
    const colValues = [h, ...rows.map((r) => r[i] ?? "")];
    return Math.max(...colValues.map((v) => v.length));
  });

  const headerLine = headers.map((h, i) => h.padEnd(widths[i]!)).join(" | ");
  const sepLine = widths.map((w) => "-".repeat(w)).join("-|-");
  const rowLines = rows.map((r) => r.map((cell, i) => (cell ?? "").padEnd(widths[i]!)).join(" | "));

  return [headerLine, sepLine, ...rowLines].join("\n");
}
