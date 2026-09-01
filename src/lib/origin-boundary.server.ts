import { timingSafeEqual } from "node:crypto";

const SHA256_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_TRUSTED_CERTIFICATES = 2;

type Environment = Record<string, string | undefined>;

function normalizeSha256Fingerprint(value: string): string | null {
  const normalized = value.trim().replaceAll(":", "").toLowerCase();
  return SHA256_FINGERPRINT_PATTERN.test(normalized) ? normalized : null;
}

export function parseTrustedProxyCertificateFingerprints(
  value: string | undefined,
): string[] | null {
  if (!value?.trim()) return null;

  const rawFingerprints = value.split(",");
  if (
    rawFingerprints.length === 0 ||
    rawFingerprints.length > MAX_TRUSTED_CERTIFICATES
  ) {
    return null;
  }

  const fingerprints = rawFingerprints.map(normalizeSha256Fingerprint);
  if (fingerprints.some((fingerprint) => fingerprint === null)) return null;

  const validFingerprints = fingerprints as string[];
  return new Set(validFingerprints).size === validFingerprints.length
    ? validFingerprints
    : null;
}

export function parseForwardedClientCertificateFingerprint(
  header: string | null,
): string | null {
  if (!header || header.includes(",")) return null;

  const hashFields = header
    .split(";")
    .map((field) => field.trim())
    .filter((field) => /^hash=/iu.test(field));
  if (hashFields.length !== 1) return null;

  return normalizeSha256Fingerprint(
    hashFields[0].slice(hashFields[0].indexOf("=") + 1),
  );
}

function fingerprintMatches(left: string, right: string): boolean {
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function forbidden(): Response {
  return new Response("Forbidden", {
    status: 403,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export function enforceAzureProductionOriginBoundary(
  request: Request,
  environment: Environment = process.env,
): Response | null {
  if (environment.AZURE_ENVIRONMENT?.trim().toLowerCase() !== "production") {
    return null;
  }

  const trustedFingerprints = parseTrustedProxyCertificateFingerprints(
    environment.KOVA_CLOUDFLARE_CLIENT_CERT_SHA256_FINGERPRINTS,
  );
  const presentedFingerprint = parseForwardedClientCertificateFingerprint(
    request.headers.get("x-forwarded-client-cert"),
  );
  if (!trustedFingerprints || !presentedFingerprint) return forbidden();

  let authorized = 0;
  for (const trustedFingerprint of trustedFingerprints) {
    authorized += Number(
      fingerprintMatches(presentedFingerprint, trustedFingerprint),
    );
  }
  return authorized === 1 ? null : forbidden();
}
