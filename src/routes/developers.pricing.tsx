import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { PublicPageView } from "@/components/public/PublicSite";
import { Button } from "@/components/ui/button";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import { createWorkViewLifetime } from "@/lib/work-view-lifetime.mjs";
type Draft = {
  id: string;
  kind: string;
  revision: number;
  payload_hash: string;
  canonical_payload?: string;
  status: string;
  result_id?: string;
};
export const Route = createFileRoute("/developers/pricing")({
  component: PricingAdministration,
  head: () => ({
    meta: [
      { title: "Pricing administration | KovaGPT" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
function PricingAdministration() {
  const { isSignedIn, user } = useUser();
  if (isSignedIn && user?.id) return <OwnedPricingAdministration key={user.id} ownerId={user.id} />;
  return (
    <PublicPageView
      eyebrow="Administration"
      title="Pricing administration"
      summary="Review developer pricing and credit offers."
    >
      <SignInButton mode="modal">
        <Button>Sign in</Button>
      </SignInButton>
    </PublicPageView>
  );
}
function OwnedPricingAdministration({ ownerId }: { ownerId: string }) {
  const [rows, setRows] = useState<Draft[]>([]),
    [selected, setSelected] = useState<Draft | null>(null);
  const [page, setPage] = useState(0),
    [hasMore, setHasMore] = useState(false),
    [kind, setKind] = useState("pricing");
  const [input, setInput] = useState("{}"),
    [reviewed, setReviewed] = useState(false),
    [reason, setReason] = useState("");
  const [preview, setPreview] = useState<unknown>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [cleared, setCleared] = useState(false);
  const life = useRef<ReturnType<typeof createWorkViewLifetime> | null>(null),
    newId = useRef(crypto.randomUUID()),
    sequence = useRef(0);
  const reset = () => {
    sequence.current++;
    setRows([]);
    setSelected(null);
    setInput("{}");
    setPreview(null);
    setReviewed(false);
    setReason("");
    setBusy(false);
    setCleared(true);
  };
  async function call(path: string, body?: Record<string, unknown>) {
    const signal = life.current?.controller.signal;
    if (!signal || signal.aborted) throw new Error("Reload this page to continue.");
    const response = await fetchWithTimeoutAuthenticated(`/api/admin/pricing${path}`, {
      signal,
      method: body ? "POST" : "GET",
      headers: {
        "X-Kova-Expected-User": ownerId,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? "Pricing administration is unavailable.");
    if (signal.aborted) throw new Error("This session changed.");
    return value;
  }
  async function load(nextPage: number) {
    const version = ++sequence.current;
    const value = await call(`?page=${nextPage}`);
    if (version !== sequence.current) return;
    setRows(value.drafts);
    setPage(nextPage);
    setHasMore(value.hasMore);
  }
  useEffect(() => {
    const sequenceRef = sequence;
    const lifetime = createWorkViewLifetime(ownerId, reset);
    life.current = lifetime;
    void load(0).catch((cause) => {
      if (!lifetime.controller.signal.aborted) setError(cause.message);
    });
    return () => {
      sequenceRef.current++;
      lifetime.dispose();
      life.current = null;
    };
    // The component is keyed by the authenticated principal; all requests share its abort lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);
  async function action(operation: string) {
    setBusy(true);
    setError("");
    const version = ++sequence.current;
    try {
      const body = {
        operation,
        id: selected?.id ?? newId.current,
        revision: selected?.revision ?? 0,
        hash: selected?.payload_hash ?? null,
        ...(operation === "save"
          ? { kind, proposal: JSON.parse(input) }
          : operation === "approve"
            ? { reviewedHash: reviewed ? selected?.payload_hash : null }
            : { reason }),
      };
      const value = await call("", body);
      if (version !== sequence.current) return;
      setSelected(value.draft);
      setPreview(value.preview?.quotes ?? null);
      setReviewed(false);
      if (value.draft.canonical_payload)
        setInput(JSON.stringify(JSON.parse(value.draft.canonical_payload), null, 2));
      await load(page);
    } catch (cause) {
      if (!life.current?.controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Could not confirm the change.");
    } finally {
      if (!life.current?.controller.signal.aborted) setBusy(false);
    }
  }
  async function select(row: Draft) {
    setBusy(true);
    setError("");
    setReviewed(false);
    const version = ++sequence.current;
    try {
      const value = await call(`?id=${row.id}`);
      if (version !== sequence.current) return;
      setSelected(value.draft);
      setKind(value.draft.kind);
      setInput(JSON.stringify(JSON.parse(value.draft.canonical_payload), null, 2));
      setPreview(value.preview?.quotes ?? null);
    } catch (cause) {
      if (!life.current?.controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Could not load the draft.");
    } finally {
      if (!life.current?.controller.signal.aborted) setBusy(false);
    }
  }
  const unchanged =
    selected?.canonical_payload &&
    JSON.stringify(JSON.parse(selected.canonical_payload)) ===
      (() => {
        try {
          return JSON.stringify(JSON.parse(input));
        } catch {
          return "";
        }
      })();
  return (
    <PublicPageView
      eyebrow="Administration"
      title="Pricing administration"
      summary="Save a proposal, review its exact terms, then approve it explicitly. Only configured administrators have access."
    >
      <div className="space-y-6">
        <p>
          Amounts use the currency’s minor units. Approval makes these terms eligible for a
          separately enabled billing runtime. Tax treatment, source evidence, reserves and
          commercial rates require owner review.
        </p>
        {error && <p role="alert">{error}</p>}
        {cleared ? (
          <p>Saved browser data was cleared. Reload this page to reopen administration.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => {
                  newId.current = crypto.randomUUID();
                  setSelected(null);
                  setInput("{}");
                  setPreview(null);
                  setReviewed(false);
                  setReason("");
                }}
              >
                New proposal
              </Button>
              <Button
                disabled={busy || page === 0}
                variant="outline"
                onClick={() => void load(page - 1).catch((e) => setError(e.message))}
              >
                Previous
              </Button>
              <Button
                disabled={busy || !hasMore}
                variant="outline"
                onClick={() => void load(page + 1).catch((e) => setError(e.message))}
              >
                Next
              </Button>
            </div>
            <ul className="space-y-2">
              {rows.map((row) => (
                <li key={row.id}>
                  <Button variant="outline" disabled={busy} onClick={() => void select(row)}>
                    {row.kind} · {row.status} · revision {row.revision} · {row.id.slice(0, 8)}
                  </Button>
                </li>
              ))}
            </ul>
            <label className="block">
              Proposal type
              <select
                className="ml-3 rounded border bg-background p-2"
                disabled={busy || !!selected}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="pricing">Developer pricing</option>
                <option value="credit_offer">Prepaid credit offer</option>
              </select>
            </label>
            <label className="block" htmlFor="pricing-proposal">
              Proposal JSON
            </label>
            <textarea
              id="pricing-proposal"
              className="min-h-80 w-full rounded border bg-background p-3 font-mono text-sm"
              maxLength={131072}
              disabled={busy || (!!selected && selected.status !== "draft")}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setReviewed(false);
              }}
              spellCheck={false}
            />
            <Button
              disabled={busy || (!!selected && selected.status !== "draft")}
              onClick={() => void action("save")}
            >
              Validate and save draft
            </Button>
            {selected && (
              <div className="space-y-3 rounded border p-4">
                <p>
                  Status: {selected.status} · Revision {selected.revision}
                </p>
                <p className="break-all font-mono text-sm">
                  Review SHA-256: {selected.payload_hash}
                </p>
                {preview !== null && (
                  <pre className="overflow-auto text-sm">{JSON.stringify(preview, null, 2)}</pre>
                )}
                {selected.status === "draft" && (
                  <>
                    <label className="flex gap-2">
                      <input
                        type="checkbox"
                        checked={reviewed}
                        disabled={busy || !unchanged}
                        onChange={(e) => setReviewed(e.target.checked)}
                      />
                      I reviewed these exact terms, source evidence and tax treatment, and authorize
                      their use.
                    </label>
                    <Button
                      disabled={busy || !reviewed || !unchanged}
                      onClick={() => void action("approve")}
                    >
                      Approve this exact revision
                    </Button>
                  </>
                )}
                {selected.status === "approved" && (
                  <>
                    <label className="block">
                      Retirement reason
                      <input
                        className="mt-1 w-full rounded border bg-background p-2"
                        value={reason}
                        maxLength={500}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <Button
                      variant="outline"
                      disabled={busy || reason.trim().length < 8}
                      onClick={() => void action("retire")}
                    >
                      Retire these terms
                    </Button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </PublicPageView>
  );
}
