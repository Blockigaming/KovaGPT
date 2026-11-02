import { useEffect, useRef, useState } from "react";
import { Globe2, LockKeyhole, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestWorkSync } from "@/lib/work-sync-client";
import { createWorkViewLifetime } from "@/lib/work-view-lifetime.mjs";
import {
  cloudBrowserOrigin,
  parseCloudBrowserRules,
  type CloudBrowserRules,
} from "@/lib/cloud-browser-rules.mjs";

type Readiness = {
  available: boolean;
  origins: string[];
  siteRulesEnforced?: boolean;
  publicWeb?: boolean;
};
export function CloudBrowserSettings({ ownerId }: { ownerId: string }) {
  const [rules, setRules] = useState<CloudBrowserRules>({ sites: [] });
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [site, setSite] = useState("");
  const [access, setAccess] = useState<"ask" | "block">("ask");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const lifetime = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const endpoint = `/api/work/browser?scope=permissions&expectedUserId=${encodeURIComponent(ownerId)}`;
  useEffect(() => {
    const active = createWorkViewLifetime(ownerId, () => {
      setRules({ sites: [] });
      setReadiness(null);
      setLoaded(false);
      setSite("");
      setMessage("");
      setError("");
    });
    lifetime.current = active.controller;
    setLoaded(false);
    setRules({ sites: [] });
    setReadiness(null);
    setMessage("");
    setError("");
    void requestWorkSync(ownerId, endpoint, active.controller.signal)
      .then((value) => {
        if (active.controller.signal.aborted) return;
        const response = value as { rules: unknown; readiness: Readiness };
        setRules(parseCloudBrowserRules(response.rules));
        setReadiness(response.readiness);
        setLoaded(true);
      })
      .catch(() => {
        if (!active.controller.signal.aborted)
          setError("Cloud Browser settings could not be loaded. Reopen this section to retry.");
      });
    return () => active.dispose();
  }, [ownerId, endpoint]);
  async function save(next: CloudBrowserRules) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || saving.current || !loaded) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = (await requestWorkSync(ownerId, endpoint, signal, {
        expectedUserId: ownerId,
        rules: next,
      })) as { rules: unknown };
      if (signal.aborted) return;
      setRules(parseCloudBrowserRules(response.rules));
      setSite("");
      setMessage("Permissions saved to your account.");
    } catch {
      if (!signal.aborted)
        setError(
          "Permissions were not confirmed saved. Reload this section before retrying; another settings change may have occurred.",
        );
    } finally {
      saving.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="space-y-6" aria-label="Cloud Browser settings">
      <div className="rounded-2xl border bg-muted/30 p-5 space-y-2">
        <h3 className="flex items-center gap-2 font-medium">
          <Globe2 className="size-4" />
          Cloud Browser
        </h3>
        <p className="text-sm text-muted-foreground">
          Browse websites in a private session. Review agent actions and take control when you need
          to sign in.
        </p>
        <p className="text-sm" role="status">
          {!readiness
            ? "Checking availability…"
            : readiness.available
              ? "Browser runner available"
              : "Browser runner unavailable. Browsing requires a configured, verified runner."}
        </p>
        {readiness?.available && (
          <p className="text-sm text-muted-foreground">
            {readiness.publicWeb
              ? "Public HTTPS browsing is enabled. Private network addresses remain blocked."
              : "Browsing is limited to the runner’s configured sites."}
          </p>
        )}
      </div>
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 font-medium">
          <ShieldCheck className="size-4" />
          Permissions
        </h3>
        <p className="text-sm text-muted-foreground">
          Site rules match an exact HTTPS domain. Subdomains have separate rules. Unlisted sites use
          Ask; each agent action still needs your approval.
        </p>
        {readiness && !readiness.siteRulesEnforced && (
          <p className="text-sm">
            This runner needs the site-rules update to enforce saved blocks. Block rules prevent new
            browser commands until that update is active.
          </p>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const origin = cloudBrowserOrigin(site.trim());
              void save(
                parseCloudBrowserRules({
                  sites: [
                    ...rules.sites.filter((item) => item.origin !== origin),
                    { origin, access },
                  ],
                }),
              );
            } catch {
              setError(
                "Enter an HTTPS domain such as https://example.com, without a page path. You can save up to 50 sites.",
              );
            }
          }}
        >
          <label className="min-w-0 flex-1 text-sm">
            Website
            <Input
              value={site}
              onChange={(event) => setSite(event.target.value)}
              placeholder="https://example.com"
              maxLength={512}
              disabled={!loaded || busy}
            />
          </label>
          <label className="text-sm">
            Rule
            <select
              className="block rounded-md border bg-background p-2"
              value={access}
              disabled={!loaded || busy}
              onChange={(event) => setAccess(event.target.value as "ask" | "block")}
            >
              <option value="ask">Ask</option>
              <option value="block">Block</option>
            </select>
          </label>
          <Button type="submit" disabled={!loaded || busy || !site.trim()}>
            Save site rule
          </Button>
        </form>
        <ul className="divide-y rounded-2xl border">
          {rules.sites.map((item) => (
            <li key={item.origin} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="break-all text-sm font-medium">{item.origin}</p>
                <p className="text-xs text-muted-foreground">
                  {item.access === "block" ? "Blocked" : "Ask before agent actions"}
                  {readiness && !readiness.publicWeb && !readiness.origins.includes(item.origin)
                    ? " · Outside the runner’s configured sites"
                    : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove rule for ${item.origin}`}
                disabled={busy}
                onClick={() =>
                  void save({ sites: rules.sites.filter((site) => site.origin !== item.origin) })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
          {loaded && !rules.sites.length && (
            <li className="p-4 text-sm text-muted-foreground">
              No custom site rules. Agent actions require approval.
            </li>
          )}
        </ul>
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="rounded-2xl border p-5 space-y-2">
        <h3 className="flex items-center gap-2 font-medium">
          <LockKeyhole className="size-4" />
          Sign-in and popups
        </h3>
        <p className="text-sm text-muted-foreground">
          Use Take over to enter passwords privately. Automation pauses while you have control.
          Return control when you are ready for the agent to use the signed-in session.
        </p>
        <p className="text-sm text-muted-foreground">
          Compatible browser images pause for popup and website confirmation requests. Downloads and
          device permission prompts remain blocked.
        </p>
      </div>
    </section>
  );
}
