import "./styles.css";
import { buildTrendSeriesFromRows } from "./lib/affordabilityTools.js";
import { resolveBaseUrl } from "./lib/runtimeBase.js";
import { initAffordabilityChatbot } from "./components/AffordabilityChatbot.js";
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

const BASE_URL = resolveBaseUrl();
const DATASET_PATH = `${BASE_URL}datasets/processed.json`;
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
const runtimeWarningEl = document.getElementById("runtime-warning");

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

function showRuntimeWarning(message) {
  if (!runtimeWarningEl) {
    return;
  }

  runtimeWarningEl.hidden = false;
  runtimeWarningEl.classList.add("runtime-warning--visible");
  runtimeWarningEl.textContent = message;
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
    initAffordabilityChatbot(allRows, trendSeries);
  } catch (error) {
    systemStatusEl.textContent = "Could not load affordability data. Please refresh and try again.";
    annotationEl.textContent = "If this continues, verify that datasets/processed.json exists and contains valid rows.";
    showRuntimeWarning(
      "Runtime data failed to load. On GitHub Pages, set Pages Source to GitHub Actions and redeploy so the built dist assets and datasets are published.",
    );
    console.error(error);
  }
}

init();
