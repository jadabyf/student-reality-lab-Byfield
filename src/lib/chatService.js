import { routeMessage } from "./chatRouter.js";

export function isLocalRuntime() {
  if (typeof window === "undefined") {
    return false;
  }

  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function safeReason(rawReason) {
  if (!rawReason) {
    return "local assistant mode active";
  }

  if (/static deployment/i.test(rawReason)) {
    return "local assistant mode active";
  }

  if (/health request failed/i.test(rawReason) || /could not reach/i.test(rawReason)) {
    return "MCP helper not available";
  }

  return "MCP helper not available";
}

async function checkBridgeHealth(apiBase, runtimeLocal) {
  if (!runtimeLocal) {
    return {
      ok: false,
      mode: "local",
      reason: "local assistant mode active",
      display: {
        badge: "Smart local mode",
        detail: "Using the built-in affordability assistant for this deployment.",
      },
    };
  }

  try {
    const response = await fetch(`${apiBase}/health`);

    if (!response.ok) {
      return {
        ok: false,
        mode: "local",
        reason: safeReason(`health request failed (${response.status})`),
        display: {
          badge: "Smart local mode",
          detail: "Using the built-in affordability assistant while local MCP is unavailable.",
        },
      };
    }

    const payload = await response.json();
    if (payload?.ok) {
      const tools = payload.tools ?? [];
      return {
        ok: true,
        mode: "mcp",
        transport: payload.transport ?? "mcp-stdio",
        tools,
        display: {
          badge: "Connected to MCP server",
          detail: `Enhanced local mode enabled with ${tools.length} MCP tools.`,
        },
      };
    }

    return {
      ok: false,
      mode: "local",
      reason: safeReason(payload?.reason),
      display: {
        badge: "Smart local mode",
        detail: "Using the built-in affordability assistant while local MCP is unavailable.",
      },
    };
  } catch {
    return {
      ok: false,
      mode: "local",
      reason: "MCP helper not available",
      display: {
        badge: "Smart local mode",
        detail: "Using the built-in affordability assistant while local MCP is unavailable.",
      },
    };
  }
}

async function requestBotReply(apiBase, text, rows, trendSeriesData) {
  try {
    const response = await fetch(`${apiBase}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });

    if (!response.ok) {
      throw new Error(`Affordability API returned ${response.status}.`);
    }

    const payload = await response.json();

    if (!payload.ok || typeof payload.text !== "string") {
      throw new Error(payload.error || "Affordability API returned an invalid response.");
    }

    return payload;
  } catch {
    return {
      ok: true,
      transport: "local-retrieval-fallback",
      ...routeMessage(text, rows, trendSeriesData),
      meta: {
        source: "local-fallback",
      },
    };
  }
}

export function createChatService({ apiBase, rows, trendSeriesData }) {
  const runtimeLocal = isLocalRuntime();

  return {
    async getConnectionStatus() {
      return checkBridgeHealth(apiBase, runtimeLocal);
    },
    async getReply(message) {
      return requestBotReply(apiBase, message, rows, trendSeriesData);
    },
  };
}
