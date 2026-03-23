import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const mcpServerScript = path.resolve(repoRoot, "mcp", "affordability-server.mjs");

let client = null;
let connectPromise = null;

const bridgeState = {
  connected: false,
  enabled: true,
  transport: "mcp-stdio",
  pid: null,
  tools: [],
  lastError: null,
  updatedAt: null,
};

function nowIso() {
  return new Date().toISOString();
}

function setBridgeError(error) {
  bridgeState.connected = false;
  bridgeState.lastError = error instanceof Error ? error.message : String(error);
  bridgeState.updatedAt = nowIso();
}

function resetBridgeClient() {
  client = null;
  connectPromise = null;
  bridgeState.connected = false;
  bridgeState.pid = null;
}

function shouldEnableMcp() {
  if (process.env.MCP_DISABLED === "1") {
    return false;
  }

  return true;
}

async function connectMcpClient() {
  if (!shouldEnableMcp()) {
    bridgeState.enabled = false;
    setBridgeError("MCP disabled by MCP_DISABLED=1");
    throw new Error("MCP bridge is disabled by environment.");
  }

  bridgeState.enabled = true;

  if (client) {
    return client;
  }

  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = (async () => {
    const mcpClient = new Client(
      {
        name: "student-reality-lab-http-bridge",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [mcpServerScript],
      cwd: repoRoot,
      stderr: "pipe",
    });

    if (transport.stderr) {
      transport.stderr.on("data", (chunk) => {
        const line = String(chunk || "").trim();
        if (line) {
          console.warn(`[mcp-server] ${line}`);
        }
      });
    }

    transport.onerror = (error) => {
      setBridgeError(error);
    };

    transport.onclose = () => {
      setBridgeError("MCP process closed.");
      resetBridgeClient();
    };

    await mcpClient.connect(transport);

    client = mcpClient;
    bridgeState.connected = true;
    bridgeState.pid = transport.pid;
    bridgeState.lastError = null;
    bridgeState.updatedAt = nowIso();

    return mcpClient;
  })();

  try {
    return await connectPromise;
  } catch (error) {
    setBridgeError(error);
    resetBridgeClient();
    throw error;
  } finally {
    connectPromise = null;
  }
}

export async function getMcpBridgeHealth() {
  if (!shouldEnableMcp()) {
    bridgeState.enabled = false;
    return {
      ok: false,
      connected: false,
      enabled: false,
      transport: bridgeState.transport,
      reason: "MCP disabled by MCP_DISABLED=1",
      tools: [],
    };
  }

  try {
    const mcpClient = await connectMcpClient();
    const toolsPayload = await mcpClient.listTools();
    const tools = (toolsPayload.tools ?? []).map((tool) => tool.name);

    bridgeState.connected = true;
    bridgeState.tools = tools;
    bridgeState.lastError = null;
    bridgeState.updatedAt = nowIso();

    return {
      ok: true,
      connected: true,
      enabled: true,
      transport: bridgeState.transport,
      tools,
      pid: bridgeState.pid,
    };
  } catch (error) {
    setBridgeError(error);
    return {
      ok: false,
      connected: false,
      enabled: true,
      transport: bridgeState.transport,
      reason: bridgeState.lastError,
      tools: bridgeState.tools,
      pid: bridgeState.pid,
    };
  }
}

export async function callMcpTool(toolName, args = {}) {
  const mcpClient = await connectMcpClient();
  const result = await mcpClient.callTool({
    name: toolName,
    arguments: args,
  }, CallToolResultSchema);

  bridgeState.connected = true;
  bridgeState.lastError = null;
  bridgeState.updatedAt = nowIso();

  return result;
}
