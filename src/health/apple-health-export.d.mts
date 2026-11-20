import type { AppleHealthDay } from "./apple-health-report.mjs";

export type AppleHealthSource = { name: string; days: AppleHealthDay[] };

export function readAppleHealthExport(
  file: File,
  signal?: AbortSignal,
): Promise<AppleHealthSource[]>;
