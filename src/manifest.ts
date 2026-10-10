/**
 * Manifest loading, saving, secret interpolation, and import from agent configs.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Manifest, ServerEntry } from "./types.js";
import {
  atomicWriteFile,
  createRollingBackup,
  extractSecretName,
  getConstellationHome,
  isSecretKey,
  isSecretReference,
} from "./util.js";

export function getManifestPath(): string {
  return join(getConstellationHome(), "ecosystem.json");
}

export function getSecretsPath(): string {
  return join(getConstellationHome(), "secrets.json");
}

export function loadSecrets(): Record<string, string> {
  const secretsFile = getSecretsPath();
  if (!existsSync(secretsFile)) return {};
  try {
    const raw = readFileSync(secretsFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // ignore
  }
  return {};
}

export function loadManifest(): Manifest {
  const manifestFile = getManifestPath();
  if (!existsSync(manifestFile)) {
    return { version: "1", servers: [] };
  }
  try {
    const raw = readFileSync(manifestFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.servers)) {
      return parsed as Manifest;
    }
  } catch {
    // fallback
  }
  return { version: "1", servers: [] };
}

export function sanitizeServerForManifest(server: ServerEntry): ServerEntry {
  const cleanEnv: Record<string, string> = {};
  if (server.env) {
    for (const [k, v] of Object.entries(server.env)) {
      if (isSecretKey(k)) {
        if (!isSecretReference(v)) {
          cleanEnv[k] = `\${secret:${k}}`;
        } else {
          cleanEnv[k] = v;
        }
      } else {
        cleanEnv[k] = v;
      }
    }
  }

  return {
    ...server,
    ...(Object.keys(cleanEnv).length > 0 ? { env: cleanEnv } : { env: undefined }),
  };
}

export function saveManifest(manifest: Manifest): void {
  const manifestPath = getManifestPath();
  const dir = dirname(manifestPath);
  mkdirSync(dir, { recursive: true });

  createRollingBackup(manifestPath);

  const cleanServers = manifest.servers.map((s) => sanitizeServerForManifest(s));
  const cleanManifest: Manifest = {
    version: manifest.version || "1",
    servers: cleanServers,
  };

  const jsonStr = JSON.stringify(cleanManifest, null, 2) + "\n";
  atomicWriteFile(manifestPath, jsonStr);
}

export function resolveServerEnv(server: ServerEntry): Record<string, string> {
  if (!server.env) return {};
  const secrets = loadSecrets();
  const resolved: Record<string, string> = {};

  for (const [k, v] of Object.entries(server.env)) {
    if (isSecretReference(v)) {
      const secretName = extractSecretName(v) ?? k;
      resolved[k] = process.env[secretName] ?? secrets[secretName] ?? "";
    } else {
      resolved[k] = v;
    }
  }

  return resolved;
}
