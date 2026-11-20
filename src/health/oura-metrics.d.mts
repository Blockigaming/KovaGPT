export type OuraMetric = {
  id: string;
  path: string;
  label: string;
  unit: string;
  group: string;
  aggregation: "avg" | "sum" | "last" | "min" | "category";
  scale: number;
  categories?: Record<string, string>;
  source?: string;
};
export const OURA_COLLECTIONS: {
  collection: string;
  scope: string;
  group: string;
  fields: OuraMetric[];
}[];
export const OURA_METRICS: OuraMetric[];
export const OURA_SCOPES: string[];
