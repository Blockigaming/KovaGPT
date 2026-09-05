import { resolveTxt } from "node:dns/promises";
import { normalizeOrganizationDomain } from "@/lib/organization-policy.mjs";

export type OrganizationDomain = {
  id: string;
  domain: string;
  state: string;
  challenge_token: string;
  verification_expires_at: string | null;
};
export class OrganizationDomainError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export async function verifyOrganizationDns(
  domain: OrganizationDomain,
  resolver: (name: string) => Promise<string[][]> = resolveTxt,
): Promise<string> {
  const normalized = normalizeOrganizationDomain(domain.domain);
  if (!/^[a-f0-9-]{36}$/u.test(domain.challenge_token))
    throw new OrganizationDomainError("organization_domain_proof_invalid");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      resolver(`_kovagpt-verification.${normalized}`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new OrganizationDomainError("organization_dns_timeout")),
          5000,
        );
      }),
    ]);
    if (
      records.length > 50 ||
      records.some((record) => record.join("").length > 1024) ||
      !records.some((record) => record.join("") === `kovagpt-domain=${domain.challenge_token}`)
    ) {
      throw new OrganizationDomainError("organization_domain_proof_missing");
    }
    return domain.challenge_token;
  } catch (error) {
    if (error instanceof OrganizationDomainError) throw error;
    throw new OrganizationDomainError("organization_dns_unavailable");
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export function configuredOrganizationSsoProvider(
  organizationId: string,
  domain: OrganizationDomain,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): string {
  const expires = Date.parse(domain.verification_expires_at ?? "");
  if (domain.state !== "verified" || !Number.isFinite(expires) || expires <= now)
    throw new OrganizationDomainError("organization_domain_verification_required");
  let registry: unknown;
  try {
    registry = JSON.parse(env.KOVA_ORGANIZATION_SSO_CONNECTIONS_JSON ?? "{}");
  } catch {
    throw new OrganizationDomainError("organization_sso_not_configured");
  }
  if (!registry || typeof registry !== "object" || Array.isArray(registry))
    throw new OrganizationDomainError("organization_sso_not_configured");
  const entry = (registry as Record<string, unknown>)[organizationId];
  if (!entry || typeof entry !== "object" || Array.isArray(entry))
    throw new OrganizationDomainError("organization_sso_not_configured");
  const { providerId, domains } = entry as { providerId?: unknown; domains?: unknown };
  if (
    typeof providerId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
      providerId,
    ) ||
    !Array.isArray(domains) ||
    !domains.includes(domain.domain)
  )
    throw new OrganizationDomainError("organization_sso_not_configured");
  return providerId;
}
