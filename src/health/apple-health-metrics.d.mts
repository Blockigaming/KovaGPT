export const APPLE_HEALTH_METRICS: readonly {
  type: string;
  id: string;
  label: string;
  unit: string;
  aggregation: "sum" | "avg" | "last" | "sleep";
  group: string;
  countSamples?: boolean;
  signed?: boolean;
  categoryValues?: readonly string[];
  units?: Readonly<Record<string, number>>;
}[];
export const APPLE_HEALTH_HISTORY_DAYS: number;
export const APPLE_HEALTH_DAY_MS: number;
