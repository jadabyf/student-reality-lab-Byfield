const STATE_ABBREVIATIONS = new Set([
  "al",
  "ak",
  "az",
  "ar",
  "ca",
  "co",
  "ct",
  "de",
  "dc",
  "fl",
  "ga",
  "hi",
  "id",
  "il",
  "in",
  "ia",
  "ks",
  "ky",
  "la",
  "me",
  "md",
  "ma",
  "mi",
  "mn",
  "ms",
  "mo",
  "mt",
  "ne",
  "nv",
  "nh",
  "nj",
  "nm",
  "ny",
  "nc",
  "nd",
  "oh",
  "ok",
  "or",
  "pa",
  "ri",
  "sc",
  "sd",
  "tn",
  "tx",
  "ut",
  "vt",
  "va",
  "wa",
  "wv",
  "wi",
  "wy",
]);

const CITY_ALIASES = [
  [/\bnyc\b/gi, "New York"],
  [/\bnew york city\b/gi, "New York"],
  [/\bla\b/gi, "Los Angeles"],
  [/\bl\.a\.\b/gi, "Los Angeles"],
  [/\bsf\b/gi, "San Francisco"],
  [/\bdc\b/gi, "Washington"],
  [/\bphilly\b/gi, "Philadelphia"],
  [/\bst\.?\s+louis\b/gi, "St. Louis"],
  [/\bsaint\s+louis\b/gi, "St. Louis"],
];

function stripStateSuffix(normalized) {
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length <= 1) {
    return normalized;
  }

  const last = tokens[tokens.length - 1];
  if (STATE_ABBREVIATIONS.has(last)) {
    return tokens.slice(0, -1).join(" ");
  }

  return normalized;
}

export function normalizeCityText(value) {
  const normalized = String(value)
    .toLowerCase()
    .replace(/[',]/g, " ")
    .replace(/[.]/g, "")
    .replace(/[()]/g, " ")
    .replace(/[\-/]/g, " ")
    .replace(/\bsaint\b/g, "st")
    .replace(/\bcity\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return stripStateSuffix(normalized);
}

export function expandCityAliases(text) {
  let out = String(text);
  for (const [re, expansion] of CITY_ALIASES) {
    out = out.replace(re, expansion);
  }
  return out;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildCityLookup(rows) {
  const citySet = new Set(rows.map((row) => row.city));
  const cities = [...citySet];
  const byNormalized = new Map();

  for (const city of cities) {
    const key = normalizeCityText(city);
    if (!key) {
      continue;
    }

    const list = byNormalized.get(key) ?? [];
    list.push(city);
    byNormalized.set(key, list);
  }

  const sortedKeys = [...byNormalized.keys()].sort((a, b) => b.length - a.length);
  return { cities, byNormalized, sortedKeys };
}

export function extractCityMentionsFromText(text, lookup, maxMatches = 3) {
  const matches = [];
  const expanded = expandCityAliases(text);
  const normalizedText = normalizeCityText(expanded);

  for (const key of lookup.sortedKeys) {
    const regex = new RegExp(`(^|\\b)${escapeRegExp(key).replace(/\\ /g, "\\\\s+")}(\\b|$)`, "i");
    if (!regex.test(normalizedText)) {
      continue;
    }

    const canonical = lookup.byNormalized.get(key)?.[0];
    if (!canonical || matches.includes(canonical)) {
      continue;
    }

    matches.push(canonical);
    if (matches.length >= maxMatches) {
      break;
    }
  }

  return matches;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[a.length][b.length];
}

export function resolveCityQuery(query, lookup) {
  const normalizedQuery = normalizeCityText(expandCityAliases(query));
  if (!normalizedQuery) {
    return { ok: false, reason: "empty_query", query };
  }

  const exact = lookup.byNormalized.get(normalizedQuery);
  if (exact && exact.length === 1) {
    return { ok: true, city: exact[0], normalizedQuery, strategy: "exact" };
  }

  if (exact && exact.length > 1) {
    return { ok: false, reason: "ambiguous", matches: exact, normalizedQuery };
  }

  const partial = lookup.sortedKeys
    .filter((key) => key.includes(normalizedQuery) || normalizedQuery.includes(key))
    .slice(0, 5)
    .map((key) => lookup.byNormalized.get(key)?.[0])
    .filter(Boolean);

  if (partial.length === 1) {
    return { ok: true, city: partial[0], normalizedQuery, strategy: "partial" };
  }

  if (partial.length > 1) {
    return { ok: false, reason: "ambiguous", matches: partial, normalizedQuery };
  }

  const candidates = lookup.sortedKeys
    .map((key) => ({ key, distance: levenshtein(normalizedQuery, key) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((item) => lookup.byNormalized.get(item.key)?.[0])
    .filter(Boolean);

  return {
    ok: false,
    reason: "city_not_found",
    query,
    normalizedQuery,
    suggestions: candidates,
  };
}