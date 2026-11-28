export const TRANSLATION_MODEL: string;
export const TRANSLATION_MAX_SECONDS: number;
export const TRANSLATION_ACCOUNTING: string;
export const TRANSLATION_LANGUAGES: readonly string[];
export function developerTranslationFields(input: unknown): Record<string, unknown>;
export function developerTranslationSeconds(body: unknown): number;
export function validDeveloperTranslationRequest(body: unknown): boolean;
export function developerTranslationReceipt(value: unknown): Record<string, number> | null;
export function runDeveloperTranslation(
  body: Record<string, unknown>,
  options: {
    apiKey?: string;
    connect: (
      url: string,
      headers: Record<string, string>,
    ) => Pick<
      WebSocket,
      "readyState" | "send" | "close" | "addEventListener" | "removeEventListener"
    >;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<Response>;
