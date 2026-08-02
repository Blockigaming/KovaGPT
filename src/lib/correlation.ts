const SAFE_CORRELATION = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$/;

export function correlationId(value?: string | null): string {
  return value && SAFE_CORRELATION.test(value) ? value : crypto.randomUUID();
}

export function correlationHeaders(id: string): HeadersInit {
  return { "Cache-Control": "no-store", "X-Correlation-Id": id };
}
