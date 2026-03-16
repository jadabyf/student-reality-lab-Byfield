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
  resolveCityRecord,
  AFFORDABILITY_THRESHOLD,
} from "./affordabilityTools.js";
import { detectIntent, parseMessage } from "./promptParser.js";
import {
  retrieveAffordableCitiesContext,
  retrieveCityContext,
  retrieveCompareContext,
  retrieveManualRentContext,
  retrieveTrendContext,
} from "./retrieval.js";

// ── Formatting helpers ────────────────────────────────────────────────────

function fmt(n) {
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtPct(n) {
  return `${n.toFixed(1)}%`;
}

const CITY_LIST_PAGE_SIZE = 20;
let cityListCursor = 0;
let cityListHistory = [];
const CITY_LIST_ALL_MAX = 120;

function getDatasetStats(rows) {
  const cities = [...new Set(rows.map((row) => row.city))].sort();
  const years = [...new Set(rows.map((row) => row.year))].sort((a, b) => a - b);
  return {
    cities,
    cityCount: cities.length,
    minYear: years[0],
    maxYear: years[years.length - 1],
  };
}

function formatWhyItMatters(pct) {
  if (pct < 30) {
    return "For a recent graduate, this leaves more room for savings, emergencies, and student loan payments.";
  }
  if (pct < 40) {
    return "For a young adult budget, this usually means careful tradeoffs on transportation, food, and discretionary spending.";
  }
  if (pct < 50) {
    return "For most post-grad budgets, this level of rent pressure increases financial risk and makes setbacks harder to absorb.";
  }
  return "For students and early-career workers, this is typically not sustainable without roommates, subsidies, or a higher income.";
}

function categoryNote(pct) {
  if (pct < AFFORDABILITY_THRESHOLD)
    return `That is below the ${AFFORDABILITY_THRESHOLD}% affordability benchmark, which is a healthier range for most budgets.`;
  if (pct < 40)
    return `That puts you above the ${AFFORDABILITY_THRESHOLD}% stress line, so your budget will feel tight, but it may be workable with strong discipline.`;
  if (pct < 50)
    return `That is well above the ${AFFORDABILITY_THRESHOLD}% benchmark and likely to create real financial pressure, leaving little room for savings or unexpected costs.`;
  return "At that level, rent alone would consume more than half your income. Financial guidelines treat this as serious strain that is difficult to sustain independently.";
}

function respondDatasetOverview(rows) {
  const stats = getDatasetStats(rows);
  const sample = stats.cities.slice(0, 16).join(", ");

  return {
    text: `I use a combined housing affordability dataset built from Zillow rent data and U.S. Census ACS income data.

Current coverage in this app:
- ${stats.cityCount} cities
- Years ${stats.minYear} to ${stats.maxYear}
- Fields: city, year, monthly_rent, median_income, rent_burden

Sample cities I can check: ${sample}.

If you want, I can also check whether a specific city is available.`,
    category: null,
    meta: {
      tool: "explain_dataset",
    },
  };
}

function respondListDatasetCities(rows, mode = "start") {
  const stats = getDatasetStats(rows);

  if (mode === "start") {
    cityListCursor = 0;
    cityListHistory = [];
  }

  if (mode === "next" && cityListCursor > 0) {
    cityListHistory.push(Math.max(0, cityListCursor - CITY_LIST_PAGE_SIZE));
  }

  if (mode === "previous") {
    if (cityListHistory.length === 0) {
      cityListCursor = 0;
    } else {
      cityListCursor = cityListHistory.pop();
    }
  }

  const start = cityListCursor;
  const end = Math.min(start + CITY_LIST_PAGE_SIZE, stats.cityCount);
  const preview = stats.cities.slice(start, end).join(", ");
  cityListCursor = end >= stats.cityCount ? 0 : end;

  const hasNext = end < stats.cityCount;
  const hasPrev = start > 0 || cityListHistory.length > 0;
  const footerParts = [];

  if (hasNext) {
    footerParts.push(`Say "show more cities" to see the next ${CITY_LIST_PAGE_SIZE}.`);
  } else {
    footerParts.push("That was the end of the list. Ask again for cities to start from the top.");
  }

  if (hasPrev) {
    footerParts.push("You can also say " + '"show previous cities"' + " to go back.");
  }

  const footer = footerParts.join(" ");

  return {
    text: `I can look up ${stats.cityCount} cities in the current affordability dataset.

Cities ${start + 1}-${end}: ${preview}.

${footer}

If you want a specific one, ask like: "do you have Chicago?"`,
    category: null,
    meta: {
      tool: "list_dataset_cities",
    },
  };
}

function respondListCitiesByPrefix(parsed, rows) {
  const stats = getDatasetStats(rows);
  const prefix = parsed.cityPrefix;

  if (!prefix) {
    return {
      text: "I can do that. Ask like: show cities starting with C.",
      category: null,
      meta: {
        tool: "list_dataset_cities",
      },
    };
  }

  const matches = stats.cities.filter((city) => city.toLowerCase().startsWith(prefix));

  if (matches.length === 0) {
    return {
      text: `I do not have any tracked cities starting with ${prefix.toUpperCase()} in the current dataset.`,
      category: null,
      meta: {
        tool: "list_dataset_cities",
      },
    };
  }

  return {
    text: `I found ${matches.length} cities starting with ${prefix.toUpperCase()}.

${matches.join(", ")}`,
    category: null,
    meta: {
      tool: "list_dataset_cities",
    },
  };
}

function respondListAllCities(rows) {
  const stats = getDatasetStats(rows);
  const shown = stats.cities.slice(0, CITY_LIST_ALL_MAX);
  const hiddenCount = Math.max(0, stats.cityCount - shown.length);

  return {
    text: `I can check ${stats.cityCount} cities total. Here are the first ${shown.length} in alphabetical order:

${shown.join(", ")}

${hiddenCount > 0 ? `I did not print ${hiddenCount} more here to keep the response readable. Ask "show more cities" to continue paging, or "show cities starting with <letter>" to filter.` : "That is the full list."}`,
    category: null,
    meta: {
      tool: "list_dataset_cities",
    },
  };
}

function respondExplainModel() {
  return {
    text: `I calculate rent burden with this formula:

- rent_burden = (monthly_rent x 12) / annual_income

The 30% line is a common affordability benchmark. If rent is above 30% of income, budgets are usually considered financially tight.

In this app, I use that threshold to label affordability risk and compare cities consistently.`,
    category: null,
    meta: {
      tool: "explain_affordability_model",
    },
  };
}

function respondCityAvailability(parsed, rows) {
  if (!parsed.city) {
    return {
      text: "I can check that. Tell me a city name, for example: do you have Chicago?",
      category: null,
      meta: {
        tool: "check_city_exists",
      },
    };
  }

  const resolved = resolveCityRecord(parsed.city, rows);
  if (!resolved.ok) {
    const suggestions = (resolved.suggestions ?? []).slice(0, 4);
    const suggestionText = suggestions.length
      ? ` Closest matches I do have: ${suggestions.join(", ")}.`
      : "";

    return {
      text: `I do not currently have a rent record for ${parsed.city} in this dataset.${suggestionText}`,
      category: null,
      meta: {
        tool: "check_city_exists",
      },
    };
  }

  return {
    text: `Yes, I can check ${resolved.city}. If you want an affordability estimate, send your income too, for example: can I live in ${resolved.city} with 60000?`,
    category: null,
    meta: {
      tool: "check_city_exists",
    },
  };
}

function respondCitySnapshot(parsed, rows) {
  if (!parsed.city) {
    return {
      text: "I can check that. Tell me which city you mean, like: is Los Angeles expensive?",
      category: null,
      meta: {
        tool: "city_snapshot",
      },
    };
  }

  const resolved = resolveCityRecord(parsed.city, rows);
  if (!resolved.ok) {
    const suggestions = (resolved.suggestions ?? []).slice(0, 4);
    return {
      text: `I could not find ${parsed.city} in the rent dataset right now.${suggestions.length ? ` Closest matches: ${suggestions.join(", ")}.` : ""}`,
      category: null,
      meta: {
        tool: "city_snapshot",
      },
    };
  }

  const r = resolved.record;
  const pct = r.rent_burden * 100;
  const tone = pct >= 40 ? "quite expensive" : pct >= 30 ? "on the expensive side" : "relatively manageable";

  return {
    text: `${r.city} looks ${tone} in the latest dataset year (${r.year}).

- Typical monthly rent: ${fmt(r.monthly_rent)}
- Median income in dataset: ${fmt(r.median_income)}
- Rent burden at median income: ${fmtPct(pct)}

If you share your income, I can estimate your personal affordability there.`,
    category: null,
    meta: {
      tool: "city_snapshot",
    },
  };
}

// ── Tool response builders ────────────────────────────────────────────────

function respondAffordability(parsed, rows) {
  const { income, rent, city } = parsed;
  if (!income) {
    return {
      text: "I did not catch an annual income amount. Try something like: Can I live in Los Angeles with 60000?",
      category: null,
      meta: {
        tool: "get_city_affordability",
        explanationLevel: "thorough",
      },
    };
  }

  if (rent && rent > 0) {
    const context = retrieveManualRentContext(income, rent);
    const r = tool_calculateRentBurden(income, rent);
    const monthlyLeftover = income / 12 - rent;

    return {
      text: `Short answer: ${r.burdenPct < AFFORDABILITY_THRESHOLD ? "this looks manageable" : "this looks financially tight"} at your current numbers.

Dataset inputs used:
- Annual income: ${fmt(context.annualIncome)}
- Monthly rent: ${fmt(context.monthlyRent)}

Calculation:
- Annual rent = monthly rent x 12 = ${fmt(context.monthlyRent)} x 12 = ${fmt(context.monthlyRent * 12)}
- Rent burden = annual rent / annual income = ${fmt(context.monthlyRent * 12)} / ${fmt(context.annualIncome)} = ${fmtPct(context.burdenPct)}

Benchmark comparison:
- Your burden: ${fmtPct(context.burdenPct)}
- Affordability benchmark: ${AFFORDABILITY_THRESHOLD}%
- Result: ${categoryNote(context.burdenPct)}

Why this matters:
${formatWhyItMatters(context.burdenPct)}

Student-friendly takeaway:
After rent, you would have about ${fmt(monthlyLeftover)}/month left before utilities, food, transit, and debt payments.`,
      category: r.category,
      chart: { type: "gauge", title: "Your Estimated Rent Burden", value: parseFloat(r.burdenPct.toFixed(1)), benchmark: 30 },
      meta: {
        tool: "calculate_rent_burden",
        retrieval: "manual-rent",
      },
    };
  }

  if (city) {
    const context = retrieveCityContext(city, income, rows);
    const r = tool_getCityAffordability(city, income, rows);
    if (!r.ok) {
      if (context.reason === "ambiguous" && context.matches?.length) {
        return {
          text: `I found multiple close city matches for "${city}": ${context.matches.slice(0, 4).join(", ")}. Please include more detail, for example: "${context.matches[0]}, NY".`,
          category: null,
          meta: {
            tool: "get_city_affordability",
          },
        };
      }

      const suggestions = (context.suggestions ?? []).slice(0, 3);
      const suggestionText = suggestions.length
        ? ` Closest matches in the rent dataset: ${suggestions.join(", ")}.`
        : "";

      return {
        text: `I could not find a rent record for ${city} in the current dataset.${suggestionText} You can also include a monthly rent directly, for example: I make 52000 and my rent is 1500.`,
        category: null,
        meta: {
          tool: "get_city_affordability",
        },
      };
    }

    return {
      text: `Short answer: ${r.city} on ${fmt(income)} is ${r.burdenPct < AFFORDABILITY_THRESHOLD ? "potentially manageable" : "likely challenging"} for a solo post-grad budget.

Dataset rent assumption used:
- City: ${r.city}
- Year of record: ${r.year}
- Monthly rent from dataset: ${fmt(r.monthlyRent)}

Calculation:
- Annual rent = ${fmt(r.monthlyRent)} x 12 = ${fmt(r.monthlyRent * 12)}
- Rent burden = ${fmt(r.monthlyRent * 12)} / ${fmt(income)} = ${fmtPct(r.burdenPct)}

Benchmark comparison:
- Your burden in ${r.city}: ${fmtPct(r.burdenPct)}
- Benchmark: ${AFFORDABILITY_THRESHOLD}%
- Category: ${r.category.label}

Why this matters for a young adult:
${formatWhyItMatters(r.burdenPct)}

Clear conclusion:
${categoryNote(r.burdenPct)}`,
      category: r.category,
      chart: { type: "gauge", title: `${r.city} Rent Burden`, value: parseFloat(r.burdenPct.toFixed(1)), benchmark: 30 },
      meta: {
        tool: "get_city_affordability",
      },
    };
  }

  return {
    text: "I have your income, but I still need a city or monthly rent to estimate affordability. Example: Can I afford Atlanta on 52000?",
    category: null,
    meta: {
      tool: "get_city_affordability",
    },
  };
}

function respondCompare(parsed, rows) {
  const { income, city, city2 } = parsed;
  if (!income)
    return {
      text: "I need an income to compare cities. Try: Compare Dallas and Los Angeles on 60000.",
      category: null,
    };
  if (!city || !city2)
    return {
      text: "I need two city names to compare. Try: Compare Dallas and Los Angeles on 60000.",
      category: null,
    };

  const context = retrieveCompareContext(city, city2, income, rows);
  const r = tool_compareCities(city, city2, income, rows);
  if (!r.a.ok)
    return {
      text: `I could not find ${city} in the dataset. Try a different city name.`,
      category: null,
    };
  if (!r.b.ok)
    return {
      text: `I could not find ${city2} in the dataset. Try a different city name.`,
      category: null,
    };

  const winner = r.a.burdenPct <= r.b.burdenPct ? r.a : r.b;
  const loser = winner === r.a ? r.b : r.a;
  const diff = Math.abs(r.a.burdenPct - r.b.burdenPct).toFixed(1);

  return {
    text: `Direct answer: ${winner.city} is more manageable than ${loser.city} on ${fmt(income)}.

Dataset retrieval:
- ${r.a.city} monthly rent: ${fmt(r.a.monthlyRent)}
- ${r.b.city} monthly rent: ${fmt(r.b.monthlyRent)}

Comparison calculations:
- ${r.a.city}: ${fmtPct(r.a.burdenPct)} (${r.a.category.label})
- ${r.b.city}: ${fmtPct(r.b.burdenPct)} (${r.b.category.label})
- Difference: ${diff} percentage points

Benchmark perspective:
- Target benchmark: ${AFFORDABILITY_THRESHOLD}%
- ${winner.city} gives you relatively more room in your monthly budget.

Conclusion:
If these are your two options at the same income, ${winner.city} is the safer affordability choice.`,
    category: null,
    chart: {
      type: "bar",
      title: `Rent Burden at ${fmt(income)} Income`,
      labels: [r.a.city, r.b.city],
      values: [parseFloat(r.a.burdenPct.toFixed(1)), parseFloat(r.b.burdenPct.toFixed(1))],
      benchmark: 30,
    },
    meta: {
      tool: "compare_cities",
    },
  };
}

function respondFindCities(parsed, rows) {
  const { income } = parsed;
  if (!income)
    return {
      text: "Please include your income. Try: What cities can I afford on 55000?",
      category: null,
    };

  const context = retrieveAffordableCitiesContext(income, rows);
  const r = tool_findAffordableCities(income, rows);
  const top = r.affordable.slice(0, 6);

  if (top.length === 0) {
    return {
      text: `At ${fmt(income)} income, none of the tracked cities are below the ${AFFORDABILITY_THRESHOLD}% benchmark in ${r.year} data.

Why this result happens:
Rent levels in the latest dataset year stay high relative to this income level.

Student-friendly conclusion:
You would likely need roommates, lower-rent neighborhoods, or a higher income to stay below the affordability stress line.`,
      category: null,
      meta: {
        tool: "find_affordable_cities",
      },
    };
  }

  const list = top.map((c) => `${c.city} (${fmtPct(c.burdenPct)})`).join(", ");
  return {
    text: `Direct answer: On ${fmt(income)}, ${r.affordable.length} tracked cities are below the ${AFFORDABILITY_THRESHOLD}% benchmark in ${r.year} data.

Top affordable options:
${list}

How this was retrieved:
I filtered latest-year city records, recalculated rent burden at your income, then ranked by lowest burden.

Why this matters:
Cities lower on this chart generally leave more monthly breathing room for non-rent essentials and savings.`,
    category: null,
    chart: {
      type: "hbar",
      title: `Most Affordable at ${fmt(income)}`,
      labels: top.map((c) => c.city),
      values: top.map((c) => parseFloat(c.burdenPct.toFixed(1))),
      benchmark: 30,
    },
    meta: {
      tool: "find_affordable_cities",
    },
  };
}

function respondTrend(trendSeries) {
  const context = retrieveTrendContext(trendSeries);
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
    text: `Short answer: ${r.delta > 0 ? "yes, rent stress is getting worse overall" : r.delta < 0 ? "there are signs of easing" : "rent stress is mostly flat"}.

Trend retrieval used:
- Start year: ${r.first.year} (${fmtPct(r.first.aboveShare)} above threshold)
- Latest year: ${r.last.year} (${fmtPct(r.last.aboveShare)} above threshold)
- Net change: ${Math.abs(r.delta).toFixed(1)} points ${r.delta >= 0 ? "up" : "down"}

What this means:
${dirDetail}

Conclusion:
The time-series pattern suggests ${r.delta > 0 ? "rising affordability pressure for young adults" : r.delta < 0 ? "some improvement, but affordability remains a concern" : "a persistent affordability challenge rather than a temporary spike"}.`,
    category: null,
    chart: {
      type: "line",
      title: "Cities Above 30% Threshold (%)",
      labels: r.series.map((p) => String(p.year)),
      values: r.series.map((p) => p.aboveShare),
    },
    meta: {
      tool: "rent_stress_trend",
    },
  };
}

function respondSurvivalScore(parsed, rows) {
  const { income, rent, city } = parsed;
  if (!income)
    return {
      text: "I need your income for a survival score. Try: What is my survival score in Chicago on 65000?",
      category: null,
    };

  let monthlyRent = rent && rent > 0 ? rent : null;
  let source = monthlyRent ? `${fmt(monthlyRent)}/month manual rent` : null;

  if (!monthlyRent && city) {
    const record = lookupCityRecord(city, rows);
    if (!record)
      return {
        text: `I could not find ${city} in the dataset. Try another city or include a rent amount.`,
        category: null,
      };
    monthlyRent = record.monthly_rent;
    source = `${record.city} data (${fmt(monthlyRent)}/month)`;
  }

  if (!monthlyRent)
    return {
      text: "I need a city or monthly rent for a survival score. Try: survival score Chicago 65000.",
      category: null,
    };

  const r = tool_postGradSurvivalScore(income, monthlyRent);
  return {
    text: `Direct answer: Your post-grad survival score is ${r.score}/100.

Inputs used:
- Income: ${fmt(income)}
- Rent source: ${source}

Affordability result:
- Rent burden: ${fmtPct(r.burdenPct)}
- Benchmark: ${AFFORDABILITY_THRESHOLD}%
- Category: ${r.category.label}

Why this matters:
The score estimates how much budget resilience you have after housing costs. Higher is safer.

Conclusion:
${categoryNote(r.burdenPct)}`,
    category: r.category,
    chart: { type: "score", score: r.score, label: r.category.label, cls: r.category.cls },
    meta: {
      tool: "post_grad_survival_score",
    },
  };
}

function respondBudgetLeftover(parsed, rows) {
  const { income, rent, city } = parsed;
  if (!income)
    return {
      text: "I need your income to estimate leftover budget. Try: I make 48000 and rent is 1500.",
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
      text: "I need a city or monthly rent. Try: I make 48000 and my rent is 1500.",
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
    text: `Direct answer: At your current income and rent, you would have ${sign}${fmt(Math.abs(r.monthlyLeftover))}/month left before other expenses.

Calculation summary:
- Annual income: ${fmt(income)}
- Annual rent: ${fmt(r.annualRent)}
- Rent burden: ${fmtPct(r.burdenPct)}

Interpretation:
${tail}`,
    category: null,
    meta: {
      tool: "budget_leftover",
    },
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
    case "explain_dataset":
      return respondDatasetOverview(rows);
    case "explain_model":
      return respondExplainModel();
    case "list_dataset_cities":
      return respondListDatasetCities(rows, "start");
    case "list_dataset_cities_more":
      return respondListDatasetCities(rows, "next");
    case "list_dataset_cities_previous":
      return respondListDatasetCities(rows, "previous");
    case "list_dataset_cities_prefix":
      return respondListCitiesByPrefix(parsed, rows);
    case "list_dataset_cities_all":
      return respondListAllCities(rows);
    case "check_city_exists":
      return respondCityAvailability(parsed, rows);
    case "city_snapshot":
      return respondCitySnapshot(parsed, rows);
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
