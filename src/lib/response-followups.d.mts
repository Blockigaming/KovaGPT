export function normalizeResponseFollowups(value: unknown): string[];
export function appendFollowupToDraft(draft: string, suggestion: string): string;
export const RESPONSE_FOLLOWUP_INSTRUCTIONS: string;
export function extractResponseFollowups(content: string): { content: string; followups: string[] };
