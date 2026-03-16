import {
  AFFORDABILITY_THRESHOLD,
  calcBurdenPct,
  resolveCityRecord,
} from "./affordabilityTools.js";

function latestYear(rows) {
  return Math.max(...rows.map((row) => row.year));
}

export function retrieveCityContext(city, annualIncome, rows) {
  const resolved = resolveCityRecord(city, rows);

  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      city,
      matches: resolved.matches ?? [],
      suggestions: resolved.suggestions ?? [],
    };
  }

  const record = resolved.record;

  const burdenPct = calcBurdenPct(record.monthly_rent, annualIncome);

  return {
    ok: true,
    city: record.city,
    year: record.year,
    monthlyRent: record.monthly_rent,
    annualIncome,
    burdenPct,
    threshold: AFFORDABILITY_THRESHOLD,
    resolutionStrategy: resolved.strategy,
  };
}

export function retrieveCompareContext(city1, city2, annualIncome, rows) {
  const a = retrieveCityContext(city1, annualIncome, rows);
  const b = retrieveCityContext(city2, annualIncome, rows);

  return {
    ok: a.ok && b.ok,
    a,
    b,
    annualIncome,
    threshold: AFFORDABILITY_THRESHOLD,
  };
}

export function retrieveTrendContext(trendSeries) {
  if (!Array.isArray(trendSeries) || trendSeries.length === 0) {
    return { ok: false, reason: "trend_missing" };
  }

  const first = trendSeries[0];
  const last = trendSeries[trendSeries.length - 1];
  const delta = Number((last.aboveShare - first.aboveShare).toFixed(1));

  return {
    ok: true,
    first,
    last,
    delta,
    threshold: AFFORDABILITY_THRESHOLD,
    series: trendSeries,
  };
}

export function retrieveAffordableCitiesContext(annualIncome, rows, threshold = AFFORDABILITY_THRESHOLD) {
  const year = latestYear(rows);

  const affordable = rows
    .filter((row) => row.year === year)
    .map((row) => ({
      city: row.city,
      monthlyRent: row.monthly_rent,
      burdenPct: calcBurdenPct(row.monthly_rent, annualIncome),
    }))
    .filter((row) => row.burdenPct < threshold)
    .sort((a, b) => a.burdenPct - b.burdenPct);

  return {
    ok: true,
    annualIncome,
    year,
    threshold,
    affordable,
  };
}

export function retrieveManualRentContext(annualIncome, monthlyRent) {
  const burdenPct = calcBurdenPct(monthlyRent, annualIncome);

  return {
    ok: true,
    annualIncome,
    monthlyRent,
    burdenPct,
    threshold: AFFORDABILITY_THRESHOLD,
  };
}
