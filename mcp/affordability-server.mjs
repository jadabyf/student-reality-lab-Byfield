#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  AFFORDABILITY_THRESHOLD,
  tool_budgetLeftover,
  tool_calculateRentBurden,
  tool_compareCities,
  tool_findAffordableCities,
  tool_getCityAffordability,
  tool_postGradSurvivalScore,
  tool_rentStressTrend,
  lookupCityRecord,
} from "../src/lib/affordabilityTools.js";
import { loadRows, loadTrendSeries } from "../server/affordabilityService.js";

function fmtCurrency(value) {
  return `$${Math.round(value).toLocaleString()}`;
}

function fmtPercent(value) {
  return `${value.toFixed(1)}%`;
}

function categoryExplanation(burdenPct) {
  if (burdenPct < 30) {
    return "That is below the 30% affordability benchmark, which suggests housing costs may be more manageable.";
  }
  if (burdenPct < 40) {
    return "That is above the 30% benchmark, so the budget looks tight but still potentially workable.";
  }
  if (burdenPct < 50) {
    return "That is well above the 30% benchmark and likely to create real financial pressure.";
  }
  return "That level is generally treated as severe rent strain and would be difficult to sustain independently.";
}

function textResult(text, structuredContent) {
  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
}

const server = new McpServer({
  name: "student-reality-lab-affordability",
  version: "1.0.0",
});

server.tool(
  "get_city_affordability",
  {
    city: z.string().min(1),
    annualIncome: z.number().positive(),
  },
  async ({ city, annualIncome }) => {
    const rows = await loadRows();
    const result = tool_getCityAffordability(city, annualIncome, rows);

    if (!result.ok) {
      return textResult(
        `I could not find ${city} in the dataset. Try another city or use calculate_rent_burden with a monthly rent estimate.`,
        { ok: false, city },
      );
    }

    return textResult(
      `${result.city} uses ${fmtCurrency(result.monthlyRent)}/month rent from ${result.year} data. At ${fmtCurrency(result.income)} annual income, the estimated rent burden is ${fmtPercent(result.burdenPct)}. Category: ${result.category.label}. ${categoryExplanation(result.burdenPct)}`,
      result,
    );
  },
);

server.tool(
  "calculate_rent_burden",
  {
    annualIncome: z.number().positive(),
    monthlyRent: z.number().positive(),
  },
  async ({ annualIncome, monthlyRent }) => {
    const result = tool_calculateRentBurden(annualIncome, monthlyRent);
    return textResult(
      `With ${fmtCurrency(monthlyRent)}/month rent on ${fmtCurrency(annualIncome)} annual income, the estimated rent burden is ${fmtPercent(result.burdenPct)}. Category: ${result.category.label}. ${categoryExplanation(result.burdenPct)}`,
      result,
    );
  },
);

server.tool(
  "compare_cities",
  {
    city1: z.string().min(1),
    city2: z.string().min(1),
    annualIncome: z.number().positive(),
  },
  async ({ city1, city2, annualIncome }) => {
    const rows = await loadRows();
    const result = tool_compareCities(city1, city2, annualIncome, rows);

    if (!result.a.ok || !result.b.ok) {
      const missing = !result.a.ok ? city1 : city2;
      return textResult(
        `I could not find ${missing} in the dataset. Try a different city name.`,
        { ok: false, missingCity: missing },
      );
    }

    const winner = result.a.burdenPct <= result.b.burdenPct ? result.a : result.b;
    const loser = winner === result.a ? result.b : result.a;
    const diff = Math.abs(result.a.burdenPct - result.b.burdenPct).toFixed(1);

    return textResult(
      `${winner.city} is more manageable at ${fmtCurrency(annualIncome)} income. ${result.a.city}: ${fmtPercent(result.a.burdenPct)} (${result.a.category.label}); ${result.b.city}: ${fmtPercent(result.b.burdenPct)} (${result.b.category.label}). Difference: ${diff} points.`,
      {
        ok: true,
        income: annualIncome,
        city1: result.a,
        city2: result.b,
        moreManageableCity: winner.city,
        burdenDifference: Number(diff),
      },
    );
  },
);

server.tool(
  "rent_stress_trend",
  {},
  async () => {
    const trendSeries = await loadTrendSeries();
    const result = tool_rentStressTrend(trendSeries);

    if (!result) {
      return textResult("Trend data is unavailable.", { ok: false });
    }

    const direction = result.delta > 0 ? "worse" : result.delta < 0 ? "better" : "flat";

    return textResult(
      `The share of cities above the ${AFFORDABILITY_THRESHOLD}% rent-stress threshold moved from ${fmtPercent(result.first.aboveShare)} in ${result.first.year} to ${fmtPercent(result.last.aboveShare)} in ${result.last.year}. Overall direction: ${direction}.`,
      {
        ok: true,
        first: result.first,
        last: result.last,
        delta: result.delta,
        direction,
        series: result.series,
      },
    );
  },
);

server.tool(
  "post_grad_survival_score",
  {
    annualIncome: z.number().positive(),
    city: z.string().min(1).optional(),
    monthlyRent: z.number().positive().optional(),
  },
  async ({ annualIncome, city, monthlyRent }) => {
    const rows = await loadRows();
    let resolvedMonthlyRent = monthlyRent ?? null;
    let source = null;

    if (!resolvedMonthlyRent && city) {
      const record = lookupCityRecord(city, rows);
      if (!record) {
        return textResult(
          `I could not find ${city} in the dataset. Try another city or provide monthlyRent directly.`,
          { ok: false, city },
        );
      }
      resolvedMonthlyRent = record.monthly_rent;
      source = `${record.city} ${record.year} data`;
    }

    if (!resolvedMonthlyRent) {
      return textResult(
        "Please provide either a city or a monthlyRent value.",
        { ok: false, reason: "missing city and monthlyRent" },
      );
    }

    const result = tool_postGradSurvivalScore(annualIncome, resolvedMonthlyRent);
    return textResult(
      `Survival score: ${result.score}/100. Using ${source ?? "manual rent"} at ${fmtCurrency(resolvedMonthlyRent)}/month, the estimated rent burden is ${fmtPercent(result.burdenPct)}. Category: ${result.category.label}.`,
      {
        ...result,
        source: source ?? "manual rent",
      },
    );
  },
);

server.tool(
  "find_affordable_cities",
  {
    annualIncome: z.number().positive(),
    threshold: z.number().positive().max(100).default(AFFORDABILITY_THRESHOLD),
  },
  async ({ annualIncome, threshold }) => {
    const rows = await loadRows();
    const result = tool_findAffordableCities(annualIncome, rows, threshold);
    const top = result.affordable.slice(0, 10).map((row) => ({
      city: row.city,
      burdenPct: Number(row.burdenPct.toFixed(1)),
      monthlyRent: row.monthly_rent,
    }));

    return textResult(
      `${result.affordable.length} cities fall below ${threshold}% at ${fmtCurrency(annualIncome)} income using ${result.year} data. Top matches: ${top.map((row) => `${row.city} (${fmtPercent(row.burdenPct)})`).join(", ") || "none"}.`,
      {
        ok: true,
        income: annualIncome,
        threshold,
        year: result.year,
        matches: top,
        matchCount: result.affordable.length,
      },
    );
  },
);

server.tool(
  "budget_leftover",
  {
    annualIncome: z.number().positive(),
    city: z.string().min(1).optional(),
    monthlyRent: z.number().positive().optional(),
  },
  async ({ annualIncome, city, monthlyRent }) => {
    const rows = await loadRows();
    let resolvedMonthlyRent = monthlyRent ?? null;
    let source = null;

    if (!resolvedMonthlyRent && city) {
      const record = lookupCityRecord(city, rows);
      if (!record) {
        return textResult(
          `I could not find ${city} in the dataset. Try another city or provide monthlyRent directly.`,
          { ok: false, city },
        );
      }
      resolvedMonthlyRent = record.monthly_rent;
      source = `${record.city} ${record.year} data`;
    }

    if (!resolvedMonthlyRent) {
      return textResult(
        "Please provide either a city or a monthlyRent value.",
        { ok: false, reason: "missing city and monthlyRent" },
      );
    }

    const result = tool_budgetLeftover(annualIncome, resolvedMonthlyRent);
    return textResult(
      `Annual rent would be ${fmtCurrency(result.annualRent)}. Monthly leftover before other expenses would be ${fmtCurrency(result.monthlyLeftover)} using ${source ?? "manual rent"}.`,
      {
        ...result,
        source: source ?? "manual rent",
      },
    );
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
