export type HealthProviderId = "oura" | "whoop";
export const HEALTH_PROVIDERS: Readonly<
  Record<HealthProviderId, { label: string; scopes: string[]; metrics: string[] }>
>;
