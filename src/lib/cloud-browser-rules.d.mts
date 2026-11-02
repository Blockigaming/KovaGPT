export type CloudBrowserRules = { sites: Array<{ origin: string; access: "ask" | "block" }> };
export function cloudBrowserOrigin(value: unknown): string;
export function parseCloudBrowserRules(value: unknown): CloudBrowserRules;
export function assertCloudBrowserDestination(rules: CloudBrowserRules, destination: string): void;
