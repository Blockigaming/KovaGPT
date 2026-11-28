import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@tanstack/react-router";
import { resourceConsoleKey } from "@/lib/pricing/developer-resource-console.mjs";
import {
  developerCatalogRows,
  filterDeveloperCatalog,
} from "@/lib/pricing/developer-model-catalog.mjs";

export function DeveloperModelCatalog({ enabled, keys }: { enabled: boolean; keys: string[] }) {
  const [secret, setSecret] = useState("");
  const [query, setQuery] = useState("");
  const [capability, setCapability] = useState("");
  const [catalog, setCatalog] = useState<ReturnType<typeof developerCatalogRows> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const token = resourceConsoleKey(secret, keys);
  useEffect(() => {
    setCatalog(null);
    setCapability("");
    active.current?.abort();
    return () => active.current?.abort();
  }, [token, enabled]);
  async function load() {
    if (!enabled || !token || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    setCatalog(null);
    const timer = window.setTimeout(() => {
      if (!controller.signal.aborted) {
        setError("Model discovery timed out. Retry to check eligibility.");
        controller.abort();
      }
    }, 10000);
    try {
      const response = await fetch("/api/v1/models", {
        headers: { Authorization: "Bearer " + token },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok || !response.body)
        throw new Error("Model discovery unavailable for this key.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0,
        body = "";
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 262144) throw new Error("Catalog response exceeds display limit.");
          body += decoder.decode(part.value, { stream: true });
        }
        const result = developerCatalogRows(JSON.parse(body + decoder.decode()));
        if (!controller.signal.aborted) setCatalog(result);
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch {
      if (!controller.signal.aborted)
        setError("Could not verify model eligibility. Check the project key and retry.");
    } finally {
      window.clearTimeout(timer);
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  const rows = filterDeveloperCatalog(catalog?.rows ?? [], query, capability);
  return (
    <section className="min-w-0 space-y-5">
      <h1 className="text-2xl font-semibold">Models</h1>
      <p className="text-sm text-muted-foreground">
        Discover approved API contracts available to the selected project key. Discovery does not
        reserve funds or guarantee dispatch.
      </p>
      <label className="block space-y-1 text-sm">
        Project API key
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={secret}
          disabled={!enabled || busy}
          onChange={(e) => {
            setSecret(e.target.value);
            setCatalog(null);
            setError("");
          }}
        />
      </label>
      <Button disabled={!enabled || !token || busy} onClick={() => void load()}>
        {busy ? "Checking eligibility…" : "Refresh available models"}
      </Button>
      {!enabled && <p role="status">API execution is unavailable.</p>}
      {secret && !token && <p role="alert">Use an active key from this project.</p>}
      {error && <p role="alert">{error}</p>}
      {catalog && token && enabled && (
        <>
          <p role="status" className="break-all text-sm">
            Pricing version: {catalog.pricingVersion}. {rows.length} matching contracts.
          </p>
          <label className="block text-sm">
            Search models
            <Input value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label className="block text-sm">
            Capability
            <select
              className="block min-h-11 w-full rounded-lg border bg-background p-2"
              value={capability}
              onChange={(e) => setCapability(e.target.value)}
            >
              <option value="">All capabilities</option>
              {[...new Set(catalog.rows.map((row) => row.capability))].sort().map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          {!rows.length && <p>No matching approved contracts.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((row) => (
              <article
                key={row.id + ":" + row.capability}
                className="min-w-0 space-y-2 rounded-xl border p-4"
              >
                <h2 className="break-all font-semibold">{row.id}</h2>
                <p className="text-sm">{row.capability}</p>
                <details>
                  <summary className="cursor-pointer text-sm">Capability details</summary>
                  <dl className="space-y-1 text-sm">
                    <dt>Reasoning efforts</dt>
                    <dd>{row.reasoning_efforts.join(", ") || "Not offered"}</dd>
                    <dt>Web search</dt>
                    <dd>{row.web_search ? "Supported" : "Not offered"}</dd>
                    <dt>Inline images</dt>
                    <dd>{row.inline_image_input ? "Supported" : "Not offered"}</dd>
                    <dt>Image edits</dt>
                    <dd>{row.image_edits ? "Supported" : "Not offered"}</dd>
                  </dl>
                </details>
              </article>
            ))}
          </div>
        </>
      )}
      <Link to="/developers/$docSlug" params={{ docSlug: "models" }} className="underline">
        Model API documentation
      </Link>
    </section>
  );
}
