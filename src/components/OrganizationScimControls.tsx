import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { organizationRequest } from "@/lib/organization-client";
type Status = {
  available: boolean;
  enabled?: boolean;
  providerReady?: boolean;
  providerId?: string;
  revision?: number;
  expiresAt?: string;
  users?: number;
  groups?: number;
  token?: string;
};
export function OrganizationScimControls({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [secret, setSecret] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [consent, setConsent] = useState(false);
  const lifetime = useRef(new AbortController()),
    generation = useRef(0);
  const path = `/api/organizations/scim?expectedUserId=${userId}&organizationId=${organizationId}`;
  useEffect(() => {
    const controller = new AbortController(),
      epoch = ++generation.current;
    lifetime.current = controller;
    setStatus(null);
    setSecret(null);
    setConsent(false);
    setError(null);
    void organizationRequest<Status>(userId, path, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted && epoch === generation.current) setStatus(value);
      })
      .catch(() => {
        if (!controller.signal.aborted && epoch === generation.current)
          setError("Provisioning status could not be loaded.");
      });
    return () => {
      controller.abort();
      generation.current = epoch + 1;
    };
  }, [userId, path]);
  async function mutate(operation: "rotate" | "disable") {
    if (busy || !status || status.revision === undefined) return;
    const controller = lifetime.current,
      epoch = generation.current;
    setBusy(true);
    setError(null);
    setSecret(null);
    try {
      const value = await organizationRequest<Status>(
        userId,
        "/api/organizations/scim",
        controller.signal,
        {
          expectedUserId: userId,
          organizationId,
          operation,
          expectedRevision: status.revision,
          consent,
        },
      );
      if (controller.signal.aborted || epoch !== generation.current) return;
      const { token, ...safe } = value;
      setSecret(token ?? null);
      setStatus({ ...status, ...safe });
      setConsent(false);
    } catch {
      if (!controller.signal.aborted && epoch === generation.current) {
        setStatus(null);
        setError(
          "The result could not be confirmed. Refresh this organization before issuing or disabling a token again.",
        );
      }
    } finally {
      if (!controller.signal.aborted && epoch === generation.current) setBusy(false);
    }
  }
  return (
    <section className="rounded-xl border p-4" aria-label="Directory provisioning">
      <h2 className="font-semibold">Directory provisioning</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        SCIM provisions organization members through this organization’s SSO identity. Groups remain
        directory records; they do not share Projects or grant administrator access.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm">
          {error}
        </p>
      )}
      {!status && !error && (
        <p role="status" className="mt-2 text-sm">
          Loading provisioning status…
        </p>
      )}
      {status && !status.available && (
        <p className="mt-2 text-sm">Provisioning is awaiting operator activation.</p>
      )}
      {status?.available && (
        <div className="mt-3 space-y-3 text-sm">
          <p>
            {status.enabled ? "Provisioning active" : "Provisioning inactive"}
            {status.expiresAt
              ? ` · Token expires ${new Date(status.expiresAt).toLocaleDateString()}`
              : ""}
          </p>
          <p>
            Base URL:{" "}
            <code className="break-all">
              {typeof window !== "undefined" ? window.location.origin : ""}/api/scim/v2/
              {organizationId}
            </code>
          </p>
          <p>
            {status.users ?? 0} directory users · {status.groups ?? 0} directory groups
          </p>
          {!status.providerReady && (
            <p>Configure and verify this organization’s SSO provider first.</p>
          )}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy || !status.providerReady}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              I authorize this IdP to create and revoke its managed member access. Rotating
              invalidates the previous token.
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !consent || !status.providerReady}
              onClick={() => void mutate("rotate")}
            >
              {status.enabled ? "Rotate provisioning token" : "Issue provisioning token"}
            </Button>
            <Button
              variant="outline"
              disabled={busy || !status.enabled}
              onClick={() => void mutate("disable")}
            >
              Disable managed provisioning access
            </Button>
          </div>
          {secret && (
            <div className="rounded-lg border p-3">
              <p>Save this token in your IdP now. It is shown once and expires in 90 days.</p>
              <textarea
                aria-label="One-time SCIM token"
                readOnly
                value={secret}
                className="mt-2 w-full resize-none rounded border bg-background p-2 font-mono text-xs"
              />
              <Button variant="outline" className="mt-2" onClick={() => setSecret(null)}>
                Hide token
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
