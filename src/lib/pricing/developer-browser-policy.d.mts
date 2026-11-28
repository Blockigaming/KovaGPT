export const BROWSER_MODEL: "browserbase-readonly-60s";
export const BROWSER_SESSION_SECONDS: 60;
export function developerBrowserUrl(value: unknown): URL;
export function developerBrowserOrigins(value: unknown): string[];
export function developerBrowserTargets(value: unknown): URL[];
export function developerBrowserFields(value: unknown): {
  url: string;
  navigate?: string[];
  interactive?: true;
  session_seconds: 60;
};
export function executeDeveloperBrowserPlan<T extends { url: string; text: string }>(
  body: unknown,
  options: {
    check: (url: URL) => Promise<void>;
    capture: (url: URL) => Promise<T>;
    signal?: AbortSignal;
  },
): Promise<T[]>;
export function validDeveloperBrowserRequest(body: unknown): boolean;
export function developerBrowserReceipt(value: unknown): boolean;
