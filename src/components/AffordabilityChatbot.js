import { createChatService } from "../lib/chatService.js";
import { resolveBaseUrl } from "../lib/runtimeBase.js";
import { normalizePrompt } from "../lib/promptParser.js";
import { mountPromptChips } from "./PromptChips.js";
import { appendChatMessage, appendTypingIndicator } from "./chat/ChatMessage.js";

const API_BASE = `${resolveBaseUrl()}api/affordability`;

export function initAffordabilityChatbot(rows, trendSeriesData) {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const historyEl = document.getElementById("chat-history");
  const chipBar = document.getElementById("chip-bar");
  const modeBadge = document.getElementById("assistant-mode");
  const capabilityText = document.getElementById("assistant-capability-text");
  const chatService = createChatService({ apiBase: API_BASE, rows, trendSeriesData });

  if (!form || !input || !historyEl) return;

  async function sendMessage(rawText) {
    const trimmed = rawText.trim();
    if (!trimmed) return;

    const normalized = normalizePrompt(trimmed);
    appendChatMessage(historyEl, "user", trimmed, null, null);
    input.value = "";
    input.focus();

    const typingEl = appendTypingIndicator(historyEl);
    const reply = await chatService.getReply(normalized);
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

  void chatService.getConnectionStatus().then((health) => {
    if (!modeBadge || !capabilityText) {
      return;
    }

    if (health.mode === "mcp") {
      modeBadge.textContent = health.display.badge;
      modeBadge.classList.remove("assistant-mode--local");
      capabilityText.textContent = health.display.detail;
      return;
    }

    modeBadge.textContent = health.display.badge;
    modeBadge.classList.add("assistant-mode--local");
    capabilityText.textContent = health.display.detail;
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void sendMessage(input.value);
  });
}
