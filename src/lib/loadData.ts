import type { ProcessedHousingDataset, ProcessedHousingRecord } from "./schema";

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
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

function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);
}

function toNumber(value: string): number | null {
  const cleaned = value.replace(/[$,]/g, "").trim();

  if (!cleaned || cleaned === "N" || cleaned === "-" || cleaned.includes("*")) {
    return null;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTitleCase(text: string): string {
  return text
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeCityName(raw: string): string {
  return raw
    .replace(/\s+(city|town|village|municipality|borough|CDP)$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .toLowerCase();
}

function cleanIncomeCity(raw: string): string {
  const beforeComma = raw.split(",")[0] ?? raw;
  return toTitleCase(
    beforeComma
      .replace(/\s+(city|town|village|municipality|borough|CDP)$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
}

function getColumnIndex(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.indexOf(candidate);
    if (idx >= 0) {
      return idx;
    }
  }

  return -1;
}

function extractRentByCity(rentCsv: string, year: number): Map<string, number> {
  const rows = parseCsv(rentCsv);
  const headers = rows[0];
  const dataRows = rows.slice(1);

  const regionNameIndex = headers.indexOf("RegionName");
  const regionTypeIndex = headers.indexOf("RegionType");
  const yearColumns = headers
    .map((name, index) => ({ name, index }))
    .filter((column) => column.name.startsWith(`${year}-`))
    .sort((a, b) => b.name.localeCompare(a.name));

  const fallbackDateColumns = headers
    .map((name, index) => ({ name, index }))
    .filter((column) => /^\d{4}-\d{2}-\d{2}$/.test(column.name))
    .sort((a, b) => b.name.localeCompare(a.name));

  const dateColumnsToUse = yearColumns.length > 0 ? yearColumns : fallbackDateColumns;
  const rentByCity = new Map<string, number>();

  for (const row of dataRows) {
    if (regionNameIndex < 0 || regionTypeIndex < 0) {
      continue;
    }

    const regionType = row[regionTypeIndex];
    if (regionType !== "msa") {
      continue;
    }

    const rawCity = row[regionNameIndex] ?? "";
    const cityLabel = toTitleCase((rawCity.split(",")[0] ?? "").trim());
    const cityKey = normalizeCityName(cityLabel);

    let monthlyRent: number | null = null;
    for (const column of dateColumnsToUse) {
      monthlyRent = toNumber(row[column.index] ?? "");
      if (monthlyRent !== null) {
        break;
      }
    }

    if (!cityKey || monthlyRent === null) {
      continue;
    }

    rentByCity.set(cityKey, Number(monthlyRent.toFixed(2)));
  }

  return rentByCity;
}

function extractIncomeByCity(incomeCsv: string): Map<string, number> {
  const rows = parseCsv(incomeCsv);
  const headers = rows[0];
  const dataRows = rows.slice(1);

  const cityIndex = getColumnIndex(headers, ["Geographic Area Name", "NAME"]);
  const incomeIndex = getColumnIndex(headers, [
    "S1903_C03_001E",
    "Estimate!!Median income (dollars)!!HOUSEHOLD INCOME BY RACE AND HISPANIC OR LATINO ORIGIN OF HOUSEHOLDER!!Households",
  ]);

  const incomeByCity = new Map<string, number>();

  for (const row of dataRows) {
    if ((row[0] ?? "").toLowerCase() === "geography") {
      continue;
    }

    if (cityIndex < 0 || incomeIndex < 0) {
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

export function processHousingData(
  rentCsv: string,
  incomeCsv: string,
  targetYear = 2024,
): ProcessedHousingDataset {
  const rentByCity = extractRentByCity(rentCsv, targetYear);
  const incomeByCity = extractIncomeByCity(incomeCsv);

  const records: ProcessedHousingRecord[] = [];

  for (const [cityKey, monthlyRent] of rentByCity.entries()) {
    const medianIncome = incomeByCity.get(cityKey);

    if (!medianIncome || medianIncome <= 0) {
      continue;
    }

    const city = toTitleCase(cityKey);
    const rentBurden = (monthlyRent * 12) / medianIncome;

    records.push({
      city,
      year: targetYear,
      monthly_rent: Number(monthlyRent.toFixed(2)),
      median_income: Number(medianIncome.toFixed(2)),
      rent_burden: Number(rentBurden.toFixed(2)),
    });
  }

  return records.sort((a, b) => b.rent_burden - a.rent_burden);
}

export async function loadProcessedHousingData(
  targetYear = 2024,
  datasetsBasePath = "/datasets",
): Promise<ProcessedHousingDataset> {
  const [rentResponse, incomeResponse] = await Promise.all([
    fetch(`${datasetsBasePath}/rentals_dataset.csv`),
    fetch(`${datasetsBasePath}/income-data.csv`),
  ]);

  if (!rentResponse.ok || !incomeResponse.ok) {
    throw new Error("Could not load one or more dataset files.");
  }

  const [rentCsv, incomeCsv] = await Promise.all([
    rentResponse.text(),
    incomeResponse.text(),
  ]);

  return processHousingData(rentCsv, incomeCsv, targetYear);
}
