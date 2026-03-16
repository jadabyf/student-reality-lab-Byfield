import { renderInlineChart } from "./InlineChart.js";

function appendParagraphContent(container, text) {
  text.split("\n").forEach((line, i, arr) => {
    const p = document.createElement("p");
    p.textContent = line;
    if (!line.trim() && i > 0 && i < arr.length - 1) {
      p.className = "chat-bubble-spacer";
    }
    container.append(p);
  });
}

function renderAssistantResultCard(text, category, chart, meta) {
  const card = document.createElement("article");
  card.className = "assistant-card";

  const top = document.createElement("div");
  top.className = "assistant-card-top";

  const label = document.createElement("span");
  label.className = "assistant-card-label";
  label.textContent = "Affordability Assistant";
  top.append(label);

  card.append(top);

  const body = document.createElement("div");
  body.className = "assistant-card-body";
  appendParagraphContent(body, text);
  card.append(body);

  if (category) {
    const badge = document.createElement("span");
    badge.className = `chat-rating ${category.cls}`;
    badge.textContent = category.label;
    card.append(badge);
  }

  if (chart) {
    const chartWrap = document.createElement("div");
    chartWrap.className = "chat-chart";

    if (chart.type !== "score" && chart.title) {
      const titleEl = document.createElement("p");
      titleEl.className = "chat-chart-title";
      titleEl.textContent = chart.title;
      chartWrap.append(titleEl);
    }

    renderInlineChart(chartWrap, chart);
    card.append(chartWrap);
  }

  return card;
}

export function appendTypingIndicator(historyEl) {
  const div = document.createElement("div");
  div.className = "chat-message chat-message--bot";
  div.setAttribute("aria-label", "Assistant is typing");

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble typing-bubble";
  for (let i = 0; i < 3; i++) {
    bubble.append(document.createElement("span"));
  }

  div.append(bubble);
  historyEl.append(div);
  historyEl.scrollTop = historyEl.scrollHeight;
  return div;
}

export function appendChatMessage(historyEl, role, text, category, chart, meta = null) {
  const wrapper = document.createElement("div");
  wrapper.className = `chat-message chat-message--${role}`;

  if (role === "bot") {
    wrapper.append(renderAssistantResultCard(text, category, chart, meta));
  } else {
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    appendParagraphContent(bubble, text);
    wrapper.append(bubble);
  }

  historyEl.append(wrapper);
  historyEl.scrollTop = historyEl.scrollHeight;
}
