import { z } from "zod";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import { LAUNCH_CONNECTORS, type LaunchConnectorId } from "@/integrations/launch-contracts.mjs";
import type {
  LaunchManagement,
  LaunchAccountMetadata,
} from "@/integrations/launch-management.server.mjs";

const metadataSchema = z.object({
  connector: z.string(),
  certified: z.boolean(),
  nextCursor: z.string().uuid().nullable(),
  accounts: z
    .array(
      z.object({
        id: z.string().uuid(),
        label: z.string().max(200),
        identity: z.string().max(200),
        status: z.string().max(80),
        scopes: z.array(z.string().max(300)).max(100),
        expiresAt: z.string().nullable(),
        lastSuccessAt: z.string().nullable(),
      }),
    )
    .max(20),
});
const buttonClass = "min-h-11 rounded-lg border px-3 text-sm disabled:opacity-50";
/** Parent keys this component by principal and provider; unmount fences all acknowledgements. */
export function LaunchConnectorManager({ connector }: { connector: LaunchConnectorId }) {
  const contract = LAUNCH_CONNECTORS[connector];
  const [data, setData] = useState<LaunchManagement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [removing, setRemoving] = useState<LaunchAccountMetadata | null>(null);
  const lifetime = useRef({
    active: true,
    pending: false,
    controller: null as AbortController | null,
  });
  const request = useCallback(
    async (body: Record<string, unknown>) => {
      const owner = lifetime.current;
      if (!owner.active || owner.pending) return;
      owner.pending = true;
      owner.controller = new AbortController();
      setBusy(true);
      setError(null);
      try {
        const response = await fetchWithTimeoutAuthenticated(
          `/api/integrations/launch/${connector}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: owner.controller.signal,
          },
        );
        if (!response.ok)
          throw new Error(
            "Connection request could not be confirmed. Refresh saved status before retrying.",
          );
        const result = await response.json();
        if (!owner.active) return;
        return result;
      } catch {
        if (owner.active)
          setError(
            "Connection request could not be confirmed. Refresh saved status before retrying.",
          );
      } finally {
        owner.pending = false;
        if (owner.active) setBusy(false);
      }
    },
    [connector],
  );
  const refresh = useCallback(
    async (cursor: string | null = null) => {
      const result = await request({ action: "status", cursor });
      if (!result || !lifetime.current.active) return;
      const parsed = metadataSchema.safeParse(result);
      if (!parsed.success || parsed.data.connector !== connector) {
        setError("Saved connection status could not be read.");
        return;
      }
      setData(parsed.data);
    },
    [connector, request],
  );
  useEffect(() => {
    const owner = { active: true, pending: false, controller: null as AbortController | null };
    lifetime.current = owner;
    void refresh();
    return () => {
      owner.active = false;
      owner.controller?.abort();
    };
  }, [refresh]);
  const connect = async () => {
    if (!consent || !data?.certified || error) return;
    const result = await request({ action: "connect", returnPath: "/apps" });
    if (!result || !lifetime.current.active) return;
    try {
      const url = new URL(result.url),
        expected = new URL(contract.authorize);
      if (
        url.origin !== expected.origin ||
        url.pathname !== expected.pathname ||
        url.username ||
        url.password ||
        url.hash
      )
        throw new Error();
      window.location.assign(url.toString());
    } catch {
      setError("Provider authorization could not be started safely.");
    }
  };
  const disconnect = async () => {
    if (!removing || error) return;
    const result = await request({ action: "disconnect", accountId: removing.id });
    if (!result || !lifetime.current.active) return;
    if (result.localDisconnected !== true) {
      setError("Disconnect is unconfirmed. Refresh saved status.");
      return;
    }
    setRemoving(null);
    setConsent(false);
    setNotice(
      result.providerRevoked === true
        ? "Disconnected locally. The provider confirmed revocation."
        : result.remoteStatus === "refresh_token_revoked_access_expiry_pending"
          ? "Disconnected locally. HubSpot confirmed refresh-token revocation; existing access tokens may remain valid until expiry. The HubSpot installation remains."
          : "Disconnected locally. Provider revocation is unconfirmed; remove this app’s access in the provider’s account settings.",
    );
    await refresh();
    if (lifetime.current.active && result.cleanupRecorded === false)
      setError("Local disconnect succeeded, but the cleanup receipt could not be saved.");
  };
  return (
    <section className="space-y-3 rounded-xl border p-3" aria-label={`${contract.name} accounts`}>
      <h3 className="font-medium">{contract.name} accounts</h3>
      <p className="text-xs text-muted-foreground">
        Read access only. Connecting does not authorize sends, uploads or record changes.
      </p>
      {!data?.certified && (
        <p className="text-sm">
          New connections are unavailable until this provider has been verified.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={buttonClass} disabled={busy} onClick={() => void refresh()}>
          Refresh saved status
        </button>
        {data?.nextCursor && (
          <button
            className={buttonClass}
            disabled={busy || !!removing}
            onClick={() => void refresh(data.nextCursor)}
          >
            Next accounts
          </button>
        )}
      </div>
      {data?.accounts.length === 0 && <p>No accounts on this loaded page.</p>}
      <ul className="space-y-3">
        {data?.accounts.map((account) => (
          <li key={account.id} className="rounded-lg border p-3">
            <p className="break-words font-medium">{account.label}</p>
            <p className="break-all text-xs">Provider identity: {account.identity}</p>
            <p className="text-xs">
              Saved status: {account.status}. Status refresh does not perform a provider health
              check.
            </p>
            <p className="break-words text-xs">
              Granted scopes: {account.scopes.join(", ") || "None reported"}
            </p>
            <p className="text-xs">Token expiry: {account.expiresAt || "Not reported"}</p>
            <p className="text-xs">
              Last successful read: {account.lastSuccessAt || "Not reported"}
            </p>
            <button
              className={`${buttonClass} mt-2`}
              disabled={busy || !!error}
              onClick={() => setRemoving(account)}
            >
              Disconnect {account.label}
            </button>
          </li>
        ))}
      </ul>
      {removing && (
        <div className="space-y-2 rounded-lg border p-3">
          <p>
            Disconnect {removing.label} ({removing.identity})? This stops future use in KovaGPT.
            Provider-side access may require a separate removal step.
          </p>
          <button
            className={buttonClass}
            disabled={busy || !!error}
            onClick={() => void disconnect()}
          >
            Confirm disconnect
          </button>{" "}
          <button className={buttonClass} disabled={busy} onClick={() => setRemoving(null)}>
            Cancel
          </button>
        </div>
      )}
      <p className="break-words text-xs">
        Requested permissions:{" "}
        {contract.scopes.join(", ") || "Read content on pages shared with this integration"}
      </p>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy || !data?.certified}
          onChange={(event) => setConsent(event.target.checked)}
        />
        I agree to continue to {contract.name} to choose an account and review read access.
      </label>
      <button
        className={buttonClass}
        disabled={busy || !!error || !consent || !data?.certified}
        onClick={() => void connect()}
      >
        Connect or reconnect {contract.name}
      </button>
    </section>
  );
}
