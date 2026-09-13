import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { discoveryApiRequest } from "@/lib/discovery/discovery-browser";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";
import {
  DISCOVERY_MODES,
  discoveryComparisonKey,
  localMapHandoff,
  type DiscoveryMode,
  type DiscoveryResult,
  type DiscoveryProduct,
  type DiscoveryVariant,
} from "@/lib/discovery/discovery-policy.mjs";
const labels = { web: "Web", images: "Images", shopping: "Shopping", local: "Local places" };
const external = {
  target: "_blank",
  rel: "noopener noreferrer",
  referrerPolicy: "no-referrer" as const,
};
function RemoteImage({ result }: { result: DiscoveryResult }) {
  const [loaded, setLoaded] = useState(false),
    [failed, setFailed] = useState(false);
  return (
    <div className="space-y-2">
      {loaded && !failed ? (
        <img
          src={result.imageUrl}
          alt={result.title}
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          loading="lazy"
          className="max-h-64 max-w-full rounded-lg object-contain"
          onError={() => setFailed(true)}
        />
      ) : null}
      {!loaded ? (
        <>
          <p className="text-xs text-muted-foreground">
            Loading this third-party image contacts its host. Your KovaGPT credentials and page
            referrer are not sent.
          </p>
          <Button variant="outline" onClick={() => setLoaded(true)}>
            Load image from {new URL(result.imageUrl!).hostname}
          </Button>
        </>
      ) : null}
      {failed ? (
        <p role="status">
          The host did not allow this image to load privately. Open the source page to view it.
        </p>
      ) : null}
    </div>
  );
}
const priceText = (v: DiscoveryVariant) =>
  v.price ? `${v.price.amount} ${v.price.currency}` : "Unknown";
const variantText = (v: DiscoveryVariant) =>
  [
    v.title,
    v.sku ? `SKU ${v.sku}` : "",
    v.id ? `ID ${v.id}` : "",
    ...Object.entries(v.values).map(([k, value]) => `${k}: ${value}`),
  ]
    .filter(Boolean)
    .join(" · ") || `Variant ${v.ordinal + 1} (no merchant identifier provided)`;
type Comparison = { key: string; product: DiscoveryProduct; variant: DiscoveryVariant };
export function DiscoveryWorkspace({ initialMode = "web" }: { initialMode?: DiscoveryMode }) {
  const { isLoaded, user } = useUser();
  const [privacyRevision, setPrivacyRevision] = useState(0);
  const userId = user?.id;
  useEffect(() => {
    const clear = (event: Event) => {
      if (userId && isPrincipalBrowserStorageClearedEvent(event, userId))
        setPrivacyRevision((value) => value + 1);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, clear);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, clear);
  }, [userId]);
  if (!isLoaded) return <p role="status">Loading your session…</p>;
  if (!user)
    return (
      <section className="space-y-4">
        <p>
          Search public web pages, image sources, products, and places using a location you enter.
        </p>
        <SignInButton>
          <Button>Sign in to search</Button>
        </SignInButton>
        <p className="text-sm text-muted-foreground">No location permission has been requested.</p>
      </section>
    );
  return (
    <DiscoverySession
      key={`${user.id}:${initialMode}:${privacyRevision}`}
      userId={user.id}
      initialMode={initialMode}
    />
  );
}
function DiscoverySession({ userId, initialMode }: { userId: string; initialMode: DiscoveryMode }) {
  const [mode, setMode] = useState(initialMode),
    [query, setQuery] = useState(""),
    [location, setLocation] = useState(""),
    [ready, setReady] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [results, setResults] = useState<DiscoveryResult[] | null>(null),
    [search, setSearch] = useState<{
      mode: DiscoveryMode;
      query: string;
      location: string;
      observedAt: string;
    } | null>(null),
    [products, setProducts] = useState<Record<string, DiscoveryProduct>>({}),
    [compared, setCompared] = useState<Comparison[]>([]);
  const active = useRef(true),
    requestVersion = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    let retired = false;
    const c = new AbortController(),
      timer = setTimeout(() => c.abort(), 15000);
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userId)) return;
      retired = true;
      active.current = false;
      requestVersion.current++;
      c.abort();
      controller.current?.abort();
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    void discoveryApiRequest(userId, c.signal)
      .then(({ response, data }) => {
        if (active.current && !c.signal.aborted) {
          setReady(response.ok && "enabled" in data && data.enabled === true);
          if (!response.ok)
            setError(
              "Search readiness could not be verified. Check your account and Lockdown settings, then reload.",
            );
        }
      })
      .catch(() => {
        if (active.current && !retired) {
          setReady(false);
          setError("Search readiness is temporarily unavailable. Reload to try again.");
        }
      })
      .finally(() => clearTimeout(timer));
    return () => {
      retired = true;
      active.current = false;
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
      c.abort();
      controller.current?.abort();
    };
  }, [userId]);
  async function request(input: unknown) {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    const version = ++requestVersion.current,
      timer = setTimeout(() => c.abort(), 25000);
    setBusy(true);
    setError("");
    try {
      const { response, data } = await discoveryApiRequest(userId, c.signal, input);
      if (!active.current || c.signal.aborted || version !== requestVersion.current) return null;
      if (!response.ok)
        throw new Error(
          data.error === "discovery_daily_limit"
            ? "The daily search request limit has been reached. Try again after midnight UTC."
            : data.error === "discovery_source_expired"
              ? "This source check expired. Search again before checking the merchant."
              : data.error === "discovery_page_unavailable"
                ? "The page is blocked, unavailable, or redirected to another site. Details remain unknown."
                : data.error === "discovery_disabled"
                  ? "Live discovery is not enabled for this deployment."
                  : "Search could not complete. Check your connection and Lockdown settings, then try again.",
        );
      return data;
    } catch (e) {
      if (active.current && version === requestVersion.current)
        setError(
          c.signal.aborted
            ? "Search cancelled. A provider request already sent may still count toward the daily limit."
            : e instanceof Error
              ? e.message
              : "Search failed.",
        );
      return null;
    } finally {
      clearTimeout(timer);
      if (active.current && version === requestVersion.current) setBusy(false);
    }
  }
  async function find() {
    setResults(null);
    setProducts({});
    setSearch(null);
    const data = await request({
      operation: "search",
      mode,
      query,
      location: mode === "local" ? location : "",
    });
    if (data?.operation === "search") {
      setResults(data.results);
      setSearch({
        mode: data.mode,
        query: data.query,
        location: data.location,
        observedAt: data.observedAt,
      });
    }
  }
  async function check(result: DiscoveryResult) {
    const data = await request({ operation: "product", sourceToken: result.sourceToken });
    if (data?.operation === "product") setProducts((p) => ({ ...p, [result.url]: data.product }));
  }
  function toggle(product: DiscoveryProduct, variant: DiscoveryVariant) {
    const key = discoveryComparisonKey(product, variant);
    setCompared((rows) =>
      rows.some((r) => r.key === key)
        ? rows.filter((r) => r.key !== key)
        : rows.length < 4
          ? [...rows, { key, product, variant }]
          : rows,
    );
  }
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Searching sends your query and any place you enter to the configured search provider.
        Results are source reports and can be incomplete or outdated. KovaGPT stores request counts,
        not your search text.
      </p>
      {ready === false ? (
        <p role="status" className="rounded-xl border p-4">
          Live discovery is not available here yet. You can prepare a query and use the external map
          handoff below.
        </p>
      ) : ready === null ? (
        <p role="status">Checking search availability…</p>
      ) : null}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-2 text-sm font-medium">Search type</legend>
          {DISCOVERY_MODES.map((value) => (
            <Button
              key={value}
              type="button"
              variant={mode === value ? "default" : "outline"}
              aria-pressed={mode === value}
              disabled={busy}
              onClick={() => {
                setMode(value);
                if (value !== "local") setLocation("");
              }}
            >
              {labels[value]}
            </Button>
          ))}
        </fieldset>
        <label className="block space-y-2">
          <span className="text-sm font-medium">
            {mode === "images" || mode === "shopping"
              ? "Describe the image or product you want to find"
              : "What are you looking for?"}
          </span>
          <input
            className="w-full rounded-lg border bg-background p-3"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={300}
            required
            placeholder={
              mode === "local"
                ? "Quiet cafes or restaurants"
                : mode === "shopping"
                  ? "Exact product, size, color, or model"
                  : "Search the public web"
            }
          />
        </label>
        {mode === "images" || mode === "shopping" ? (
          <p className="text-sm text-muted-foreground">
            For a product in a photo, ask chat to describe it, then paste the description here.
            Matching uses your text; it does not upload the photo or prove an exact visual match.{" "}
            <Link to="/" className="underline">
              Open chat
            </Link>
          </p>
        ) : null}
        {mode === "local" ? (
          <div className="space-y-2">
            <label className="block space-y-2">
              <span className="text-sm font-medium">
                City, neighborhood, or place (entered manually)
              </span>
              <input
                className="w-full rounded-lg border bg-background p-3"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={160}
                required
              />
            </label>
            <Button type="button" variant="ghost" onClick={() => setLocation("")}>
              Remove location
            </Button>
            <p className="text-xs text-muted-foreground">
              No location permission has been requested. Local results are web links, with external
              maps and reservation handoffs.
            </p>
            {query.trim() && location.trim() ? (
              <a
                href={localMapHandoff(query, location)}
                {...external}
                className="inline-block underline"
              >
                Open this search in Google Maps (shares the entered place)
              </a>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button
            disabled={!ready || busy || !query.trim() || (mode === "local" && !location.trim())}
          >
            {busy ? "Searching…" : "Search"}
          </Button>
          {busy ? (
            <Button type="button" variant="outline" onClick={() => controller.current?.abort()}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
      {error ? (
        <p role="alert" className="rounded-lg border p-3">
          {error}
        </p>
      ) : null}
      {search ? (
        <p role="status" className="text-sm text-muted-foreground">
          {labels[search.mode]} results for “{search.query}”
          {search.location ? ` near ${search.location}` : ""} · Retrieved{" "}
          {new Date(search.observedAt).toLocaleString()}. Snippets are not verified facts.
        </p>
      ) : null}
      {results?.length === 0 ? (
        <p role="status">No usable results returned. Refine the query or try another source.</p>
      ) : null}
      <div className="grid gap-4">
        {results?.map((result) => (
          <article
            key={`${result.url}:${result.imageUrl ?? ""}`}
            className="space-y-3 rounded-xl border p-5"
          >
            <div>
              <p className="text-xs text-muted-foreground">Source: {result.source}</p>
              <h2 className="text-lg font-semibold">
                <a href={result.url} {...external} className="underline underline-offset-4">
                  {result.title}
                </a>
              </h2>
            </div>
            {result.snippet ? <p className="text-sm">{result.snippet}</p> : null}
            {result.imageUrl ? <RemoteImage key={result.imageUrl} result={result} /> : null}
            {search?.mode === "local" ? (
              <div className="space-y-2 text-sm">
                <p>Hours, distance, availability, and reservation status are unverified.</p>
                <a href={result.url} {...external} className="underline">
                  Visit source for details or reservations
                </a>
              </div>
            ) : null}
            {search?.mode === "shopping" ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Merchant price, currency, and stock are unknown until checked. A check sends this
                  source URL to the search provider.
                </p>
                <Button
                  variant="outline"
                  disabled={busy || !ready}
                  onClick={() => void check(result)}
                >
                  Check merchant details
                </Button>
                {products[result.url] ? (
                  <ProductDetails
                    product={products[result.url]}
                    compared={compared}
                    toggle={toggle}
                  />
                ) : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {compared.length ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">
              Compare selected variants ({compared.length}/4)
            </h2>
            <Button variant="outline" onClick={() => setCompared([])}>
              Clear comparison
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Compare the exact variants and currencies shown. Prices may exclude shipping or tax; a
            source observation does not guarantee checkout price or stock.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {["Product / variant", "Price", "Stock report", "Checked", "Action"].map((t) => (
                    <th key={t} className="p-3">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compared.map((row) => (
                  <tr key={row.key} className="border-t">
                    <td className="p-3">
                      <a
                        href={row.product.url ?? row.product.sourceUrl}
                        {...external}
                        className="underline"
                      >
                        {row.product.title}
                      </a>
                      <p>{variantText(row.variant)}</p>
                      <p>{new URL(row.product.sourceUrl).hostname}</p>
                    </td>
                    <td className="p-3">{priceText(row.variant)}</td>
                    <td className="p-3">
                      {row.variant.inStock === null
                        ? "Unknown"
                        : row.variant.inStock
                          ? "In stock at check"
                          : "Out of stock at check"}
                    </td>
                    <td className="p-3">{new Date(row.product.observedAt).toLocaleString()}</td>
                    <td className="p-3">
                      <Button
                        variant="ghost"
                        onClick={() => setCompared((rows) => rows.filter((r) => r.key !== row.key))}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
function ProductDetails({
  product,
  compared,
  toggle,
}: {
  product: DiscoveryProduct;
  compared: Comparison[];
  toggle: (p: DiscoveryProduct, v: DiscoveryVariant) => void;
}) {
  if (product.status !== "observed")
    return (
      <p role="status">
        The source did not provide an unambiguous product with variants. Price and stock remain
        unknown.
      </p>
    );
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">
        {product.title}
        {product.brand ? ` · ${product.brand}` : ""}
      </h3>
      <p className="text-xs text-muted-foreground">
        Source:{" "}
        <a href={product.sourceUrl} {...external} className="underline">
          {new URL(product.sourceUrl).hostname}
        </a>{" "}
        · Checked {new Date(product.observedAt).toLocaleString()}. These are merchant-reported
        observations.
      </p>
      <ul className="space-y-2">
        {product.variants.map((v) => {
          const key = discoveryComparisonKey(product, v),
            selected = compared.some((row) => row.key === key);
          return (
            <li key={v.ordinal} className="rounded-lg border p-3">
              <p>{variantText(v)}</p>
              <p>
                Price: {priceText(v)} · Stock:{" "}
                {v.inStock === null
                  ? "Unknown"
                  : v.inStock
                    ? "In stock at check"
                    : "Out of stock at check"}
              </p>
              <Button
                variant="outline"
                className="mt-2"
                disabled={!selected && compared.length >= 4}
                onClick={() => toggle(product, v)}
              >
                {selected ? "Remove from comparison" : "Compare this variant"}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
