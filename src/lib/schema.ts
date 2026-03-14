export interface ProcessedHousingRecord {
  city: string;
  year: number;
  monthly_rent: number;
  median_income: number;
  rent_burden: number;
}

export type ProcessedHousingDataset = ProcessedHousingRecord[];
