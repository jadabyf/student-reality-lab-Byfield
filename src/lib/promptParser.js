import { buildCityLookup, expandCityAliases, extractCityMentionsFromText } from "./cityLookup.js";

function toNum(str, hasK) {
  const n = parseFloat(String(str).replace(/,/g, ""));
  return hasK ? n * 1000 : n;
}

function guessCityPhrase(text) {
  const patterns = [
    /\bdo\s+you\s+have\s+([a-z .'-]+(?:,\s*[a-z]{2})?)(?=[?.!,]|$)/i,
    /\bcan\s+you\s+check\s+([a-z .'-]+(?:,\s*[a-z]{2})?)(?=[?.!,]|$)/i,
    /\bis\s+([a-z .'-]+(?:,\s*[a-z]{2})?)\s+in\s+your\s+dataset(?=[?.!,]|$)/i,
    /\blive\s+in\s+([a-z .'-]+(?:,\s*[a-z]{2})?)(?=\s+(?:with|on|for)\b|[?.!,]|$)/i,
    /\bin\s+([a-z .'-]+(?:,\s*[a-z]{2})?)(?=\s+(?:with|on|for)\b|[?.!,]|$)/i,
    /\bafford\s+([a-z .'-]+(?:,\s*[a-z]{2})?)(?=\s+(?:with|on|for)\b|[?.!,]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function guessCityPrefix(text) {
  const patterns = [
    /cities\s+starting\s+with\s+([a-z])/i,
    /cities\s+that\s+start\s+with\s+([a-z])/i,
    /show\s+cities\s+starting\s+with\s+([a-z])/i,
    /cities\s+starting\s+([a-z])/i,
    /starting\s+with\s+([a-z])/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }

  return null;
}

/** Expand city and income shorthand into router-friendly phrasing. */
export function normalizePrompt(text) {
  let out = text.replace(/\b(\d+(?:\.\d+)?)\s*k\b/gi, (_, n) => String(parseFloat(n) * 1000));
  return expandCityAliases(out);
}

/**
 * Extract income, rent, and candidate city mentions from free text.
 * Returns { income, rent, city, city2, cities }.
 */
export function parseMessage(text, cityNames) {
  const normalized = normalizePrompt(text);
  const lower = normalized.toLowerCase().trim();
  const cityLookup = buildCityLookup(cityNames.map((city) => ({ city })));
  const cities = extractCityMentionsFromText(normalized, cityLookup, 3);
  const guessedCity = guessCityPhrase(normalized);
  const cityPrefix = guessCityPrefix(normalized);

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

  let rent = null;
  const rentMatch = lower.match(
    /(?:rent(?:\s+(?:is|of|at))?|paying(?:\s+rent)?)\s+\$?([\d,]+(?:\.\d+)?)\s*(k)?\b/,
  );
  if (rentMatch) {
    const v = toNum(rentMatch[1], rentMatch[2] === "k");
    if (v > 0) {
      rent = v;
    }
  }

  if (!income) {
    for (const m of lower.matchAll(/\$?([\d,]+(?:\.\d+)?)\s*(k)?\b/g)) {
      const v = toNum(m[1], m[2] === "k");
      if (v >= 15000 && v <= 500000 && v !== rent) {
        income = v;
        break;
      }
    }
  }

  return {
    income,
    rent,
    city: cities[0] ?? guessedCity ?? null,
    city2: cities[1] ?? null,
    cities,
    cityPrefix,
  };
}

/** Classify the message into a supported tool intent. */
export function detectIntent(text) {
  const t = normalizePrompt(text).toLowerCase();

  if (/what\s+data|data\s+are\s+you\s+using|where\s+does\s+the\s+data\s+come|dataset\s+source/.test(t)) {
    return "explain_dataset";
  }

  if (/30%\s+line|30\s*percent|rent\s+burden|how\s+do\s+you\s+calculate|affordability\s+model|how\s+is\s+this\s+calculated/.test(t)) {
    return "explain_model";
  }

  if (/what\s+cities\s+are\s+in\s+your\s+dataset|which\s+cities\s+can\s+you\s+(?:check|look\s*up)|what\s+cities\s+can\s+you\s+(?:check|look\s*up)|list\s+.*cities/.test(t)) {
    return "list_dataset_cities";
  }

  if (/do\s+you\s+have|can\s+you\s+check|is\s+.+\s+in\s+your\s+dataset|is\s+.+\s+available/.test(t)) {
    return "check_city_exists";
  }

  if (/\bis\b.+\bexpensive\b|\bhow expensive\b|\bpricey\b/.test(t)) {
    return "city_snapshot";
  }

  if (/\bcompare\b|\bvs\.?\b|\bversus\b/.test(t)) {
    return "compare";
  }

  if (/(?:find|what|which)\s+cit|affordable cit|recommend.*cit|cities.*afford|afford.*cities/.test(t)) {
    return "find_cities";
  }

  if (/show\s+more\s+cities|more\s+cities|next\s+cities|other\s+cities/.test(t)) {
    return "list_dataset_cities_more";
  }

  if (/^more$|^next$/.test(t)) {
    return "list_dataset_cities_more";
  }

  if (/show\s+previous\s+cities|previous\s+cities|back\s+cities/.test(t)) {
    return "list_dataset_cities_previous";
  }

  if (/^previous$|^back$/.test(t)) {
    return "list_dataset_cities_previous";
  }

  if (/show\s+all\s+cities|all\s+cities/.test(t)) {
    return "list_dataset_cities_all";
  }

  if (/cities\s+starting\s+with|cities\s+that\s+start\s+with/.test(t)) {
    return "list_dataset_cities_prefix";
  }

  if (/cities\s+starting\s+[a-z]|^starting\s+with\s+[a-z]$/.test(t)) {
    return "list_dataset_cities_prefix";
  }

  if (/\btrend\b|\bgetting worse\b|\bover time\b|\bworsening\b|\bimproving\b|\bhistory\b/.test(t)) {
    return "trend";
  }

  if (/\bsurvival score\b|\bsurvive\b|\bpost.?grad score\b|\bmy score\b/.test(t)) {
    return "survival_score";
  }

  if (/\bleftover\b|\bleft after\b|\bafter rent\b|\bremaining\b|\bwhat.?s left\b|\bbudget after\b/.test(t)) {
    return "budget_leftover";
  }

  return "affordability";
}
