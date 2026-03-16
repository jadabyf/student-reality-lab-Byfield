export const CHAT_CHIPS = [
  { label: "Can I live in Los Angeles with 60K?", prompt: "Can I live in Los Angeles with 60000?" },
  { label: "Compare Dallas and Atlanta on 55k", prompt: "Compare Dallas and Atlanta on 55000" },
  { label: "What cities can I afford on 50k?", prompt: "What cities can I afford on 50000?" },
  { label: "Is rent stress getting worse?", prompt: "Is rent stress getting worse over time?" },
  { label: "My rent is 1800 and I make 48k", prompt: "My rent is 1800 and I make 48000" },
  { label: "Can I afford Atlanta on 52k?", prompt: "Can I afford Atlanta on 52000?" },
  { label: "Survival score in NYC on 70k", prompt: "What is my survival score in NYC on 70000?" },
];

export function mountPromptChips(chipBar, onSelect) {
  if (!chipBar) return;

  CHAT_CHIPS.forEach(({ label, prompt }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = label;
    btn.addEventListener("click", () => onSelect(prompt));
    chipBar.append(btn);
  });
}
