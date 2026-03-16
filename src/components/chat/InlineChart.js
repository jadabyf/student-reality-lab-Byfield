import { Chart } from "chart.js";

function burdenColor(value, benchmark) {
  if (value >= 50) return "rgba(220,38,38,0.82)";
  if (value >= 40) return "rgba(249,115,22,0.82)";
  if (value >= benchmark) return "rgba(234,179,8,0.82)";
  return "rgba(52,211,153,0.82)";
}

function renderScoreBar(container, spec) {
  const wrap = document.createElement("div");
  wrap.className = "chat-score-wrap";
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", `Survival score ${spec.score} out of 100. ${spec.label}.`);

  const track = document.createElement("div");
  track.className = "chat-score-track";

  const fill = document.createElement("div");
  fill.className = "chat-score-fill";
  fill.style.width = `${spec.score}%`;
  if (spec.cls === "chat-rating--manageable") fill.style.background = "#34d399";
  else if (spec.cls === "chat-rating--tight") fill.style.background = "#fbbf24";
  else if (spec.cls === "chat-rating--stressful") fill.style.background = "#fb923c";
  else fill.style.background = "#f87171";

  const mark = document.createElement("div");
  mark.className = "chat-score-mark";
  mark.setAttribute("aria-hidden", "true");
  track.append(fill, mark);
  wrap.append(track);

  const labelsRow = document.createElement("div");
  labelsRow.className = "chat-score-labels";

  const numEl = document.createElement("span");
  numEl.className = "chat-score-num";
  numEl.textContent = `${spec.score}/100`;

  const badge = document.createElement("span");
  badge.className = `chat-rating ${spec.cls}`;
  badge.textContent = spec.label;

  labelsRow.append(numEl, badge);
  wrap.append(labelsRow);
  container.append(wrap);
}

export function renderInlineChart(container, spec) {
  if (spec.type === "score") {
    renderScoreBar(container, spec);
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", spec.title ?? "Chart");

  const isHorizontal = spec.type === "hbar" || spec.type === "gauge";
  const chartType = isHorizontal ? "bar" : spec.type;

  let h = { bar: 148, line: 124, gauge: 76 }[spec.type] ?? 130;
  if (spec.type === "hbar" && Array.isArray(spec.labels)) {
    h = Math.min(220, Math.max(88, spec.labels.length * 28 + 32));
  }
  container.style.height = `${h}px`;

  const benchmark = spec.benchmark ?? null;
  const allValues = spec.values ?? (spec.value != null ? [spec.value] : [60]);
  const maxVal = Math.max(...allValues);
  const axisMax = Math.max(benchmark ?? 35, Math.ceil((maxVal + 4) / 5) * 5);
  const datasets = [];

  if (spec.type === "bar") {
    datasets.push({
      data: spec.values,
      backgroundColor: spec.values.map((v) => burdenColor(v, benchmark ?? 30)),
      borderWidth: 0,
      borderRadius: 5,
    });
    if (benchmark !== null) {
      datasets.push({
        type: "line",
        data: spec.labels.map(() => benchmark),
        borderColor: "#dc2626",
        borderDash: [5, 3],
        borderWidth: 1.5,
        pointRadius: 0,
        backgroundColor: "transparent",
        order: 0,
      });
    }
  } else if (spec.type === "hbar") {
    datasets.push({
      data: spec.values,
      backgroundColor: spec.values.map((v) => burdenColor(v, benchmark ?? 30)),
      borderWidth: 0,
      borderRadius: 3,
      barThickness: 14,
    });
  } else if (spec.type === "gauge") {
    datasets.push({
      data: [spec.value],
      backgroundColor: [burdenColor(spec.value, benchmark ?? 30)],
      borderWidth: 0,
      borderRadius: 4,
      barThickness: 24,
    });
    if (benchmark !== null) {
      datasets.push({
        type: "line",
        data: [benchmark],
        borderColor: "#dc2626",
        borderDash: [4, 3],
        borderWidth: 1.5,
        pointRadius: 0,
        backgroundColor: "transparent",
        order: 0,
      });
    }
  } else if (spec.type === "line") {
    datasets.push({
      data: spec.values,
      borderColor: "#1368aa",
      backgroundColor: "rgba(19,104,170,0.10)",
      fill: true,
      tension: 0.3,
      pointRadius: 3,
      pointBackgroundColor: "#1368aa",
      pointBorderColor: "#ffffff",
      pointBorderWidth: 1.5,
    });
  }

  const config = {
    type: chartType,
    data: {
      labels: spec.labels ?? (spec.value != null ? [""] : []),
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 280 },
      plugins: {
        legend: { display: false },
        title: { display: false },
        tooltip: {
          filter: (item) => item.datasetIndex === 0,
          callbacks: {
            label: (ctx) => {
              const val = isHorizontal ? ctx.parsed.x : ctx.parsed.y;
              return ` ${val.toFixed(1)}%`;
            },
          },
        },
      },
      scales: isHorizontal
        ? {
            x: {
              beginAtZero: true,
              max: spec.type === "gauge" ? Math.max(50, axisMax) : axisMax,
              ticks: { callback: (v) => `${v}%`, font: { size: 10 } },
              grid: { color: "rgba(0,0,0,0.06)" },
            },
            y: {
              grid: { display: false },
              ticks: { font: { size: 10 }, padding: 4 },
            },
          }
        : {
            x: {
              grid: { display: false },
              ticks: { font: { size: 10 } },
            },
            y: {
              beginAtZero: spec.type !== "line",
              ticks: { callback: (v) => `${v}%`, font: { size: 10 } },
              grid: { color: "rgba(0,0,0,0.06)" },
            },
          },
    },
  };

  if (isHorizontal) config.options.indexAxis = "y";

  new Chart(canvas, config);
  container.append(canvas);
}
