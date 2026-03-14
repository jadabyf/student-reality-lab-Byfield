/**
 * affordabilityTools.js
 * Shared affordability tool functions used by both the browser chatbot
 * and the project-scoped MCP server.
 */

export const AFFORDABILITY_THRESHOLD = 30;

// ── Helpers ───────────────────────────────────────────────────────────────

export function getBurdenCategory(pct) {
  if (pct < 30) return { label: "Likely manageable", cls: "chat-rating--manageable" };
  if (pct < 40) return { label: "Tight but possible", cls: "chat-rating--tight" };
  if (pct < 50) return { label: "Financially stressful", cls: "chat-rating--stressful" };
  return { label: "High risk", cls: "chat-rating--high-risk" };
}

export function calcBurdenPct(monthlyRent, annualIncome) {
  return ((monthlyRent * 12) / annualIncome) * 100;
}

/** Build the year-level trend series used by both the chart and MCP tool. */
export function buildTrendSeriesFromRows(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    if (!grouped.has(row.year)) {
      grouped.set(row.year, []);
    }
    grouped.get(row.year).push(row);
  });

  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, yearRows]) => {
      const aboveCount = yearRows.filter((row) => row.rent_burden * 100 >= AFFORDABILITY_THRESHOLD).length;
      const total = yearRows.length;
      const aboveShare = total > 0 ? (aboveCount / total) * 100 : 0;
      return {
        year,
        aboveCount,
        total,
        aboveShare: Number(aboveShare.toFixed(1)),
      };
    });
}

/** Maps rent burden to a 0–100 survival score (higher = more comfortable). */
export function calcSurvivalScore(burdenPct) {
  return Math.max(0, Math.min(100, Math.round(100 - burdenPct * 1.25)));
}

/** Returns the most recent dataset row for a given city name (case-insensitive). */
export function lookupCityRecord(city, rows) {
  const lower = city.toLowerCase();
  const latestYear = Math.max(...rows.map((r) => r.year));
  return (
    rows.find((r) => r.city.toLowerCase() === lower && r.year === latestYear) ??
    rows.filter((r) => r.city.toLowerCase() === lower).sort((a, b) => b.year - a.year)[0] ??
    null
  );
}

// ── Tool 1 · get_city_affordability ───────────────────────────────────────
/**
 * Given a city name and annual income, return estimated rent burden and category.
 * Uses the most recent year available in the dataset for that city.
 */
export function tool_getCityAffordability(city, income, rows) {
  const record = lookupCityRecord(city, rows);
  if (!record) return { ok: false, city };
  const burdenPct = calcBurdenPct(record.monthly_rent, income);
  return {
    ok: true,
    city: record.city,
    year: record.year,
    monthlyRent: record.monthly_rent,
    income,
    burdenPct,
    category: getBurdenCategory(burdenPct),
  };
}

// ── Tool 2 · calculate_rent_burden ────────────────────────────────────────
/** Given income and a manually entered monthly rent, calculate affordability directly. */
export function tool_calculateRentBurden(income, monthlyRent) {
  const burdenPct = calcBurdenPct(monthlyRent, income);
  return {
    ok: true,
    income,
    monthlyRent,
    burdenPct,
    category: getBurdenCategory(burdenPct),
  };
}

// ── Tool 3 · compare_cities ───────────────────────────────────────────────
/** Compare two cities side-by-side on the same income. */
export function tool_compareCities(city1, city2, income, rows) {
  return {
    a: tool_getCityAffordability(city1, income, rows),
    b: tool_getCityAffordability(city2, income, rows),
    income,
  };
}

// ── Tool 4 · rent_stress_trend ────────────────────────────────────────────
/**
 * Summarise the direction of rent stress over time using the trendSeries
 * already computed by the main chart initialization.
 */
export function tool_rentStressTrend(trendSeries) {
  if (!trendSeries || trendSeries.length === 0) return null;
  const first = trendSeries[0];
  const last = trendSeries[trendSeries.length - 1];
  const delta = last.aboveShare - first.aboveShare;
  return { first, last, delta, series: trendSeries };
}

// ── Tool 5 · post_grad_survival_score ─────────────────────────────────────
/** Generate a 0–100 survival score and affordability category. */
export function tool_postGradSurvivalScore(income, monthlyRent) {
  const burdenPct = calcBurdenPct(monthlyRent, income);
  const score = calcSurvivalScore(burdenPct);
  return {
    ok: true,
    income,
    monthlyRent,
    burdenPct,
    score,
    category: getBurdenCategory(burdenPct),
  };
}

// ── Tool 6 · find_affordable_cities ──────────────────────────────────────
/** Return all cities in the dataset below a given rent burden threshold. */
export function tool_findAffordableCities(income, rows, threshold = AFFORDABILITY_THRESHOLD) {
  const latestYear = Math.max(...rows.map((r) => r.year));
  const affordable = rows
    .filter((r) => r.year === latestYear)
    .map((r) => ({ ...r, burdenPct: calcBurdenPct(r.monthly_rent, income) }))
    .filter((r) => r.burdenPct < threshold)
    .sort((a, b) => a.burdenPct - b.burdenPct);
  return { ok: true, affordable, income, threshold, year: latestYear };
}

// ── Tool 7 · budget_leftover ──────────────────────────────────────────────
/** Estimate how much income remains after paying rent each month. */
export function tool_budgetLeftover(income, monthlyRent) {
  const annualRent = monthlyRent * 12;
  const annualLeftover = income - annualRent;
  const monthlyLeftover = annualLeftover / 12;
  const burdenPct = calcBurdenPct(monthlyRent, income);
  return {
    ok: true,
    income,
    monthlyRent,
    annualRent,
    annualLeftover,
    monthlyLeftover,
    burdenPct,
  };
}
