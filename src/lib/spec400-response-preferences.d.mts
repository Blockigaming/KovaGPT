export function withResponsePresentation<T extends { customInstructions?: string }>(
  profile: T,
  settings: { responseTone?: string; responseFormat?: string },
): T;
