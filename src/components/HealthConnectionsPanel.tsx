import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppleHealthReport, HealthTrends } from "@/components/AppleHealthReport";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import { connectionAuthorizationUrl } from "@/integrations/connection-flows.mjs";
import { OURA_METRICS, OURA_SCOPES } from "@/health/oura-metrics.mjs";
import type { OuraAnalytics } from "@/health/oura-analytics.server.mjs";
import type { AccountStatus } from "@/hooks/use-connected-accounts";

const refreshInterval = 5 * 60_000;

function OuraDashboard({ ownerId, accountId }: { ownerId: string; accountId: string }) {
  const [report, setReport] = useState<OuraAnalytics | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    let attemptedAt = -Infinity;
    const read = async () => {
      if (
        document.visibilityState !== "visible" ||
        inFlight ||
        Date.now() - attemptedAt < refreshInterval
      )
        return;
      inFlight = true;
      attemptedAt = Date.now();
      try {
        const response = await fetchWithTimeoutAuthenticated(
          "/api/health-data/read",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Kova-Expected-Owner": ownerId },
            body: JSON.stringify({ accountId, mode: "analytics" }),
            signal: controller.signal,
          },
          42_000,
        );
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || !body.metrics || !Array.isArray(body.missing)) {
          if ([401, 403, 404, 409].includes(response.status)) setReport(null);
          setMessage(
            response.status === 401 || response.status === 403
              ? "Reconnect Oura to continue syncing."
              : "Oura could not refresh. We’ll try again while this tab is open.",
          );
          return;
        }
        setReport(body);
        setMessage("");
      } catch {
        if (!controller.signal.aborted)
          setMessage("Oura could not refresh. We’ll try again while this tab is open.");
      } finally {
        inFlight = false;
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), refreshInterval);
    const onVisibility = () => void read();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [accountId, ownerId]);

  return (
    <div className="space-y-4">
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {!report && !message && (
        <p role="status" className="text-sm text-muted-foreground">
          Syncing Oura…
        </p>
      )}
      {report && (
        <>
          <p className="text-xs text-muted-foreground">
            Checked{" "}
            {new Date(report.fetchedAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            · Refreshes as Oura syncs new readings
          </p>
          {report.missing.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Review Oura permissions to include more metrics.
            </p>
          )}
          {(report.limited || report.unavailable.length > 0) && (
            <p className="text-sm text-muted-foreground">
              Some Oura readings are temporarily unavailable.
            </p>
          )}
          {Object.keys(report.metrics).length ? (
            <HealthTrends report={report} catalog={OURA_METRICS} />
          ) : (
            <p className="text-sm text-muted-foreground">Waiting for readings from Oura.</p>
          )}
        </>
      )}
    </div>
  );
}

function OuraConnections({
  ownerId,
  data,
  loading,
  error,
  reload,
  visible,
}: {
  ownerId: string | null;
  data: AccountStatus | null;
  loading: boolean;
  error: boolean;
  reload: () => Promise<boolean>;
  visible: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [disconnect, setDisconnect] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const configured = data?.configuredProviders.some(({ id }) => id === "oura") === true;
  const accounts = data?.accounts.filter(({ provider_id }) => provider_id === "oura") ?? [];
  const account = accounts.find(({ id }) => id === selected) ?? accounts[0];
  const connected = account?.status === "connected";
  const needsPermissions =
    connected && OURA_SCOPES.some((scope) => !account.granted_scopes.includes(scope));

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

  async function update(action: "connect" | "disconnect") {
    if (pending || !ownerId) return;
    setPending(true);
    setMessage("");
    try {
      if (action === "connect") {
        const response = await request("/api/integrations/oauth/start", {
          provider: "oura",
          optionalScopes: OURA_SCOPES,
          returnPath: "/apps?connection_view=health&health_provider=oura",
        });
        const body = await response.json();
        const url = connectionAuthorizationUrl("oura", body.url);
        if (!response.ok || !url) throw new Error();
        window.location.assign(url);
        return;
      }
      const response = await request("/api/integrations/oauth/disconnect", {
        accountId: disconnect,
      });
      const body = await response.json();
      if (!response.ok) throw new Error();
      await reload();
      setMessage(
        body.providerRevoked
          ? "Oura disconnected."
          : "Oura disconnected from Kova. You can revoke access in Oura’s account settings.",
      );
      setDisconnect(null);
    } catch {
      setMessage(
        action === "connect"
          ? "Oura could not connect. Try again."
          : "Oura could not disconnect. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="oura-health-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="oura-health-title" className="text-lg font-semibold">
          Oura
        </h3>
        {accounts.length > 1 && (
          <select
            aria-label="Oura account"
            value={account?.id}
            onChange={(event) => setSelected(event.currentTarget.value)}
          >
            {accounts.map(({ id }, index) => (
              <option key={id} value={id}>
                Account {index + 1}
              </option>
            ))}
          </select>
        )}
        {account && (
          <details className="relative text-sm">
            <summary className="cursor-pointer text-muted-foreground">Connection options</summary>
            <div className="absolute top-full right-0 z-10 mt-2 grid min-w-52 gap-1 rounded-xl border border-border bg-popover p-1.5 shadow-md">
              <Button
                variant="ghost"
                className="justify-start"
                disabled={pending || !configured}
                onClick={() => void update("connect")}
              >
                Reconnect Oura
              </Button>
              <Button
                variant="ghost"
                className="justify-start"
                disabled={pending}
                onClick={() => setDisconnect(account.id)}
              >
                Disconnect Oura
              </Button>
            </div>
          </details>
        )}
      </div>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Checking Oura connection…
        </p>
      )}
      {error && (
        <p role="status" className="text-sm text-muted-foreground">
          Oura connection status is unavailable.
        </p>
      )}
      {ownerId && !loading && !error && !configured && (
        <p className="text-sm text-muted-foreground">Coming soon</p>
      )}
      {ownerId && !loading && !error && configured && (!connected || needsPermissions) && (
        <Button
          variant={connected ? "outline" : "default"}
          disabled={pending}
          onClick={() => void update("connect")}
        >
          {connected ? "Review Oura permissions" : account ? "Reconnect Oura" : "Connect Oura"}
        </Button>
      )}
      {visible && ownerId && configured && connected && (
        <OuraDashboard key={ownerId + ":" + account.id} ownerId={ownerId} accountId={account.id} />
      )}
      <ConfirmActionDialog
        open={disconnect !== null}
        onOpenChange={(open) => !pending && !open && setDisconnect(null)}
        title="Disconnect Oura?"
        description="This removes the Oura connection from Kova."
        confirmLabel="Disconnect Oura"
        disabled={pending}
        onConfirm={() => void update("disconnect")}
      />
    </section>
  );
}

export function HealthConnectionsPanel({
  ownerId,
  visible = true,
  data,
  loading,
  error,
  reload,
}: {
  ownerId: string | null;
  visible?: boolean;
  data: AccountStatus | null;
  loading: boolean;
  error: boolean;
  reload: () => Promise<boolean>;
}) {
  const [provider, setProvider] = useState("apple");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("health_provider") === "oura")
      setProvider("oura");
  }, []);
  return (
    <section
      className="kova-health-dashboard mx-auto w-full max-w-[680px] space-y-4 py-6 sm:py-10"
      aria-labelledby="health-connections-title"
    >
      <h2
        id="health-connections-title"
        className="text-xl font-semibold tracking-tight sm:text-2xl"
      >
        A new way to manage your health
      </h2>
      <Tabs value={provider} onValueChange={setProvider}>
        <TabsList aria-label="Health providers">
          <TabsTrigger value="apple">Apple Health</TabsTrigger>
          <TabsTrigger value="oura">Oura</TabsTrigger>
        </TabsList>
        <TabsContent
          value="apple"
          forceMount
          className="mt-4 rounded-2xl border border-border p-3 data-[state=inactive]:hidden sm:p-5"
        >
          <AppleHealthReport ownerId={ownerId} visible={visible && provider === "apple"} />
        </TabsContent>
        <TabsContent value="oura" className="mt-4 rounded-2xl border border-border p-3 sm:p-5">
          <OuraConnections
            ownerId={ownerId}
            data={data}
            loading={loading}
            error={error}
            reload={reload}
            visible={visible && provider === "oura"}
          />
        </TabsContent>
      </Tabs>
      {!ownerId && (
        <p className="text-sm text-muted-foreground">Sign in to manage your health connections.</p>
      )}
    </section>
  );
}
