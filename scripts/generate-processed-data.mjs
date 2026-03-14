import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const rentFile = path.join(rootDir, "datasets", "rentals_dataset.csv");
const incomeFile = path.join(rootDir, "datasets", "income-data.csv");
const outputFile = path.join(rootDir, "datasets", "processed.json");

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseCsv(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);
}

function toNumber(value) {
  const cleaned = value.replace(/[$,]/g, "").trim();

  if (!cleaned || cleaned === "N" || cleaned === "-" || cleaned.includes("*")) {
    return null;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTitleCase(text) {
  return text
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeCityName(raw) {
  return raw
    .replace(/\s+(city|town|village|municipality|borough|CDP)$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .toLowerCase();
}

function cleanIncomeCity(raw) {
  const beforeComma = raw.split(",")[0] ?? raw;
  return toTitleCase(
    beforeComma
      .replace(/\s+(city|town|village|municipality|borough|CDP)$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
}

function getColumnIndex(headers, candidates) {
  for (const candidate of candidates) {
    const index = headers.indexOf(candidate);
    if (index >= 0) {
      return index;
    }
  }

  return -1;
}

function getAvailableYears(headers) {
  const years = new Set();

  for (const name of headers) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(name)) {
      years.add(Number(name.slice(0, 4)));
    }
  }

  return [...years].sort((a, b) => a - b);
}

function extractRentByCityByYear(rentCsv) {
  const rows = parseCsv(rentCsv);
  const headers = rows[0];
  const dataRows = rows.slice(1);

  const regionNameIndex = headers.indexOf("RegionName");
  const regionTypeIndex = headers.indexOf("RegionType");
  const availableYears = getAvailableYears(headers);
  const yearColumns = new Map(
    availableYears.map((year) => [
      year,
      headers
        .map((name, index) => ({ name, index }))
        .filter((column) => column.name.startsWith(`${year}-`))
        .sort((a, b) => b.name.localeCompare(a.name)),
    ]),
  );

  const rentByCityByYear = new Map();

  for (const row of dataRows) {
    const regionType = row[regionTypeIndex] ?? "";
    if (regionType !== "msa") {
      continue;
    }

    const rawCity = row[regionNameIndex] ?? "";
    const cityLabel = toTitleCase((rawCity.split(",")[0] ?? "").trim());
    const cityKey = normalizeCityName(cityLabel);

    if (!cityKey) {
      continue;
    }

    const rentByYear = new Map();

    for (const year of availableYears) {
      const columnsForYear = yearColumns.get(year) ?? [];
      let monthlyRent = null;

      for (const column of columnsForYear) {
        monthlyRent = toNumber(row[column.index] ?? "");
        if (monthlyRent !== null) {
          break;
        }
      }

      if (monthlyRent !== null) {
        rentByYear.set(year, Number(monthlyRent.toFixed(2)));
      }
    }

    if (rentByYear.size === 0) {
      continue;
    }

    rentByCityByYear.set(cityKey, rentByYear);
  }

  return rentByCityByYear;
}

function extractIncomeByCity(incomeCsv) {
  const rows = parseCsv(incomeCsv);
  const headers = rows[0];
  const dataRows = rows.slice(1);

  const cityIndex = getColumnIndex(headers, ["Geographic Area Name", "NAME"]);
  const incomeIndex = getColumnIndex(headers, [
    "S1903_C03_001E",
    "Estimate!!Median income (dollars)!!HOUSEHOLD INCOME BY RACE AND HISPANIC OR LATINO ORIGIN OF HOUSEHOLDER!!Households",
  ]);

  const incomeByCity = new Map();

  for (const row of dataRows) {
    if ((row[0] ?? "").toLowerCase() === "geography") {
      continue;
    }

    const rawAreaName = row[cityIndex] ?? "";
    const cityName = cleanIncomeCity(rawAreaName);
    const cityKey = normalizeCityName(cityName);
    const medianIncome = toNumber(row[incomeIndex] ?? "");

    if (!cityKey || medianIncome === null || medianIncome <= 0) {
      continue;
    }

    incomeByCity.set(cityKey, medianIncome);
  }

  return incomeByCity;
}

async function main() {
  const [rentCsv, incomeCsv] = await Promise.all([
    readFile(rentFile, "utf8"),
    readFile(incomeFile, "utf8"),
  ]);

  const rentByCityByYear = extractRentByCityByYear(rentCsv);
  const incomeByCity = extractIncomeByCity(incomeCsv);

  const processed = [];

  for (const [cityKey, rentByYear] of rentByCityByYear.entries()) {
    const medianIncome = incomeByCity.get(cityKey);

    if (!medianIncome || medianIncome <= 0) {
      continue;
    }

    for (const [year, monthlyRent] of rentByYear.entries()) {
      const rentBurden = (monthlyRent * 12) / medianIncome;

      processed.push({
        city: toTitleCase(cityKey),
        year,
        monthly_rent: Number(monthlyRent.toFixed(2)),
        median_income: Number(medianIncome.toFixed(2)),
        rent_burden: Number(rentBurden.toFixed(2)),
      });
    }
  }

  processed.sort((a, b) => {
    if (a.year !== b.year) {
      return b.year - a.year;
    }

    return b.rent_burden - a.rent_burden;
  });

  await writeFile(outputFile, JSON.stringify(processed, null, 2), "utf8");
  console.log(`Generated ${processed.length} rows in datasets/processed.json`);
}

main().catch((error) => {
  console.error("Failed to generate processed dataset:", error);
  process.exit(1);
});
