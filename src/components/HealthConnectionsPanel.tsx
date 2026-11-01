import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import { connectionAuthorizationUrl } from "@/integrations/connection-flows.mjs";
import { HEALTH_PROVIDERS, type HealthProviderId } from "@/health/providers.mjs";
import type { HealthSummary } from "@/health/health-read.server.mjs";
import type { AccountStatus } from "@/hooks/use-connected-accounts";

export function HealthConnectionsPanel({
  ownerId,
  data,
  loading,
  error,
  reload,
}: {
  ownerId: string | null;
  data: AccountStatus | null;
  loading: boolean;
  error: boolean;
  reload: () => Promise<boolean>;
}) {
  const [busy, setBusyState] = useState(false);
  const running = useRef(false);
  const setBusy = (value: boolean) => {
    running.current = value;
    setBusyState(value);
  };
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<HealthSummary | null>(null);
  const [disconnect, setDisconnect] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const request = (url: string, body: object) =>
    fetchWithTimeoutAuthenticated(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Kova-Expected-Owner": ownerId ?? "" },
        body: JSON.stringify(body),
      },
      45_000,
    );
  const connect = async (provider: HealthProviderId) => {
    if (running.current || !ownerId) return;
    setBusy(true);
    setMessage("");
    setResult(null);
    try {
      const response = await request("/api/integrations/oauth/start", {
        provider,
        optionalScopes: HEALTH_PROVIDERS[provider].scopes,
        returnPath: "/apps",
      });
      const body = await response.json();
      const url = connectionAuthorizationUrl(provider, body.url);
      if (!response.ok || !url) throw new Error();
      if (active.current) window.location.assign(url);
    } catch {
      if (active.current)
        setMessage("This health connection could not be started. Try again later.");
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const read = async (accountId: string) => {
    if (running.current) return;
    setBusy(true);
    setResult(null);
    setMessage("");
    try {
      const response = await request("/api/health-data/read", { accountId });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.summaries)) throw new Error();
      if (active.current) setResult(body);
    } catch {
      if (active.current)
        setMessage(
          "Health summaries could not be read. Check provider access, refresh status or reconnect.",
        );
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const remove = async () => {
    if (!disconnect || running.current) return;
    setBusy(true);
    setResult(null);
    setMessage("");
    try {
      const response = await request("/api/integrations/oauth/disconnect", {
        accountId: disconnect,
      });
      const body = await response.json();
      if (!response.ok) throw new Error();
      if (active.current) {
        setMessage(
          body.providerRevoked
            ? "Health account disconnected and access revoked."
            : "Health account disconnected from Kova. Remove Kova access in the provider's account settings to complete remote revocation.",
        );
        await reload();
      }
    } catch {
      if (active.current)
        setMessage("Disconnect could not be confirmed. Refresh status before retrying.");
    } finally {
      if (active.current) {
        setBusy(false);
        setDisconnect(null);
      }
    }
  };
  return (
    <section
      className="mt-6 rounded-2xl border border-border p-5 space-y-4"
      aria-labelledby="health-connections-title"
    >
      <h2 id="health-connections-title" className="text-lg font-semibold">
        Health accounts
      </h2>
      <p className="text-sm text-muted-foreground">
        Choose a provider and review its permissions. Summaries are fetched only when you click Read
        summaries. They are not added to chat or saved to your search index.
      </p>
      {!ownerId ? (
        <p>Sign in to manage health connections.</p>
      ) : (
        <>
          {loading && <p role="status">Checking health accounts…</p>}
          {error && <p role="status">Health account status is unavailable.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              Object.entries(HEALTH_PROVIDERS) as [
                HealthProviderId,
                (typeof HEALTH_PROVIDERS)[HealthProviderId],
              ][]
            ).map(([id, provider]) => {
              const configured =
                data?.configuredProviders.some((entry) => entry.id === id) === true;
              const accounts = data?.accounts.filter((account) => account.provider_id === id) ?? [];
              return (
                <div key={id} className="rounded-xl border border-border p-4 space-y-3">
                  <h3 className="font-medium">{provider.label}</h3>
                  <p className="text-sm text-muted-foreground">
                    Sleep, recovery and activity summaries. Basic profile access identifies the
                    account.
                  </p>
                  {!loading && !error && !configured && (
                    <p className="w-fit rounded-full bg-amber-500/10 px-3 py-1 text-sm text-amber-700 dark:text-amber-300">
                      Coming soon
                    </p>
                  )}
                  <Button
                    variant="outline"
                    disabled={!configured || busy || loading || error}
                    onClick={() => void connect(id)}
                  >
                    Connect {provider.label}
                  </Button>
                  {accounts.map((account, index) => (
                    <div key={account.id} className="space-y-2 border-t border-border pt-3">
                      <p>
                        {provider.label} account {index + 1} ·{" "}
                        {account.status === "connected" ? "Connected" : "Reconnect required"}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          disabled={
                            busy ||
                            !configured ||
                            error ||
                            loading ||
                            account.status !== "connected"
                          }
                          onClick={() => void read(account.id)}
                        >
                          Read {provider.label} summaries
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => setDisconnect(account.id)}
                        >
                          Disconnect {provider.label} {index + 1}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <Button variant="outline" disabled={busy || loading} onClick={() => void reload()}>
            Refresh health status
          </Button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">Working…</p>}
      {result && (
        <div className="space-y-3">
          <p>
            Fetched {new Date(result.fetchedAt).toLocaleString()}. Scores follow the provider's own
            scale.
          </p>
          {result.missing.length > 0 && (
            <p>
              Access is missing for: {result.missing.join(", ")}. Reconnect to review permissions.
            </p>
          )}
          {result.limited && <p>A limited page of summaries is shown.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="text-left font-medium mb-2">
                Recent {result.provider === "oura" ? "Oura" : "WHOOP"} summaries
              </caption>
              <thead>
                <tr>
                  <th className="p-2">Date</th>
                  <th className="p-2">Summary</th>
                  <th className="p-2">Value</th>
                </tr>
              </thead>
              <tbody>
                {result.summaries.map((summary, index) => (
                  <tr key={index}>
                    <td className="p-2 whitespace-nowrap">{summary.date ?? "Unavailable"}</td>
                    <td className="p-2 capitalize">{summary.metric}</td>
                    <td className="p-2">
                      {summary.score === null
                        ? "Not scored yet"
                        : `${summary.score} ${summary.scoreUnit}`}
                      {summary.steps !== null && ` · ${summary.steps} steps`}
                      {summary.restingHeartRate !== null &&
                        ` · resting heart rate ${summary.restingHeartRate} bpm`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!result.summaries.length && <p>No summaries are available for the last seven days.</p>}
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        <span className="rounded-full bg-amber-500/10 px-3 py-1 text-amber-700 dark:text-amber-300">
          Coming soon
        </span>{" "}
        Apple Health and Android Health Connect require a mobile app. Other wearables and
        medical-record services are not connected here.
      </p>
      <ConfirmActionDialog
        open={disconnect !== null}
        onOpenChange={(open) => !busy && !open && setDisconnect(null)}
        title="Disconnect this health account?"
        description="This removes the saved Kova connection. Provider access is revoked when supported; any remaining step will be shown afterward."
        confirmLabel="Disconnect health account"
        disabled={busy}
        onConfirm={() => void remove()}
      />
    </section>
  );
}
