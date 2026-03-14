import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AFFORDABILITY_THRESHOLD,
  buildTrendSeriesFromRows,
  lookupCityRecord,
  tool_budgetLeftover,
  tool_calculateRentBurden,
  tool_compareCities,
  tool_findAffordableCities,
  tool_getCityAffordability,
  tool_postGradSurvivalScore,
  tool_rentStressTrend,
} from "../src/lib/affordabilityTools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const datasetPath = path.resolve(__dirname, "../datasets/processed.json");

let cachedRows = null;
let cachedTrendSeries = null;

function toPositiveNumber(value, fieldName) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }

  return parsedValue;
}

function toOptionalPositiveNumber(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return toPositiveNumber(value, fieldName);
}

function toRequiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim();
}

function toOptionalString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function resolveRentInput(input, rows) {
  const monthlyRent = toOptionalPositiveNumber(input.monthlyRent, "monthlyRent");
  const city = toOptionalString(input.city);

  if (monthlyRent) {
    return {
      monthlyRent,
      source: "manual rent",
    };
  }

  if (!city) {
    throw new Error("Provide either city or monthlyRent.");
  }

  const record = lookupCityRecord(city, rows);

  if (!record) {
    return {
      ok: false,
      error: `Could not find ${city} in the dataset.`,
    };
  }

  return {
    ok: true,
    monthlyRent: record.monthly_rent,
    source: `${record.city} ${record.year} data`,
  };
}

export async function loadRows() {
  if (cachedRows) {
    return cachedRows;
  }

  const raw = await readFile(datasetPath, "utf8");
  cachedRows = JSON.parse(raw);
  cachedTrendSeries = buildTrendSeriesFromRows(cachedRows);
  return cachedRows;
}

export async function loadTrendSeries() {
  if (cachedTrendSeries) {
    return cachedTrendSeries;
  }

  await loadRows();
  return cachedTrendSeries;
}

export async function invokeAffordabilityTool(toolName, input = {}) {
  switch (toolName) {
    case "get_city_affordability": {
      const rows = await loadRows();
      return tool_getCityAffordability(
        toRequiredString(input.city, "city"),
        toPositiveNumber(input.annualIncome, "annualIncome"),
        rows,
      );
    }

    case "calculate_rent_burden":
      return tool_calculateRentBurden(
        toPositiveNumber(input.annualIncome, "annualIncome"),
        toPositiveNumber(input.monthlyRent, "monthlyRent"),
      );

    case "compare_cities": {
      const rows = await loadRows();
      return tool_compareCities(
        toRequiredString(input.city1, "city1"),
        toRequiredString(input.city2, "city2"),
        toPositiveNumber(input.annualIncome, "annualIncome"),
        rows,
      );
    }

    case "rent_stress_trend": {
      const trendSeries = await loadTrendSeries();
      return tool_rentStressTrend(trendSeries);
    }

    case "post_grad_survival_score": {
      const rows = await loadRows();
      const income = toPositiveNumber(input.annualIncome, "annualIncome");
      const rentInfo = resolveRentInput(input, rows);

      if (rentInfo.ok === false) {
        return rentInfo;
      }

      return {
        ...tool_postGradSurvivalScore(income, rentInfo.monthlyRent),
        source: rentInfo.source,
      };
    }

    case "find_affordable_cities": {
      const rows = await loadRows();
      const threshold = input.threshold === undefined
        ? AFFORDABILITY_THRESHOLD
        : toPositiveNumber(input.threshold, "threshold");

      return tool_findAffordableCities(
        toPositiveNumber(input.annualIncome, "annualIncome"),
        rows,
        threshold,
      );
    }

    case "budget_leftover": {
      const rows = await loadRows();
      const income = toPositiveNumber(input.annualIncome, "annualIncome");
      const rentInfo = resolveRentInput(input, rows);

      if (rentInfo.ok === false) {
        return rentInfo;
      }

      return {
        ...tool_budgetLeftover(income, rentInfo.monthlyRent),
        source: rentInfo.source,
      };
    }

    default:
      throw new Error(`Unsupported tool: ${toolName}`);
  }
}