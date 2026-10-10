/**
 * Safe repository update, build, and test runner.
 * Never forces, never resets; uses git pull --ff-only on clean trees.
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { ServerEntry, UpdateStepResult } from "./types.js";
import { errMsg } from "./util.js";

const execFileAsync = promisify(execFile);

export interface UpdateOptions {
  pull?: boolean;
  build?: boolean;
  test?: boolean;
}

export function isGitRepo(dirPath?: string): boolean {
  if (!dirPath) return false;
  const abs = resolve(dirPath);
  return existsSync(join(abs, ".git"));
}

export function getGitRepoState(dirPath?: string): {
  isRepo: boolean;
  branch?: string;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
} {
  if (!dirPath || !isGitRepo(dirPath)) {
    return { isRepo: false };
  }
  const abs = resolve(dirPath);
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: abs,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const statusOut = execFileSync("git", ["status", "--porcelain"], {
      cwd: abs,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    return {
      isRepo: true,
      branch,
      dirty: statusOut.length > 0,
    };
  } catch {
    return { isRepo: true };
  }
}

export async function updateServer(
  server: ServerEntry,
  options: UpdateOptions = {},
): Promise<UpdateStepResult[]> {
  const pull = options.pull ?? true;
  const build = options.build ?? true;
  const test = options.test ?? true;

  const results: UpdateStepResult[] = [];

  if (!server.path || !existsSync(resolve(server.path))) {
    results.push({
      server: server.name,
      step: "pull",
      status: "skipped",
      error: `Server path not found: ${server.path ?? "<undefined>"}`,
    });
    return results;
  }

  const dir = resolve(server.path);
  const git = isGitRepo(dir);

  // 1. Git pull
  if (pull) {
    if (!git) {
      results.push({
        server: server.name,
        step: "pull",
        status: "skipped",
        output: "Not a git repository",
      });
    } else {
      try {
        const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain"], {
          cwd: dir,
        });

        if (statusOut.trim().length > 0) {
          results.push({
            server: server.name,
            step: "pull",
            status: "skipped",
            output: "Working tree is dirty (uncommitted changes). Skipping pull to avoid conflicts.",
          });
        } else {
          const { stdout: pullOut } = await execFileAsync("git", ["pull", "--ff-only"], {
            cwd: dir,
          });
          results.push({
            server: server.name,
            step: "pull",
            status: "ok",
            output: pullOut.trim() || "Already up to date.",
          });
        }
      } catch (err) {
        results.push({
          server: server.name,
          step: "pull",
          status: "error",
          error: errMsg(err),
        });
      }
    }
  }

  // 2. Build step
  if (build) {
    if (!server.build) {
      results.push({
        server: server.name,
        step: "build",
        status: "skipped",
        output: "No build command configured in manifest",
      });
    } else {
      try {
        // Execute build command with shell: true or node
        const parts = server.build.trim().split(/\s+/);
        const cmd = parts[0]!;
        const args = parts.slice(1);
        const { stdout, stderr } = await execFileAsync(cmd, args, {
          cwd: dir,
          shell: true,
        });
        results.push({
          server: server.name,
          step: "build",
          status: "ok",
          output: (stdout + (stderr ? `\n${stderr}` : "")).trim() || "Build succeeded",
        });
      } catch (err) {
        results.push({
          server: server.name,
          step: "build",
          status: "error",
          error: errMsg(err),
        });
      }
    }
  }

  // 3. Test step
  if (test) {
    if (!server.test) {
      results.push({
        server: server.name,
        step: "test",
        status: "skipped",
        output: "No test command configured in manifest",
      });
    } else {
      try {
        const parts = server.test.trim().split(/\s+/);
        const cmd = parts[0]!;
        const args = parts.slice(1);
        const { stdout, stderr } = await execFileAsync(cmd, args, {
          cwd: dir,
          shell: true,
        });
        results.push({
          server: server.name,
          step: "test",
          status: "ok",
          output: (stdout + (stderr ? `\n${stderr}` : "")).trim() || "Tests passed",
        });
      } catch (err) {
        results.push({
          server: server.name,
          step: "test",
          status: "error",
          error: errMsg(err),
        });
      }
    }
  }

  return results;
}

export async function updateAllServers(
  servers: ServerEntry[],
  options: UpdateOptions = {},
): Promise<UpdateStepResult[]> {
  const allResults: UpdateStepResult[] = [];
  for (const server of servers) {
    const res = await updateServer(server, options);
    allResults.push(...res);
  }
  return allResults;
}
