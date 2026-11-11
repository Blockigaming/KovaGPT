import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireVerifiedUser } from "@/lib/api-auth.server";
import { readTeam } from "@/lib/team-billing.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { normalizeTeamDomain } from "@/lib/team-domain-policy.mjs";
import { loose } from "@/lib/supabase-loose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const teamOwnerAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const caller = await requireVerifiedUser(getRequest());
  if (caller instanceof Response) throw caller;
  return next({ context: { ownerId: caller.userId, revalidate: caller.revalidateSession } });
});
async function assertOwner(teamId: string, ownerId: string) {
  const team = await readTeam(teamId);
  if (team.owner_id !== ownerId)
    throw new Error("Only the verified workspace owner may verify its domain.");
}
function validDomain(value: string) {
  const domain = normalizeTeamDomain(value);
  if (!domain)
    throw new Error("Use a domain controlled by your organization, not a personal email provider.");
  return domain;
}
async function proofFor(teamId: string, domain: string) {
  // Possession of a DNS TXT record proves domain control; the challenge is
  // unique to each team and domain. It grants no membership by itself.
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256")
    .update("kovagpt-team-domain-v1:" + teamId + ":" + domain)
    .digest("hex");
  return {
    domain,
    recordHost: "_kovagpt-verify." + domain,
    txtValue: "kovagpt-verification=" + digest,
    verificationReference: "sha256:" + digest,
  };
}
const domainInput = z
  .object({
    teamId: z.string().uuid(),
    domain: z.string().trim().min(3).max(253),
  })
  .strict();
export const getTeamDomainVerification = createServerFn({ method: "POST" })
  .middleware([teamOwnerAuth])
  .validator((input: unknown) => domainInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertOwner(data.teamId, context.ownerId);
    const proof = await proofFor(data.teamId, validDomain(data.domain));
    return { domain: proof.domain, recordHost: proof.recordHost, txtValue: proof.txtValue };
  });
export const listVerifiedTeamDomains = createServerFn({ method: "POST" })
  .middleware([teamOwnerAuth])
  .validator((input: unknown) => z.object({ teamId: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data, context }) => {
    await assertOwner(data.teamId, context.ownerId);
    const result = await loose(supabaseAdmin)
      .from("team_verified_domains")
      .select("domain,verified_at")
      .eq("team_id", data.teamId)
      .order("verified_at", { ascending: false })
      .limit(25)
      .abortSignal(AbortSignal.timeout(10000));
    if (result.error) throw new Error("Verified domains could not be loaded.");
    return (result.data ?? []) as { domain: string; verified_at: string }[];
  });
export const verifyTeamDomain = createServerFn({ method: "POST" })
  .middleware([teamOwnerAuth])
  .validator((input: unknown) => domainInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertOwner(data.teamId, context.ownerId);
    const domain = validDomain(data.domain);
    const rate = await consumeApplicationRateLimit({
      identity: "user:" + context.ownerId,
      action: "workspace_domain_verify",
      limit: 8,
      windowSeconds: 3600,
    });
    if (!rate.allowed) throw new Error("Too many verification requests. Try again later.");
    const proof = await proofFor(data.teamId, domain);
    const dns = await import("node:dns/promises");
    let timer: ReturnType<typeof setTimeout> | null = null;
    let records: string[][] = [];
    try {
      records = await Promise.race([
        dns.resolveTxt(proof.recordHost),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("DNS verification timed out.")), 8000);
        }),
      ]);
    } catch {
      throw new Error(
        "The DNS verification record could not be found. Check your TXT record and try again.",
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
    // TXT parts are allowed to be split into strings by DNS providers.
    if (!records.some((record) => record.join("") === proof.txtValue)) {
      throw new Error("The expected TXT record is not published yet.");
    }
    if (context.revalidate && !(await context.revalidate())) {
      throw new Error("Your session changed. Sign in again to verify this domain.");
    }
    // A later owner transfer must not allow a stale authorization to mutate a team.
    await assertOwner(data.teamId, context.ownerId);
    const result = await loose(supabaseAdmin)
      .from("team_verified_domains")
      .upsert(
        {
          team_id: data.teamId,
          domain,
          verified_at: new Date().toISOString(),
          verification_method: "dns_txt",
          verification_reference: proof.verificationReference,
        },
        { onConflict: "team_id,domain" },
      )
      .select("domain,verified_at")
      .single()
      .abortSignal(AbortSignal.timeout(10000));
    if (result.error || !result.data)
      throw new Error("DNS proof succeeded, but the verification record could not be saved.");
    return { domain, verifiedAt: result.data.verified_at as string, verified: true as const };
  });
