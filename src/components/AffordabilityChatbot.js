import { routeMessage } from "../lib/chatRouter.js";
import { normalizePrompt } from "../lib/promptParser.js";
import { mountPromptChips } from "./PromptChips.js";
import { appendChatMessage, appendTypingIndicator } from "./chat/ChatMessage.js";

const API_BASE = `${import.meta.env.BASE_URL}api/affordability`;

async function checkBridgeHealth() {
  try {
    const response = await fetch(`${API_BASE}/health`);

    if (!response.ok) {
      return { ok: false };
    }

    const payload = await response.json();
    return payload?.ok ? { ok: true, transport: payload.transport ?? "http-bridge" } : { ok: false };
  } catch {
    return { ok: false };
  }
}

async function requestBotReply(text, rows, trendSeriesData) {
  try {
    const response = await fetch(`${API_BASE}/chat`, {
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
  } catch (error) {
    console.warn("Falling back to local affordability router.", error);
    return {
      ok: true,
      transport: "local-retrieval-fallback",
      ...routeMessage(text, rows, trendSeriesData),
    };
  }
}

export function initAffordabilityChatbot(rows, trendSeriesData) {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const historyEl = document.getElementById("chat-history");
  const chipBar = document.getElementById("chip-bar");
  const modeBadge = document.getElementById("assistant-mode");
  const capabilityText = document.getElementById("assistant-capability-text");

  if (!form || !input || !historyEl) return;

  async function sendMessage(rawText) {
    const trimmed = rawText.trim();
    if (!trimmed) return;

    const normalized = normalizePrompt(trimmed);
    appendChatMessage(historyEl, "user", trimmed, null, null);
    input.value = "";
    input.focus();

    const typingEl = appendTypingIndicator(historyEl);
    const reply = await requestBotReply(normalized, rows, trendSeriesData);
    typingEl.remove();

    appendChatMessage(
      historyEl,
      "bot",
      reply.text,
      reply.category,
      reply.chart ?? null,
      {
        ...(reply.meta ?? {}),
        transport: reply.transport ?? "unknown",
      },
    );
  }

  mountPromptChips(chipBar, (prompt) => {
    void sendMessage(prompt);
  });

  appendChatMessage(
    historyEl,
    "bot",
    "Ask me things like: Can I live in Los Angeles with 60k? Compare Dallas and LA on 60k. What cities can I afford on 55k? I will retrieve the relevant dataset records first, then explain the calculations and show an inline chart.",
    null,
    null,
    {
      tool: "router",
      retrieval: "query-routing",
    },
  );

  void checkBridgeHealth().then((health) => {
    if (!modeBadge || !capabilityText) {
      return;
    }

    if (health.ok) {
      modeBadge.textContent = "MCP-aligned mode";
      modeBadge.classList.remove("assistant-mode--local");
      capabilityText.textContent =
        "This assistant is using the project HTTP bridge backed by the repo MCP tool layer for chat responses.";
      return;
    }

    modeBadge.textContent = "Local retrieval mode";
    modeBadge.classList.add("assistant-mode--local");
    capabilityText.textContent =
      "MCP bridge is currently unavailable, so responses use local dataset retrieval and the same affordability tool logic in-browser.";
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void sendMessage(input.value);
  });
}
