export type AppleHealthDay = { date: string; steps: number };

export const MAX_APPLE_HEALTH_REPORT_BYTES: number;
export function parseAppleHealthReport(text: string): AppleHealthDay[];
