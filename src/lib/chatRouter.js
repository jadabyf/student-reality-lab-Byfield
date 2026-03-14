/**
 * chatRouter.js
 * Routes natural-language chat messages to the correct affordability tool
 * and formats a student-friendly response for the browser chat UI.
 *
 * The project now also exposes the same tool layer through its MCP server.
 */

import {
  tool_getCityAffordability,
  tool_calculateRentBurden,
  tool_compareCities,
  tool_rentStressTrend,
  tool_postGradSurvivalScore,
  tool_findAffordableCities,
  tool_budgetLeftover,
  lookupCityRecord,
} from "./affordabilityTools.js";

// ── Parsing ───────────────────────────────────────────────────────────────

function toNum(str, hasK) {
  const n = parseFloat(str.replace(/,/g, ""));
  return hasK ? n * 1000 : n;
}

/**
 * Extract income, monthly rent, and up to two city names from free text.
 * City matching is case-insensitive; longer city names are tried first so
 * "New York" matches before a hypothetical plain "York".
 */
export function parseMessage(text, cityNames) {
  const lower = text.toLowerCase().trim();

  // Collect up to 2 city matches (longest first) for compare support
  const sorted = [...cityNames].sort((a, b) => b.length - a.length);
  const cities = [];
  for (const c of sorted) {
    if (lower.includes(c.toLowerCase())) {
      cities.push(c);
      if (cities.length === 2) break;
    }
  }

  // Income: keyword-anchored patterns in priority order
  let income = null;
  const incomePatterns = [
    /(?:make|earn|making|earning|salary(?:\s+of)?|income(?:\s+of)?)\s+\$?([\d,]+(?:\.\d+)?)\s*(k)?\b/,
    /\bon\s+\$?([\d,]+(?:\.\d+)?)\s*(k)?\b/,
    /\bwith\s+(?:a\s+)?\$?([\d,]+(?:\.\d+)?)\s*(k)?\b/,
    /\$?([\d,]+(?:\.\d+)?)\s*(k)?\s+(?:salary|income|a year|per year|annually)\b/,
  ];
  for (const re of incomePatterns) {
    const m = lower.match(re);
    if (m) {
      const v = toNum(m[1], m[2] === "k");
      if (v >= 1000) {
        income = v;
        break;
      }
    }
  }

  // Monthly rent: adjacent to rent-related keywords
  let rent = null;
  const rentMatch = lower.match(
    /(?:rent(?:\s+(?:is|of|at))?|paying(?:\s+rent)?)\s+\$?([\d,]+(?:\.\d+)?)\s*(k)?\b/,
  );
  if (rentMatch) {
    const v = toNum(rentMatch[1], rentMatch[2] === "k");
    if (v > 0) rent = v;
  }

  // Fallback income: first number in annual-income range not already captured as rent
  if (!income) {
    for (const m of lower.matchAll(/\$?([\d,]+(?:\.\d+)?)\s*(k)?\b/g)) {
      const v = toNum(m[1], m[2] === "k");
      if (v >= 15000 && v <= 500000 && v !== rent) {
        income = v;
        break;
      }
    }
  }

  return { income, rent, city: cities[0] ?? null, city2: cities[1] ?? null };
}

// ── Intent detection ──────────────────────────────────────────────────────

/**
 * Classify the user's intent so the router can pick the right tool.
 * Returns one of: "compare" | "find_cities" | "trend" | "survival_score" |
 * "budget_leftover" | "affordability" (default)
 */
export function detectIntent(text) {
  const t = text.toLowerCase();
  if (/\bcompare\b/.test(t) || /\bvs\.?\b/.test(t) || /\bversus\b/.test(t)) return "compare";
  if (/(?:find|what|which)\s+cit|affordable cit|recommend.*cit|cities.*afford|afford.*cities/.test(t))
    return "find_cities";
  if (/\btrend\b|\bgetting worse\b|\bover time\b|\bworsening\b|\bimproving\b|\bhistory\b/.test(t))
    return "trend";
  if (/\bsurvival score\b|\bsurvive\b|\bpost.?grad score\b|\bmy score\b/.test(t))
    return "survival_score";
  if (/\bleftover\b|\bleft after\b|\bafter rent\b|\bremaining\b|\bwhat.?s left\b|\budget after\b/.test(t))
    return "budget_leftover";
  return "affordability";
}

// ── Formatting helpers ────────────────────────────────────────────────────

function fmt(n) {
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtPct(n) {
  return `${n.toFixed(1)}%`;
}

function categoryNote(pct) {
  if (pct < 30)
    return "That is below the 30% affordability benchmark, which is a healthier range for most budgets.";
  if (pct < 40)
    return "That puts you above the 30% stress line, so your budget will feel tight — but it may be workable with some discipline.";
  if (pct < 50)
    return "That is well above the 30% benchmark and likely to create real financial pressure, leaving little room for savings or unexpected costs.";
  return "At that level, rent alone would consume more than half your income. Financial guidelines treat this as serious strain that is difficult to sustain independently.";
}

// ── Tool response builders ────────────────────────────────────────────────

function respondAffordability(parsed, rows) {
  const { income, rent, city } = parsed;
  if (!income) {
    return {
      text: "I didn\u2019t catch an income amount. Try something like \u201cI make 52000 and want to move to Atlanta\u201d or \u201cCan I afford New York on 68k?\u201d",
      category: null,
    };
  }

  if (rent && rent > 0) {
    const r = tool_calculateRentBurden(income, rent);
    return {
      text: `At ${fmt(rent)}/month rent on ${fmt(income)} annual income, your rent burden would be ${fmtPct(r.burdenPct)}. ${categoryNote(r.burdenPct)} That leaves roughly ${fmt(income / 12 - rent)}/month before other expenses.`,
      category: r.category,
      chart: { type: "gauge", title: "Your Estimated Rent Burden", value: parseFloat(r.burdenPct.toFixed(1)), benchmark: 30 },
    };
  }

  if (city) {
    const r = tool_getCityAffordability(city, income, rows);
    if (!r.ok) {
      return {
        text: `I couldn\u2019t find \u201c${city}\u201d in the dataset. Try another city, or include a monthly rent \u2014 for example, \u201cI make 52000 and my rent is 1500\u201d.`,
        category: null,
      };
    }
    return {
      text: `Based on ${r.city} rent data (${fmt(r.monthlyRent)}/month, ${r.year}), your rent burden at ${fmt(income)} income would be ${fmtPct(r.burdenPct)}. ${categoryNote(r.burdenPct)}`,
      category: r.category,
      chart: { type: "gauge", title: `${r.city} Rent Burden`, value: parseFloat(r.burdenPct.toFixed(1)), benchmark: 30 },
    };
  }

  return {
    text: "I have your income, but I need a city or a monthly rent to estimate your burden. Try adding a city or something like \u201cmy rent is 1500\u201d.",
    category: null,
  };
}

function respondCompare(parsed, rows) {
  const { income, city, city2 } = parsed;
  if (!income)
    return {
      text: "I need an income to compare cities. Try \u201cCompare Dallas and LA on 60k\u201d.",
      category: null,
    };
  if (!city || !city2)
    return {
      text: "I need two city names to compare. Try \u201cCompare Dallas and Los Angeles on 60k\u201d.",
      category: null,
    };

  const r = tool_compareCities(city, city2, income, rows);
  if (!r.a.ok)
    return {
      text: `I couldn\u2019t find \u201c${city}\u201d in the dataset. Try a different city name.`,
      category: null,
    };
  if (!r.b.ok)
    return {
      text: `I couldn\u2019t find \u201c${city2}\u201d in the dataset. Try a different city name.`,
      category: null,
    };

  const winner = r.a.burdenPct <= r.b.burdenPct ? r.a : r.b;
  const loser = winner === r.a ? r.b : r.a;
  const diff = Math.abs(r.a.burdenPct - r.b.burdenPct).toFixed(1);

  return {
    text: `Comparing ${r.a.city} and ${r.b.city} at ${fmt(income)} income:\n\u2022 ${r.a.city}: ${fmtPct(r.a.burdenPct)} \u2014 ${r.a.category.label}\n\u2022 ${r.b.city}: ${fmtPct(r.b.burdenPct)} \u2014 ${r.b.category.label}\n\n${winner.city} is more affordable, with a ${diff}-point lower rent burden than ${loser.city}.`,
    category: null,
    chart: {
      type: "bar",
      title: `Rent Burden at ${fmt(income)} Income`,
      labels: [r.a.city, r.b.city],
      values: [parseFloat(r.a.burdenPct.toFixed(1)), parseFloat(r.b.burdenPct.toFixed(1))],
      benchmark: 30,
    },
  };
}

function respondFindCities(parsed, rows) {
  const { income } = parsed;
  if (!income)
    return {
      text: "Please include your income. Try \u201cFind cities I can afford on 55k\u201d.",
      category: null,
    };

  const r = tool_findAffordableCities(income, rows);
  const top = r.affordable.slice(0, 6);

  if (top.length === 0) {
    return {
      text: `At ${fmt(income)} income, none of the tracked cities fall below the 30% affordability benchmark in ${r.year} data. Shared housing or a higher income target would help significantly.`,
      category: null,
    };
  }

  const list = top.map((c) => `${c.city} (${fmtPct(c.burdenPct)})`).join(", ");
  return {
    text: `Based on ${r.year} data, ${r.affordable.length} tracked cities fall below the 30% benchmark at ${fmt(income)} income. Most affordable: ${list}.`,
    category: null,
    chart: {
      type: "hbar",
      title: `Most Affordable at ${fmt(income)}`,
      labels: top.map((c) => c.city),
      values: top.map((c) => parseFloat(c.burdenPct.toFixed(1))),
      benchmark: 30,
    },
  };
}

function respondTrend(trendSeries) {
  const r = tool_rentStressTrend(trendSeries);
  if (!r)
    return {
      text: "Trend data is not yet loaded. Please refresh and try again.",
      category: null,
    };

  const dir =
    r.delta > 1 ? "risen" : r.delta < -1 ? "fallen" : "stayed roughly the same";
  const dirDetail =
    r.delta > 1
      ? "Rent stress appears to be spreading to more cities over time."
      : r.delta < -1
        ? "There are signs of improvement, though many cities remain above the threshold."
        : "The overall pattern has been fairly stable across years.";

  return {
    text: `In ${r.first.year}, ${fmtPct(r.first.aboveShare)} of tracked cities were above the 30% stress line. By ${r.last.year} that share has ${dir} to ${fmtPct(r.last.aboveShare)} \u2014 a ${Math.abs(r.delta).toFixed(1)}-point ${r.delta >= 0 ? "increase" : "decrease"}. ${dirDetail}`,
    category: null,
    chart: {
      type: "line",
      title: "Cities Above 30% Threshold (%)",
      labels: r.series.map((p) => String(p.year)),
      values: r.series.map((p) => p.aboveShare),
    },
  };
}

function respondSurvivalScore(parsed, rows) {
  const { income, rent, city } = parsed;
  if (!income)
    return {
      text: "I need your income for a survival score. Try \u201cWhat\u2019s my survival score in Chicago on 65k?\u201d",
      category: null,
    };

  let monthlyRent = rent && rent > 0 ? rent : null;
  let source = monthlyRent ? `${fmt(monthlyRent)}/month manual rent` : null;

  if (!monthlyRent && city) {
    const record = lookupCityRecord(city, rows);
    if (!record)
      return {
        text: `I couldn\u2019t find \u201c${city}\u201d in the dataset. Try another city or include a rent amount.`,
        category: null,
      };
    monthlyRent = record.monthly_rent;
    source = `${record.city} data (${fmt(monthlyRent)}/month)`;
  }

  if (!monthlyRent)
    return {
      text: "I need a city or monthly rent for a survival score. Try \u201csurvival score Chicago 65k\u201d.",
      category: null,
    };

  const r = tool_postGradSurvivalScore(income, monthlyRent);
  return {
    text: `Post-grad survival score: ${r.score}/100. Based on ${source}, your rent burden at ${fmt(income)} income would be ${fmtPct(r.burdenPct)}. ${categoryNote(r.burdenPct)} The score reflects financial cushion \u2014 higher means more breathing room.`,
    category: r.category,
    chart: { type: "score", score: r.score, label: r.category.label, cls: r.category.cls },
  };
}

function respondBudgetLeftover(parsed, rows) {
  const { income, rent, city } = parsed;
  if (!income)
    return {
      text: "I need your income to estimate leftover budget. Try \u201cI make 48k and rent is 1500\u201d.",
      category: null,
    };

  let monthlyRent = rent && rent > 0 ? rent : null;
  let source = monthlyRent ? `${fmt(monthlyRent)}/month` : null;

  if (!monthlyRent && city) {
    const record = lookupCityRecord(city, rows);
    if (record) {
      monthlyRent = record.monthly_rent;
      source = `${record.city} rent data (${fmt(monthlyRent)}/month)`;
    }
  }

  if (!monthlyRent)
    return {
      text: "I need a city or monthly rent. Try \u201cI make 48k and my rent is 1500\u201d.",
      category: null,
    };

  const r = tool_budgetLeftover(income, monthlyRent);
  const left = Math.round(r.monthlyLeftover);
  const sign = left < 0 ? "a shortfall of " : "about ";
  const tail =
    r.monthlyLeftover < 0
      ? "Rent would exceed your income \u2014 not a sustainable situation on a single income."
      : r.monthlyLeftover < 500
        ? "That\u2019s a very tight cushion \u2014 unexpected costs or variable expenses could create real stress."
        : "That gives you some room for other essentials, though expenses add up quickly.";

  return {
    text: `At ${source} rent on ${fmt(income)} annual income, rent takes ${fmt(r.annualRent)}/year (${fmtPct(r.burdenPct)} of income). That leaves ${sign}${fmt(Math.abs(r.monthlyLeftover))}/month before food, utilities, transportation, and loan payments. ${tail}`,
    category: null,
  };
}

// ── Main router ───────────────────────────────────────────────────────────

/**
 * Route a raw chat message to the correct tool and return { text, category }.
 * @param {string} text - user's raw input
 * @param {object[]} rows - full dataset (processed.json)
 * @param {object[]} trendSeries - trend series computed by the main chart init
 */
export function routeMessage(text, rows, trendSeries) {
  const cityNames = [...new Set(rows.map((r) => r.city))];
  const parsed = parseMessage(text, cityNames);
  const intent = detectIntent(text);

  switch (intent) {
    case "compare":
      return respondCompare(parsed, rows);
    case "find_cities":
      return respondFindCities(parsed, rows);
    case "trend":
      return respondTrend(trendSeries);
    case "survival_score":
      return respondSurvivalScore(parsed, rows);
    case "budget_leftover":
      return respondBudgetLeftover(parsed, rows);
    default:
      return respondAffordability(parsed, rows);
  }
}
