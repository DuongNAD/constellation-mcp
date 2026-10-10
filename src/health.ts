/**
 * Health check runner for MCP servers using StdioClientTransport + Client.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveServerEnv } from "./manifest.js";
import { HealthResult, ServerEntry } from "./types.js";
import { errMsg, VERSION } from "./util.js";

const DEFAULT_TIMEOUT_MS = 20000;

export async function checkServerHealth(
  server: ServerEntry,
  timeoutOverride?: number,
): Promise<HealthResult> {
  const timeoutMs = timeoutOverride ?? server.health?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const t0 = Date.now();
  const resolvedEnv = resolveServerEnv(server);

  let transport: StdioClientTransport | null = null;
  let client: Client | null = null;
  let timerId: NodeJS.Timeout | null = null;

  try {
    const cleanProcessEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) {
        cleanProcessEnv[k] = v;
      }
    }

    transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: {
        ...cleanProcessEnv,
        ...resolvedEnv,
      },
      stderr: "pipe",
    });

    client = new Client({ name: "constellation-health", version: VERSION });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => {
        reject(new Error(`Server health check timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    await Promise.race([client.connect(transport), timeoutPromise]);
    const { tools } = await Promise.race([client.listTools(), timeoutPromise]);

    const serverInfo = client.getServerVersion();
    const durationMs = Date.now() - t0;

    return {
      name: server.name,
      status: "ok",
      version: serverInfo ? `${serverInfo.name}@${serverInfo.version}` : undefined,
      toolCount: tools.length,
      tools: tools.map((t) => t.name),
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - t0;
    return {
      name: server.name,
      status: "error",
      durationMs,
      error: errMsg(err),
    };
  } finally {
    if (timerId) clearTimeout(timerId);
    try {
      if (client) await client.close();
    } catch {
      // ignore
    }
    try {
      if (transport) await transport.close();
    } catch {
      // ignore
    }
  }
}

export async function checkAllHealth(
  servers: ServerEntry[],
  timeoutOverride?: number,
): Promise<HealthResult[]> {
  const results: HealthResult[] = [];
  for (const server of servers) {
    const res = await checkServerHealth(server, timeoutOverride);
    results.push(res);
  }
  return results;
}
