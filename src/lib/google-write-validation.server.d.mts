export class GoogleWriteValidationError extends Error {
  constructor(message: string);
}

export function foldEmailAddressHeader(name: string, value: string): string;
export function encodeMimeTextBody(value: string): string;

export function validateSupportedGoogleWrite(tool: string, input: unknown): Record<string, unknown>;
