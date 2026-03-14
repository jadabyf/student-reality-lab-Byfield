import "./styles.css";
import { routeMessage } from "./lib/chatRouter.js";
import { buildTrendSeriesFromRows } from "./lib/affordabilityTools.js";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  SubTitle,
  Title,
  Tooltip,
} from "chart.js";

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Title,
  SubTitle,
  Tooltip,
  Legend,
);

if (!Tooltip.positioners.benchmarkSafe) {
  Tooltip.positioners.benchmarkSafe = function benchmarkSafe(items, eventPosition) {
    const nearest = Tooltip.positioners.nearest.call(this, items, eventPosition);

    if (!nearest) {
      return false;
    }

    // Keep tooltip below the custom benchmark badge drawn near the top of chart area.
    const minY = this.chart.chartArea.top + 34;
    return {
      x: nearest.x,
      y: Math.max(minY, nearest.y),
    };
  };
}

const DATASET_PATH = "/datasets/processed.json";
const TOP_CITY_COUNT = 12;
const AFFORDABILITY_THRESHOLD = 30;

const yearSelect = document.getElementById("year-select");
const yearPrevBtn = document.getElementById("year-prev");
const yearNextBtn = document.getElementById("year-next");
const yearLatestBtn = document.getElementById("year-latest");
const annotationEl = document.getElementById("annotation");
const chartCanvas = document.getElementById("rent-chart");
const trendCanvas = document.getElementById("trend-chart");
const keyTakeawayEl = document.getElementById("key-takeaway");
const yearFeedbackEl = document.getElementById("year-feedback");
const systemStatusEl = document.getElementById("system-status");
const cityLabelNoteEl = document.getElementById("city-label-note");
const trendAnnotationEl = document.getElementById("trend-annotation");
const finalTakeawayEl = document.getElementById("final-takeaway");

let allRows = [];
let rentChart = null;
let trendChart = null;
let trendSeries = [];
let rowsByYear = new Map();
let trendLabels = [];
let trendValues = [];

function formatPercent(decimalValue) {
  return `${(decimalValue * 100).toFixed(1)}%`;
}

function formatAxisPercent(value) {
  return `${Number(value).toFixed(0)}%`;
}

function updateAnnotation(topRecord, allRowsForYear) {
  const aboveThresholdCount = allRowsForYear.filter(
    (row) => row.rent_burden * 100 >= AFFORDABILITY_THRESHOLD,
  ).length;

  annotationEl.textContent = `Highest rent burden in ${topRecord.year}: ${topRecord.city} at ${formatPercent(
    topRecord.rent_burden,
  )}. ${aboveThresholdCount} of ${allRowsForYear.length} tracked cities are above the ${AFFORDABILITY_THRESHOLD}% benchmark.`;

  keyTakeawayEl.textContent = `Reality Check (${topRecord.year}): ${aboveThresholdCount} of ${allRowsForYear.length} tracked cities are above the 30% affordability line. Rent pressure is not limited to one or two outliers.`;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function computeAxisDomain(values) {
  const maxValue = Math.max(...values);
  const xMax = Math.max(40, Math.ceil((maxValue + 4) / 5) * 5);
  return { xMax };
}

function buildRowsByYear(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    if (!grouped.has(row.year)) {
      grouped.set(row.year, []);
    }
    grouped.get(row.year).push(row);
  });

  grouped.forEach((yearRows, year) => {
    grouped.set(
      year,
      [...yearRows].sort((a, b) => b.rent_burden - a.rent_burden),
    );
  });

  return grouped;
}

const thresholdLinePlugin = {
  id: "thresholdLine",
  afterDraw(chart) {
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;

    if (!xScale || !yScale) {
      return;
    }

    const thresholdX = xScale.getPixelForValue(AFFORDABILITY_THRESHOLD);
    const { ctx } = chart;
    const thresholdLabel = "30% benchmark";

    ctx.save();
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(thresholdX, yScale.top);
    ctx.lineTo(thresholdX, yScale.bottom);
    ctx.stroke();

    ctx.font = "11px Manrope, Segoe UI, sans-serif";
    const labelPaddingX = 6;
    const labelHeight = 18;
    const labelWidth = ctx.measureText(thresholdLabel).width + labelPaddingX * 2;
    const minLabelX = xScale.left + labelWidth / 2 + 4;
    const maxLabelX = xScale.right - labelWidth / 2 - 4;
    const labelCenterX = Math.max(minLabelX, Math.min(maxLabelX, thresholdX));
    const labelTop = yScale.top + 5;

    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255, 242, 242, 0.95)";
    drawRoundedRect(ctx, labelCenterX - labelWidth / 2, labelTop, labelWidth, labelHeight, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(153, 27, 27, 0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#991b1b";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(thresholdLabel, labelCenterX, labelTop + labelHeight / 2 + 0.5);
    ctx.restore();
  },
};

function toShortCityLabel(label) {
  return label.length > 16 ? `${label.slice(0, 16)}...` : label;
}

function renderChartForYear(selectedYear) {
  const rowsForYear = rowsByYear.get(selectedYear) ?? [];

  if (rowsForYear.length === 0) {
    annotationEl.textContent = `No data available for ${selectedYear}.`;
    cityLabelNoteEl.textContent = "";
    return;
  }

  const topRows = rowsForYear.slice(0, TOP_CITY_COUNT);
  const labels = topRows.map((row) => toShortCityLabel(row.city));
  const values = topRows.map((row) => Number((row.rent_burden * 100).toFixed(1)));
  const domainInfo = computeAxisDomain(values);

  const topCity = topRows[0];
  const backgroundColors = topRows.map((row) =>
    row.city === topRows[0]?.city
      ? "rgba(217, 83, 79, 0.88)"
      : row.city === topRows[1]?.city || row.city === topRows[2]?.city
        ? "rgba(249, 115, 22, 0.82)"
        : "rgba(56, 189, 248, 0.8)",
  );

  updateAnnotation(topCity, rowsForYear);
  yearFeedbackEl.textContent = `Viewing ${selectedYear}. The chart and takeaway update when you change the year.`;
  systemStatusEl.textContent = "";

  const shortenedLabelMap = topRows
    .map((row) => {
      const shortLabel = toShortCityLabel(row.city);
      return shortLabel.endsWith("...") ? `${shortLabel} = ${row.city}` : null;
    })
    .filter(Boolean);

  cityLabelNoteEl.textContent = shortenedLabelMap.length
    ? `Abbreviated axis labels: ${shortenedLabelMap.join("; ")}`
    : "";

  renderTrendView(selectedYear);
  updateFinalTakeaway(selectedYear, topCity, rowsForYear);

  const chartData = {
    labels,
    datasets: [
      {
        label: "Rent Burden (% of income)",
        data: values,
        backgroundColor: backgroundColors,
        borderColor: "rgba(31, 41, 55, 0.5)",
        borderWidth: 1,
        barThickness: 14,
        maxBarThickness: 20,
        categoryPercentage: 0.72,
        barPercentage: 0.84,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: "y",
    layout: {
      padding: {
        top: 22,
        right: 14,
        bottom: 12,
        left: 22,
      },
    },
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: `Rent Burden by City (${selectedYear})`,
        padding: {
          bottom: 6,
        },
        font: {
          size: 16,
          weight: "700",
        },
      },
      subtitle: {
        display: true,
        text: `Top ${TOP_CITY_COUNT} highest-burden cities by rent pressure`,
        padding: {
          bottom: 12,
        },
        font: {
          size: 12,
        },
      },
      tooltip: {
        position: "benchmarkSafe",
        yAlign: "bottom",
        caretPadding: 12,
        padding: 10,
        callbacks: {
          title(tooltipItems) {
            const row = topRows[tooltipItems[0].dataIndex];
            return row?.city ?? tooltipItems[0].label;
          },
          label(context) {
            return ` Rent burden: ${formatAxisPercent(context.parsed.y)}`;
          },
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        max: domainInfo.xMax,
        title: {
          display: true,
          text: "Rent Burden (%)",
          padding: {
            top: 6,
          },
          font: {
            size: 12,
            weight: "600",
          },
        },
        grid: {
          color: "rgba(148, 163, 184, 0.2)",
        },
        ticks: {
          stepSize: 10,
          maxTicksLimit: 8,
          padding: 10,
          font: {
            size: 11,
          },
          callback(value) {
            return formatAxisPercent(value);
          },
        },
      },
      y: {
        title: {
          display: true,
          text: "City",
          padding: {
            bottom: 6,
          },
          font: {
            size: 12,
            weight: "600",
          },
        },
        afterFit(scale) {
          scale.width += 14;
        },
        ticks: {
          autoSkip: false,
          maxRotation: 0,
          minRotation: 0,
          padding: 10,
          font: {
            size: 11,
            weight: "500",
          },
        },
        grid: {
          display: false,
        },
      },
    },
  };

  if (rentChart) {
    rentChart.data = chartData;
    rentChart.options = chartOptions;
    rentChart.update();
    return;
  }

  rentChart = new Chart(chartCanvas, {
    type: "bar",
    data: chartData,
    options: chartOptions,
    plugins: [thresholdLinePlugin],
  });
}

function renderTrendView(selectedYear) {
  if (!trendCanvas || trendSeries.length === 0) {
    return;
  }

  const selectedIndex = trendSeries.findIndex((point) => point.year === selectedYear);
  const pointRadius = trendSeries.map((_, index) => (index === selectedIndex ? 5 : 3));
  const pointBackgroundColor = trendSeries.map((_, index) => (index === selectedIndex ? "#dc2626" : "#1368aa"));

  const trendData = {
    labels: trendLabels,
    datasets: [
      {
        label: "Cities above 30% threshold",
        data: trendValues,
        borderColor: "#1368aa",
        backgroundColor: "rgba(19, 104, 170, 0.12)",
        pointBorderColor: "#ffffff",
        pointBorderWidth: 1.5,
        pointBackgroundColor,
        pointRadius,
        tension: 0.25,
        fill: true,
      },
    ],
  };

  const trendOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: "Share of Cities Above the 30% Affordability Threshold",
        font: {
          size: 14,
          weight: "700",
        },
      },
      tooltip: {
        callbacks: {
          label(context) {
            const point = trendSeries[context.dataIndex];
            return ` ${point.aboveShare.toFixed(1)}% (${point.aboveCount} of ${point.total} cities)`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          font: {
            size: 11,
          },
        },
      },
      y: {
        beginAtZero: true,
        max: 100,
        title: {
          display: true,
          text: "% of tracked cities",
          font: {
            size: 11,
            weight: "600",
          },
        },
        ticks: {
          callback(value) {
            return `${Number(value).toFixed(0)}%`;
          },
          font: {
            size: 11,
          },
        },
        grid: {
          color: "rgba(148, 163, 184, 0.2)",
        },
      },
    },
  };

  if (trendChart) {
    trendChart.data = trendData;
    trendChart.options = trendOptions;
    trendChart.update();
  } else {
    trendChart = new Chart(trendCanvas, {
      type: "line",
      data: trendData,
      options: trendOptions,
    });
  }

  const firstPoint = trendSeries[0];
  const currentPoint = trendSeries[selectedIndex] ?? trendSeries[trendSeries.length - 1];
  const delta = currentPoint.aboveShare - firstPoint.aboveShare;
  const directionText = delta > 0 ? "higher" : delta < 0 ? "lower" : "unchanged";

  trendAnnotationEl.textContent = `In ${currentPoint.year}, ${currentPoint.aboveCount} of ${currentPoint.total} tracked cities (${currentPoint.aboveShare.toFixed(
    1,
  )}%) were above the 30% threshold. That is ${Math.abs(delta).toFixed(1)} points ${directionText} than ${firstPoint.year}.`;
}

function updateFinalTakeaway(selectedYear, topCity, rowsForYear) {
  if (!finalTakeawayEl || trendSeries.length === 0) {
    return;
  }

  const selectedPoint = trendSeries.find((point) => point.year === selectedYear) ?? trendSeries[trendSeries.length - 1];
  const earliestPoint = trendSeries[0];
  const change = selectedPoint.aboveShare - earliestPoint.aboveShare;

  const trendMessage =
    change > 0
      ? `the share of cities above the affordability stress line has risen by ${change.toFixed(1)} points since ${earliestPoint.year}`
      : change < 0
        ? `the share of cities above the affordability stress line has dropped by ${Math.abs(change).toFixed(1)} points since ${earliestPoint.year}`
        : `the share of cities above the affordability stress line is unchanged from ${earliestPoint.year}`;

  finalTakeawayEl.textContent = `${selectedYear} data shows a clear pattern: rent pressure remains high across major cities. ${selectedPoint.aboveCount} of ${selectedPoint.total} tracked cities sit above the 30% benchmark, and ${trendMessage}. For students planning to move out, this means location choice and early-career salary need to be evaluated together, especially in high-pressure markets like ${topCity.city}.`;
}

function setupYearSelect(years) {
  years.forEach((year) => {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    yearSelect.append(option);
  });

  const latestYear = years[years.length - 1];

  function updateNavState(selectedYear) {
    const selectedIndex = years.indexOf(selectedYear);
    yearPrevBtn.disabled = selectedIndex <= 0;
    yearNextBtn.disabled = selectedIndex >= years.length - 1;
    yearLatestBtn.disabled = selectedYear === latestYear;
  }

  yearSelect.value = String(latestYear);

  yearSelect.addEventListener("change", () => {
    const selectedYear = Number(yearSelect.value);
    renderChartForYear(selectedYear);
    updateNavState(selectedYear);
  });

  yearPrevBtn.addEventListener("click", () => {
    const currentIndex = years.indexOf(Number(yearSelect.value));
    const nextIndex = Math.max(0, currentIndex - 1);
    yearSelect.value = String(years[nextIndex]);
    yearSelect.dispatchEvent(new Event("change"));
  });

  yearNextBtn.addEventListener("click", () => {
    const currentIndex = years.indexOf(Number(yearSelect.value));
    const nextIndex = Math.min(years.length - 1, currentIndex + 1);
    yearSelect.value = String(years[nextIndex]);
    yearSelect.dispatchEvent(new Event("change"));
  });

  yearLatestBtn.addEventListener("click", () => {
    yearSelect.value = String(latestYear);
    yearSelect.dispatchEvent(new Event("change"));
  });

  renderChartForYear(latestYear);
  updateNavState(latestYear);
}

// ── Affordability Chatbot ────────────────────────────────────────────────
// UI rendering, chip wiring, inline chart rendering.
// Parser/router/tool logic lives in src/lib/chatRouter.js + affordabilityTools.js.
// The HTTP bridge at /api/affordability/ (built by Vite plugin) routes requests
// through the same tool layer as the project MCP server.

// ── City alias normalization ──────────────────────────────────────────────

const CITY_ALIASES = [
  [/\bLA\b/g, "Los Angeles"],
  [/\bNYC\b/g, "New York"],
  [/\bSF\b/g, "San Francisco"],
  [/\bDC\b/g, "Washington"],
  [/\bPhilly\b/gi, "Philadelphia"],
];

/** Expand shorthands so the parser can match city and income correctly. */
function normalizePrompt(text) {
  let out = text.replace(/\b(\d+(?:\.\d+)?)\s*k\b/gi, (_, n) => String(parseFloat(n) * 1000));
  for (const [re, expansion] of CITY_ALIASES) {
    out = out.replace(re, expansion);
  }
  return out;
}

// ── Suggestion chips ──────────────────────────────────────────────────────

const CHIPS = [
  { label: "Afford New York on 70k?", prompt: "Can I afford New York on 70000?" },
  { label: "Compare Dallas vs LA on 60k", prompt: "Compare Dallas vs LA on 60000" },
  { label: "Cities for 55k income", prompt: "Find cities I can afford on 55000" },
  { label: "Is rent stress getting worse?", prompt: "Is rent stress getting worse?" },
  { label: "Rent 1800, income 48k", prompt: "My rent is 1800 and I make 48000" },
  { label: "Survival score: Chicago 65k", prompt: "What is my survival score in Chicago on 65000?" },
  { label: "Budget leftover: 52k, rent 1400", prompt: "I make 52000 and my rent is 1400, what is left over?" },
];

// ── HTTP bridge to project tool layer ────────────────────────────────────

async function requestBotReply(text, rows, trendSeriesData) {
  try {
    const response = await fetch("/api/affordability/chat", {
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
    return { ok: true, transport: "local-fallback", ...routeMessage(text, rows, trendSeriesData) };
  }
}

// ── Inline chart helpers ──────────────────────────────────────────────────

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

function renderInlineChart(container, spec) {
  if (spec.type === "score") {
    renderScoreBar(container, spec);
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", spec.title ?? "Chart");

  const isHorizonal = spec.type === "hbar" || spec.type === "gauge";
  const chartType = isHorizonal ? "bar" : spec.type;

  // Container height
  let h = { bar: 148, line: 124, gauge: 76 }[spec.type] ?? 130;
  if (spec.type === "hbar" && Array.isArray(spec.labels)) {
    h = Math.min(220, Math.max(88, spec.labels.length * 28 + 32));
  }
  container.style.height = `${h}px`;

  const benchmark = spec.benchmark ?? null;
  const allValues = spec.values ?? (spec.value != null ? [spec.value] : [60]);
  const maxVal = Math.max(...allValues);
  const axisMax = Math.max(benchmark ?? 35, Math.ceil((maxVal + 4) / 5) * 5);

  // Build datasets
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
              const val = isHorizonal ? ctx.parsed.x : ctx.parsed.y;
              return ` ${val.toFixed(1)}%`;
            },
          },
        },
      },
      scales: isHorizonal
        ? {
            x: {
              beginAtZero: true,
              max: spec.type === "gauge" ? Math.max(50, axisMax) : 32,
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

  if (isHorizonal) config.options.indexAxis = "y";

  new Chart(canvas, config);
  container.append(canvas);
}

// ── Typing indicator ──────────────────────────────────────────────────────

function appendTypingIndicator(historyEl) {
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

// ── Message renderer ──────────────────────────────────────────────────────

function appendChatMessage(historyEl, role, text, category, chart) {
  const wrapper = document.createElement("div");
  wrapper.className = `chat-message chat-message--${role}`;

  // One bubble per message — lines become <p> elements inside a single bubble div
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";

  text.split("\n").forEach((line, i, arr) => {
    const p = document.createElement("p");
    p.textContent = line;
    if (!line.trim() && i > 0 && i < arr.length - 1) {
      p.className = "chat-bubble-spacer";
    }
    bubble.append(p);
  });

  wrapper.append(bubble);

  if (category) {
    const badge = document.createElement("span");
    badge.className = `chat-rating ${category.cls}`;
    badge.textContent = category.label;
    wrapper.append(badge);
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
    wrapper.append(chartWrap);
  }

  historyEl.append(wrapper);
  historyEl.scrollTop = historyEl.scrollHeight;
}

// ── Bot initializer ───────────────────────────────────────────────────────

function initAffordabilityBot(rows, trendSeriesData) {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const historyEl = document.getElementById("chat-history");
  const chipBar = document.getElementById("chip-bar");

  if (!form || !input || !historyEl) return;

  async function sendMessage(rawText) {
    if (!rawText.trim()) return;
    const normalized = normalizePrompt(rawText.trim());
    appendChatMessage(historyEl, "user", rawText.trim(), null, null);
    input.value = "";
    input.focus();
    const typingEl = appendTypingIndicator(historyEl);
    const reply = await requestBotReply(normalized, rows, trendSeriesData);
    typingEl.remove();
    appendChatMessage(historyEl, "bot", reply.text, reply.category, reply.chart ?? null);
  }

  // Suggestion chips — bypass the text input for clean keyboard UX
  if (chipBar) {
    CHIPS.forEach(({ label, prompt }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = label;
      btn.addEventListener("click", () => void sendMessage(prompt));
      chipBar.append(btn);
    });
  }

  appendChatMessage(
    historyEl,
    "bot",
    "Hi! Tell me your income and a city or rent amount and I\u2019ll estimate your rent burden \u2014 or tap a quick question below.",
    null,
    null,
  );

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void sendMessage(input.value);
  });
}

async function init() {
  try {
    systemStatusEl.textContent = "Loading affordability data...";
    const response = await fetch(DATASET_PATH);

    if (!response.ok) {
      throw new Error("Failed to load processed dataset.");
    }

    allRows = await response.json();
    rowsByYear = buildRowsByYear(allRows);

    const years = [...rowsByYear.keys()].sort((a, b) => a - b);

    if (years.length === 0) {
      throw new Error("Dataset has no rows to plot.");
    }

    trendSeries = buildTrendSeriesFromRows(allRows);
    trendLabels = trendSeries.map((point) => String(point.year));
    trendValues = trendSeries.map((point) => point.aboveShare);

    setupYearSelect(years);
    systemStatusEl.textContent = `Data loaded. Explore trends by year.`;
    initAffordabilityBot(allRows, trendSeries);
  } catch (error) {
    systemStatusEl.textContent = "Could not load affordability data. Please refresh and try again.";
    annotationEl.textContent = "If this continues, verify that datasets/processed.json exists and contains valid rows.";
    console.error(error);
  }
}

init();
