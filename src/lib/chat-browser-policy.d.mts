export function requestsChatBrowser(text: string): boolean;
export function chatBrowserDestination(text: string): URL | null;
export const CLOUD_BROWSER_DAILY_LIMIT_TITLE: string;
export const CLOUD_BROWSER_DAILY_LIMIT_DESCRIPTION: string;
export const CLOUD_BROWSER_DAILY_LIMIT_MESSAGE: string;
export const CLOUD_BROWSER_USAGE_HEADER: string;
export const MAX_BROWSER_EVIDENCE_BYTES: number;
export function chatBrowserEvidence(url: URL, title: string, content: string): string;
