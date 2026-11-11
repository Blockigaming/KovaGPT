import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Globe2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { publishKovaNotice } from "@/components/KovaNotificationSurface";
import {
  getTeamDomainVerification,
  listVerifiedTeamDomains,
  verifyTeamDomain,
} from "@/lib/team-domains.functions";

type DomainProof = { domain: string; recordHost: string; txtValue: string };
type VerifiedDomain = { domain: string; verified_at: string };

export function TeamDomainVerificationPanel({ teamId }: { teamId: string }) {
  const [domain, setDomain] = useState("");
  const [proof, setProof] = useState<DomainProof | null>(null);
  const [verified, setVerified] = useState<VerifiedDomain[]>([]);
  const [busy, setBusy] = useState<"prepare" | "verify" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setDomain("");
    setProof(null);
    setVerified([]);
    setError("");
    void listVerifiedTeamDomains({ data: { teamId } })
      .then((rows) => {
        if (!cancelled) setVerified(rows);
      })
      .catch(() => {
        // Keep domain setup available for newly configured environments.
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  const prepare = async () => {
    if (busy) return;
    setBusy("prepare");
    setError("");
    setProof(null);
    try {
      const value = await getTeamDomainVerification({ data: { teamId, domain } });
      setProof(value);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Verification record could not be created.",
      );
    } finally {
      setBusy(null);
    }
  };
  const verify = async () => {
    if (busy || !proof) return;
    setBusy("verify");
    setError("");
    try {
      const result = await verifyTeamDomain({ data: { teamId, domain: proof.domain } });
      if (!result.verified) throw new Error("Domain verification was not confirmed.");
      setVerified((rows) => [
        { domain: result.domain, verified_at: result.verifiedAt },
        ...rows.filter((row) => row.domain !== result.domain),
      ]);
      publishKovaNotice({
        id: "settings_updated",
        title: "Workspace domain verified",
        message: "Matching verified accounts can now discover this workspace when it is active.",
        confirmed: true,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Domain verification failed. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      publishKovaNotice({ id: "copied", title: "DNS record copied", confirmed: true });
    } catch {
      setError("The record could not be copied. Select and copy the text manually.");
    }
  };

  return (
    <section
      className="m-5 space-y-4 rounded-[22px] border border-border bg-muted/15 p-4 sm:m-7 sm:p-5"
      aria-label="Workspace domain verification"
    >
      <div className="flex items-center gap-3">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary"
          aria-hidden="true"
        >
          <Globe2 className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-base font-semibold">Verify a workspace email domain</h3>
          <p className="text-xs leading-5 text-muted-foreground">
            Members with this email domain can discover your workspace and request access. Ownership
            of the domain must be verified first.
          </p>
        </div>
      </div>
      {verified.length > 0 && (
        <div className="space-y-2" aria-label="Verified workspace domains">
          {verified.map((item) => (
            <div
              key={item.domain}
              className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <span className="break-all">{item.domain}</span>
              <span className="ml-auto text-xs text-muted-foreground">Verified</span>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2">
        <label htmlFor={`verify-team-domain-${teamId}`} className="text-sm font-medium">
          Organization domain
        </label>
        <Input
          id={`verify-team-domain-${teamId}`}
          value={domain}
          inputMode="url"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          placeholder="school.edu or company.com"
          className="min-h-12 rounded-xl"
          disabled={busy !== null}
          onChange={(event) => {
            setDomain(event.target.value);
            setProof(null);
            setError("");
          }}
        />
        <Button
          type="button"
          className="min-h-11 rounded-full"
          disabled={busy !== null || !domain.trim()}
          onClick={() => void prepare()}
        >
          {busy === "prepare" ? "Preparing…" : "Get DNS verification record"}
        </Button>
      </div>
      {proof && (
        <div className="space-y-3 rounded-2xl border border-border bg-background/50 p-4">
          <p className="text-sm leading-6">
            Add the following TXT record to the DNS configuration for your domain. Then return here
            to verify ownership.
          </p>
          {(
            [
              { label: "TXT record name", value: proof.recordHost },
              { label: "TXT record value", value: proof.txtValue },
            ] as const
          ).map((field) => (
            <div key={field.label} className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{field.label}</label>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-muted px-3 py-2 text-xs leading-5">
                  {field.value}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Copy ${field.label}`}
                  className="h-11 w-11 shrink-0 rounded-xl"
                  onClick={() => void copy(field.value)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            className="min-h-11 rounded-full"
            disabled={busy !== null}
            onClick={() => void verify()}
          >
            {busy === "verify" ? "Checking DNS…" : "Verify DNS record"}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm leading-6 text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
