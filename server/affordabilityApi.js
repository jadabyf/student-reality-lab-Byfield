import { routeMessage } from "../src/lib/chatRouter.js";
import { detectIntent, parseMessage } from "../src/lib/promptParser.js";
import {
  invokeAffordabilityTool,
  invokeAffordabilityToolViaMcp,
  loadRows,
  loadTrendSeries,
} from "./affordabilityService.js";
import { getMcpBridgeHealth } from "./mcpBridge.js";

const API_BASE = "/api/affordability";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function buildMcpToolRequest(message, rows) {
  const cityNames = [...new Set(rows.map((row) => row.city))];
  const parsed = parseMessage(message, cityNames);
  const intent = detectIntent(message);

  switch (intent) {
    case "list_dataset_cities":
      return { tool: "list_dataset_cities", args: { limit: 50 }, intent, parsed };
    case "check_city_exists":
      return parsed.city ? { tool: "check_city_exists", args: { city: parsed.city }, intent, parsed } : null;
    case "explain_dataset":
      return { tool: "explain_dataset", args: {}, intent, parsed };
    case "explain_model":
      return { tool: "explain_affordability_model", args: {}, intent, parsed };
    case "compare":
      return parsed.city && parsed.city2 && parsed.income
        ? {
            tool: "compare_cities",
            args: { city1: parsed.city, city2: parsed.city2, annualIncome: parsed.income },
            intent,
            parsed,
          }
        : null;
    case "find_cities":
      return parsed.income
        ? {
            tool: "find_affordable_cities",
            args: { annualIncome: parsed.income, threshold: 30 },
            intent,
            parsed,
          }
        : null;
    case "trend":
      return { tool: "rent_stress_trend", args: {}, intent, parsed };
    case "budget_leftover":
      return parsed.income
        ? {
            tool: "budget_leftover",
            args: {
              annualIncome: parsed.income,
              ...(parsed.city ? { city: parsed.city } : {}),
              ...(parsed.rent ? { monthlyRent: parsed.rent } : {}),
            },
            intent,
            parsed,
          }
        : null;
    case "survival_score":
      return parsed.income
        ? {
            tool: "post_grad_survival_score",
            args: {
              annualIncome: parsed.income,
              ...(parsed.city ? { city: parsed.city } : {}),
              ...(parsed.rent ? { monthlyRent: parsed.rent } : {}),
            },
            intent,
            parsed,
          }
        : null;
    case "affordability":
      if (parsed.city && parsed.income) {
        return {
          tool: "get_city_affordability",
          args: { city: parsed.city, annualIncome: parsed.income },
          intent,
          parsed,
        };
      }

      if (parsed.income && parsed.rent) {
        return {
          tool: "calculate_rent_burden",
          args: { annualIncome: parsed.income, monthlyRent: parsed.rent },
          intent,
          parsed,
        };
      }

      return null;
    default:
      return null;
  }
}

async function tryMcpChatReply(message, rows) {
  const toolRequest = buildMcpToolRequest(message, rows);
  if (!toolRequest) {
    return { ok: false, reason: "No MCP tool mapping for this prompt." };
  }

  const mcpResponse = await invokeAffordabilityToolViaMcp(toolRequest.tool, toolRequest.args);
  if (!mcpResponse.ok) {
    return {
      ok: false,
      reason: mcpResponse.text || "MCP tool returned an error.",
      tool: toolRequest.tool,
    };
  }

  return {
    ok: true,
    text: mcpResponse.text || "MCP returned an empty response.",
    category: mcpResponse.structuredContent?.category ?? null,
    chart: null,
    meta: {
      tool: toolRequest.tool,
      retrieval: "mcp-tool",
      intent: toolRequest.intent,
    },
  };
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export async function handleAffordabilityApiRequest(req, res) {
  const requestUrl = new URL(req.url, "http://localhost");

  if (!requestUrl.pathname.startsWith(API_BASE)) {
    return false;
  }

  if (req.method === "GET" && requestUrl.pathname === `${API_BASE}/health`) {
    const mcpHealth = await getMcpBridgeHealth();

    sendJson(res, 200, {
      ok: mcpHealth.ok,
      transport: mcpHealth.ok ? "mcp-stdio" : "local-retrieval-fallback",
      mode: mcpHealth.ok ? "connected" : "local-fallback",
      reason: mcpHealth.reason ?? null,
      tools: mcpHealth.tools ?? [],
      mcp: mcpHealth,
    });
    return true;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return true;
  }

  let body;

  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: "Request body must be valid JSON." });
    return true;
  }

  try {
    if (requestUrl.pathname === `${API_BASE}/chat`) {
      if (typeof body.message !== "string" || !body.message.trim()) {
        sendJson(res, 400, { ok: false, error: "message is required." });
        return true;
      }

      const [rows, trendSeries] = await Promise.all([loadRows(), loadTrendSeries()]);
      let mcpReply = null;
      let mcpError = null;

      try {
        mcpReply = await tryMcpChatReply(body.message.trim(), rows);
      } catch (error) {
        mcpError = error instanceof Error ? error.message : String(error);
      }

      if (mcpReply?.ok) {
        sendJson(res, 200, {
          ok: true,
          transport: "mcp-stdio",
          ...mcpReply,
        });
        return true;
      }

      const reply = routeMessage(body.message.trim(), rows, trendSeries);

      sendJson(res, 200, {
        ok: true,
        transport: "local-retrieval-fallback",
        ...reply,
        meta: {
          ...(reply.meta ?? {}),
          mcpReason: mcpReply?.reason ?? mcpError ?? null,
        },
      });
      return true;
    }

    if (requestUrl.pathname === `${API_BASE}/tool`) {
      if (typeof body.tool !== "string" || !body.tool.trim()) {
        sendJson(res, 400, { ok: false, error: "tool is required." });
        return true;
      }

      const toolName = body.tool.trim();
      let result;
      let transport = "mcp-stdio";

      try {
        result = await invokeAffordabilityToolViaMcp(toolName, body.args ?? {});
      } catch (error) {
        transport = "local-retrieval-fallback";
        const fallback = await invokeAffordabilityTool(toolName, body.args ?? {});
        result = {
          ok: fallback?.ok ?? true,
          text: "",
          structuredContent: fallback,
          raw: fallback,
          fallbackReason: error instanceof Error ? error.message : String(error),
        };
      }

      sendJson(res, 200, {
        ok: result?.ok ?? true,
        transport,
        tool: toolName,
        result,
      });
      return true;
    }

    sendJson(res, 404, { ok: false, error: "Affordability API route not found." });
    return true;
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown API error.",
    });
    return true;
  }
}