import { routeMessage } from "../src/lib/chatRouter.js";
import {
  invokeAffordabilityTool,
  loadRows,
  loadTrendSeries,
} from "./affordabilityService.js";

const API_BASE = "/api/affordability";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
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
    sendJson(res, 200, {
      ok: true,
      transport: "http-bridge",
      tools: [
        "get_city_affordability",
        "calculate_rent_burden",
        "compare_cities",
        "rent_stress_trend",
        "post_grad_survival_score",
        "find_affordable_cities",
        "budget_leftover",
      ],
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
      const reply = routeMessage(body.message.trim(), rows, trendSeries);

      sendJson(res, 200, {
        ok: true,
        transport: "http-bridge",
        ...reply,
      });
      return true;
    }

    if (requestUrl.pathname === `${API_BASE}/tool`) {
      if (typeof body.tool !== "string" || !body.tool.trim()) {
        sendJson(res, 400, { ok: false, error: "tool is required." });
        return true;
      }

      const result = await invokeAffordabilityTool(body.tool.trim(), body.args ?? {});
      sendJson(res, 200, {
        ok: result?.ok ?? true,
        transport: "http-bridge",
        tool: body.tool.trim(),
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