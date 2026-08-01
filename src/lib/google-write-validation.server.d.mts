export class GoogleWriteValidationError extends Error {
  constructor(message: string);
}

export function validateSupportedGoogleWrite(
  tool: string,
  input: unknown,
): Record<string, unknown>;
