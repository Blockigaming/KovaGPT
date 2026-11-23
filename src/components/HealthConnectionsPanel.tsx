import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Activity, Heart } from "lucide-react";
import { APPLE_HEALTH_METRICS } from "@/health/apple-health-metrics.mjs";
import type { AppleHealthAnalytics } from "@/health/apple-health-export.mjs";
import { NativeHealthReport, HealthTrends } from "@/components/AppleHealthReport";
import { useNativeHealthLive, type NativeHealthLive } from "@/health/use-apple-health-live";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import { connectionAuthorizationUrl } from "@/integrations/connection-flows.mjs";
import { OURA_METRICS, OURA_SCOPES } from "@/health/oura-metrics.mjs";
import type { OuraAnalytics } from "@/health/oura-analytics.server.mjs";
import type { AccountStatus } from "@/hooks/use-connected-accounts";

const exampleDays = ["10", "11", "12", "13", "14", "15", "16"];
const exampleHealth: AppleHealthAnalytics = {
  asOf: "2026-11-16",
  metrics: Object.fromEntries(
    Object.entries({
      StepCount: [6450, 8920, 7200, 9200, 10350, 8100, 8750],
      SleepAnalysis: [7.2, 7.9, 6.8, 7.5, 8.2, 7.8, 7.6],
      HeartRate: [72, 69, 74, 70, 71, 68, 70],
    }).map(([id, values]) => [
      id,
      [
        {
          name: "Example",
          days: values.map((value, index) => ({ date: "2026-11-" + exampleDays[index], value })),
        },
      ],
    ]),
  ),
};

const refreshInterval = 5 * 60_000;

function OuraDashboard({
  ownerId,
  accountId,
  onReport,
}: {
  ownerId: string;
  accountId: string;
  onReport: (report: AppleHealthAnalytics | null) => void;
}) {
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

  useEffect(() => {
    onReport(report);
  }, [onReport, report]);
  useEffect(() => () => onReport(null), [onReport]);

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
          {!Object.keys(report.metrics).length && (
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
  manageOura,
  onReport,
  setChooserOpen,
  nativeHealth,
  selectNativeHealth,
}: {
  ownerId: string | null;
  data: AccountStatus | null;
  loading: boolean;
  error: boolean;
  reload: () => Promise<boolean>;
  visible: boolean;
  manageOura: boolean;
  setChooserOpen: (open: boolean) => void;
  nativeHealth: NativeHealthLive;
  selectNativeHealth: () => void;
  onReport: (report: AppleHealthAnalytics | null) => void;
}) {
  const [showManagement, setShowManagement] = useState(manageOura);
  useEffect(() => {
    if (visible && manageOura) setShowManagement(true);
  }, [manageOura, visible]);
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
    <>
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogTitle>Connect Health</DialogTitle>
        <DialogDescription>Choose where your health data comes from.</DialogDescription>
        <div className="grid gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-12 w-full justify-between rounded-xl px-3 py-2 text-left"
            disabled={pending || loading || error || !ownerId || !configured}
            onClick={() => {
              if (connected) {
                setShowManagement(true);
                setChooserOpen(false);
              } else void update("connect");
            }}
          >
            <span className="flex items-center gap-2">
              <Activity className="size-4" aria-hidden="true" />
              Oura
            </span>
            {configured ? (connected ? "Connected" : "Connect") : "Unavailable"}
          </Button>
          {[
            { platform: "apple", label: "Apple Health" },
            { platform: "android", label: "Android Health Connect" },
          ].map(({ platform, label }) => {
            const name = (
              <span className="flex items-center gap-2 font-medium">
                <Heart className="size-4 text-rose-500" aria-hidden="true" />
                {label}
              </span>
            );
            return nativeHealth.platform === platform && ownerId ? (
              <Button
                key={platform}
                type="button"
                variant="outline"
                className="h-auto min-h-12 w-full justify-between rounded-xl px-3 py-2 text-left"
                onClick={selectNativeHealth}
              >
                {name}
                {nativeHealth.report
                  ? "Connected"
                  : nativeHealth.connected || nativeHealth.pending
                    ? "Manage"
                    : "Connect"}
              </Button>
            ) : (
              <div
                key={platform}
                className="flex min-h-12 flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-sm"
              >
                {name}
                <span className="text-muted-foreground">
                  {platform === "android" ? "Requires Android app" : "Requires iPhone app"}
                </span>
              </div>
            );
          })}
        </div>
        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </DialogContent>
      <section hidden={!showManagement} className="space-y-4" aria-labelledby="oura-health-title">
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
          <OuraDashboard
            key={ownerId + ":" + account.id}
            ownerId={ownerId}
            accountId={account.id}
            onReport={onReport}
          />
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
    </>
  );
}

export function HealthConnectionsPanel({
  ownerId,
  visible = true,
  manageOura = false,
  data,
  loading,
  error,
  reload,
}: {
  ownerId: string | null;
  visible?: boolean;
  manageOura?: boolean;
  data: AccountStatus | null;
  loading: boolean;
  error: boolean;
  reload: () => Promise<boolean>;
}) {
  const [native, setNative] = useState<AppleHealthAnalytics | null>(null);
  const nativeHealth = useNativeHealthLive(visible ? ownerId : null);
  const [nativeOpen, setNativeOpen] = useState(false);
  const [oura, setOura] = useState<AppleHealthAnalytics | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const metrics = { ...native?.metrics, ...oura?.metrics };
  const asOf = [native?.asOf, oura?.asOf].filter(Boolean).sort().at(-1);
  const report = asOf && Object.keys(metrics).length ? { asOf, metrics } : null;
  return (
    <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
      <section
        className="kova-health-dashboard mx-auto w-full max-w-[680px] space-y-10 py-8 sm:space-y-14 sm:py-14"
        aria-labelledby="health-connections-title"
      >
        <header className="flex flex-col items-center gap-4 text-center">
          <span className="grid size-14 place-items-center rounded-full border border-border bg-card">
            <Heart className="size-6 text-rose-500" aria-hidden="true" />
          </span>
          <h2
            id="health-connections-title"
            className="text-xl font-semibold tracking-tight sm:text-2xl"
          >
            A new way to manage your health
          </h2>
          <p className="max-w-lg text-sm text-muted-foreground sm:text-base">
            See your activity, sleep, and heart trends in one place.
          </p>
          <DialogTrigger asChild>
            <Button type="button" className="rounded-full">
              Connect Health
            </Button>
          </DialogTrigger>
        </header>
        <section aria-label="Health trends" className="space-y-4">
          <div className="border-b border-border pb-3">
            <h3 className="font-semibold">Health trends</h3>
            {!report && <p className="text-xs text-muted-foreground">Example data</p>}
          </div>
          <HealthTrends
            key={report ? "connected" : "example"}
            report={report ?? exampleHealth}
            catalog={[...APPLE_HEALTH_METRICS, ...OURA_METRICS]}
          />
        </section>
        <OuraConnections
          ownerId={ownerId}
          data={data}
          loading={loading}
          error={error}
          reload={reload}
          visible={visible}
          manageOura={manageOura}
          onReport={setOura}
          setChooserOpen={setChooserOpen}
          nativeHealth={nativeHealth}
          selectNativeHealth={() => {
            setChooserOpen(false);
            setNativeOpen(true);
            if (!nativeHealth.pending && !nativeHealth.connected) nativeHealth.start();
          }}
        />
        {nativeHealth.platform && ownerId && (
          <details
            className="border-t border-border pt-3"
            open={nativeOpen}
            onToggle={(event) => setNativeOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer text-sm font-semibold">
              Manage health connections
            </summary>
            <NativeHealthReport ownerId={ownerId} live={nativeHealth} onReport={setNative} />
          </details>
        )}
      </section>
    </Dialog>
  );
}
