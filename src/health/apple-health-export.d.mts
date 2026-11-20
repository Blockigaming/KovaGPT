export type AppleHealthSource = { name: string; days: { date: string; steps: number }[] };

export function readAppleHealthExport(
  file: File,
  signal?: AbortSignal,
): Promise<AppleHealthSource[]>;
