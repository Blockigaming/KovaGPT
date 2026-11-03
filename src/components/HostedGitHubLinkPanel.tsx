import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  beginHostedGitHubIdentityLink,
  hostedGitHubLinkStatus,
} from "@/lib/hosted-github-identity-link";

export function HostedGitHubLinkPanel() {
  const { user, isLoaded } = useUser();
  const ownerId = isLoaded ? (user?.id ?? null) : null;
  const owner = useRef(ownerId);
  owner.current = ownerId;
  const generation = useRef(0);
  const inFlight = useRef(false);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState<{ ownerId: string; email: string; linked: boolean } | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const operation = ++generation.current;
    setStatus(null);
    setError(false);
    setBusy(false);
    if (!ownerId) return;
    const current = () => generation.current === operation && owner.current === ownerId;
    void hostedGitHubLinkStatus(ownerId, current).then(
      (value) => {
        if (current()) setStatus({ ownerId, ...value });
      },
      () => {
        if (current()) setError(true);
      },
    );
    return () => {
      generation.current += 1;
    };
  }, [ownerId, retry]);

  async function link() {
    if (!ownerId || status?.ownerId !== ownerId || status.linked || inFlight.current) return;
    const capturedOwner = ownerId;
    const operation = generation.current;
    const current = () => generation.current === operation && owner.current === capturedOwner;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      const destination = await beginHostedGitHubIdentityLink(capturedOwner, current);
      if (!current()) return;
      if (destination) window.location.assign(destination);
      else setStatus({ ...status, linked: true });
    } catch {
      if (current()) setError(true);
    } finally {
      inFlight.current = false;
      if (current()) setBusy(false);
    }
  }

  const visible = status?.ownerId === ownerId ? status : null;
  return (
    <section
      className="rounded-2xl border border-border bg-card/60 p-5"
      aria-labelledby="github-sign-in-heading"
    >
      <h3 id="github-sign-in-heading" className="text-sm font-semibold">
        GitHub sign-in
      </h3>
      {visible?.linked ? (
        <p className="mt-2 text-sm" role="status">
          GitHub is linked to {visible.email}.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Add GitHub as a sign-in method for {visible?.email ?? "your verified account"}. Your
            existing account and data stay together.
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-sm">
              GitHub linking could not be confirmed. Sign in again or retry loading this account’s
              settings.
            </p>
          ) : null}
          {error ? (
            <Button
              variant="outline"
              className="mt-3"
              disabled={busy}
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry settings
            </Button>
          ) : (
            <Button
              variant="outline"
              className="mt-3"
              disabled={!visible || busy}
              onClick={() => void link()}
            >
              {busy ? "Connecting…" : "Add GitHub sign-in"}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
