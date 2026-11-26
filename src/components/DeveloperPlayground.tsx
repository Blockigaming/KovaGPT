import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Operation = "responses" | "images" | "embeddings";
type Model = { id: string; capability: string };
type Quote = {
  quoteToken: string;
  currency: string;
  maximumCharge: number;
  expiresAt: number;
  requestBody: string;
  requestKey: string;
  operation: Operation;
};

const capability: Record<Operation, string> = {
  responses: "chat",
  images: "image_generation",
  embeddings: "embeddings",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeError(value: unknown, status: number) {
  const code = record(record(value).error).code;
  return typeof code === "string" && /^developer_[a-z_]+$/.test(code)
    ? code.replaceAll("_", " ")
    : `API request failed (${status}).`;
}

export function DeveloperPlayground({ enabled }: { enabled: boolean }) {
  const [key, setKey] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [operation, setOperation] = useState<Operation>("responses");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [maxOutput, setMaxOutput] = useState("256");
  const [size, setSize] = useState("1024x1024");
  const [quality, setQuality] = useState("medium");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [output, setOutput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [dispatched, setDispatched] = useState(false);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, []);

  const resetQuote = () => {
    setQuote(null);
    setOutput("");
    setImages([]);
    setError("");
  };

  const request = async (
    path: "models" | "quotes" | Operation,
    controller: AbortController,
    body?: string,
    headers?: Record<string, string>,
  ) => {
    const response = await fetch(`/api/v1/${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key.trim()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body,
    });
    const value: unknown = await response.json();
    if (!response.ok) throw new Error(safeError(value, response.status));
    return value;
  };

  const perform = async (action: (controller: AbortController) => Promise<void>) => {
    if (active.current || !enabled) return;
    const controller = new AbortController();
    active.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 120_000);
    setBusy(true);
    setError("");
    try {
      await action(controller);
    } catch (cause) {
      if (mounted.current) {
        setError(
          controller.signal.aborted
            ? "Request canceled or timed out. If you submitted a paid request, check Logs before trying again."
            : cause instanceof Error
              ? cause.message
              : "API request could not be completed.",
        );
      }
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) active.current = null;
      if (mounted.current) setBusy(false);
    }
  };

  const loadModels = () =>
    perform(async (controller) => {
      resetQuote();
      setModel("");
      setModels([]);
      const result = record(await request("models", controller));
      const catalog = Array.isArray(result.data)
        ? result.data.flatMap((entry): Model[] => {
            const row = record(entry);
            return typeof row.id === "string" && typeof row.capability === "string"
              ? [{ id: row.id, capability: row.capability }]
              : [];
          })
        : [];
      if (!mounted.current || controller.signal.aborted) return;
      setModels(catalog);
      setModel(catalog.find((item) => item.capability === capability[operation])?.id ?? "");
      if (!catalog.length) setError("No approved models are available for this key.");
    });

  const eligible = models.filter((item) => item.capability === capability[operation]);
  const getQuote = () =>
    perform(async (controller) => {
      resetQuote();
      const input =
        operation === "responses"
          ? { model, input: prompt, max_output_tokens: Number(maxOutput), stream: false }
          : operation === "images"
            ? { model, prompt, size, quality, n: 1 }
            : { model, input: prompt };
      const requestBody = JSON.stringify(input);
      const result = record(
        await request("quotes", controller, JSON.stringify({ operation, input })),
      );
      if (
        typeof result.quoteToken !== "string" ||
        typeof result.currency !== "string" ||
        !/^[A-Z]{3}$/.test(result.currency) ||
        typeof result.maximumCharge !== "number" ||
        !Number.isFinite(result.maximumCharge) ||
        result.maximumCharge < 0 ||
        typeof result.expiresAt !== "number" ||
        result.expiresAt <= Date.now()
      )
        throw new Error("The server did not return a valid price quote.");
      if (!mounted.current || controller.signal.aborted) return;
      setQuote({
        quoteToken: result.quoteToken,
        currency: result.currency,
        maximumCharge: result.maximumCharge,
        expiresAt: result.expiresAt,
        operation,
        requestBody,
        requestKey: crypto.randomUUID(),
      });
    });

  const run = () => {
    const accepted = quote;
    if (!accepted || dispatched || busy) return;
    if (accepted.expiresAt <= Date.now()) {
      setQuote(null);
      setError("Quote expired. Request a new quote.");
      return;
    }
    setDispatched(true);
    setQuote(null);
    void perform(async (controller) => {
      const result = await request(accepted.operation, controller, accepted.requestBody, {
        "X-Kova-Quote": accepted.quoteToken,
        "Idempotency-Key": accepted.requestKey,
      });
      if (!mounted.current || controller.signal.aborted) return;
      if (accepted.operation === "images") {
        const data = record(result).data;
        const previews = Array.isArray(data)
          ? data.flatMap((item): string[] => {
              const encoded = record(item).b64_json;
              return typeof encoded === "string" &&
                encoded.length <= 30_000_000 &&
                /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) &&
                encoded.startsWith("iVBOR")
                ? [`data:image/png;base64,${encoded}`]
                : [];
            })
          : [];
        setImages(previews);
        setOutput(
          previews.length
            ? "Image generation completed."
            : "Image response received. This playground only previews PNG image data; use your server integration for other response formats.",
        );
      } else {
        setOutput(JSON.stringify(result, null, 2));
      }
    });
  };

  return (
    <section className="min-w-0 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Playground</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Test approved text, image and embedding models with your scoped API key. Every paid run
          requires a fresh signed quote and explicit confirmation.
        </p>
      </header>
      {!enabled && (
        <p role="status" className="rounded-lg border border-border p-3 text-sm">
          Paid API execution is not enabled.
        </p>
      )}
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-5 rounded-[var(--kova-radius-panel)] border border-border p-4 sm:p-6">
          <label className="block space-y-1 text-sm">
            <span>API key</span>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              disabled={busy || !enabled}
              value={key}
              onChange={(event) => {
                setKey(event.target.value);
                setModels([]);
                setModel("");
                setDispatched(false);
                resetQuote();
              }}
              placeholder="kova_…"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            The key is held only in this mounted playground. Never paste it into a third-party
            website or application.
          </p>
          <Button
            variant="outline"
            disabled={!enabled || busy || !key.trim()}
            onClick={() => void loadModels()}
          >
            Load available models
          </Button>
          <label className="block space-y-1 text-sm">
            <span>Service</span>
            <select
              className="block min-h-11 w-full min-w-0 rounded-full border border-input bg-background px-4 text-base md:text-sm"
              value={operation}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value as Operation;
                setOperation(next);
                setModel(models.find((item) => item.capability === capability[next])?.id ?? "");
                setDispatched(false);
                resetQuote();
              }}
            >
              <option value="responses">Text responses</option>
              <option value="images">Image generation</option>
              <option value="embeddings">Embeddings</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>Model</span>
            <select
              className="block min-h-11 w-full min-w-0 rounded-full border border-input bg-background px-4 text-base md:text-sm"
              value={model}
              disabled={busy}
              onChange={(event) => {
                setModel(event.target.value);
                setDispatched(false);
                resetQuote();
              }}
            >
              <option value="">Select an available model</option>
              {eligible.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>{operation === "images" ? "Image prompt" : "Input"}</span>
            <Textarea
              rows={6}
              className="w-full min-w-0 resize-y"
              disabled={busy}
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                setDispatched(false);
                resetQuote();
              }}
            />
          </label>
          {operation === "responses" && (
            <label className="block space-y-1 text-sm">
              <span>Maximum output tokens</span>
              <Input
                type="number"
                min={1}
                max={32768}
                value={maxOutput}
                disabled={busy}
                onChange={(event) => {
                  setMaxOutput(event.target.value);
                  setDispatched(false);
                  resetQuote();
                }}
              />
            </label>
          )}
          {operation === "images" && (
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <label className="block space-y-1 text-sm">
                <span>Size</span>
                <select
                  className="block min-h-11 w-full min-w-0 rounded-full border border-input bg-background px-4 text-base md:text-sm"
                  value={size}
                  disabled={busy}
                  onChange={(event) => {
                    setSize(event.target.value);
                    setDispatched(false);
                    resetQuote();
                  }}
                >
                  {["1024x1024", "1024x1536", "1536x1024"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1 text-sm">
                <span>Quality</span>
                <select
                  className="block min-h-11 w-full min-w-0 rounded-full border border-input bg-background px-4 text-base md:text-sm"
                  value={quality}
                  disabled={busy}
                  onChange={(event) => {
                    setQuality(event.target.value);
                    setDispatched(false);
                    resetQuote();
                  }}
                >
                  {["low", "medium", "high"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!enabled || busy || !model || !prompt.trim() || dispatched}
              onClick={() => void getQuote()}
            >
              Get price quote
            </Button>
            {busy && (
              <Button variant="outline" onClick={() => active.current?.abort()}>
                Cancel request
              </Button>
            )}
            {dispatched && !busy && (
              <Button
                variant="outline"
                onClick={() => {
                  setDispatched(false);
                  resetQuote();
                }}
              >
                Start another request
              </Button>
            )}
          </div>
          {quote && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">
                Maximum charge: {quote.maximumCharge} {quote.currency} minor units
              </p>
              <p className="text-xs text-muted-foreground">
                Expires at {new Date(quote.expiresAt).toLocaleTimeString()}. Actual settled charges
                may be lower.
              </p>
              <Button disabled={busy || !enabled} onClick={run}>
                Confirm and run paid request
              </Button>
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-5 rounded-[var(--kova-radius-panel)] border border-border p-4 sm:p-6">
          <h2 className="font-semibold">Response</h2>
          {error && (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          )}
          {busy && (
            <p role="status" className="text-sm text-muted-foreground">
              Request in progress…
            </p>
          )}
          {images.map((src, index) => (
            <img
              key={index}
              src={src}
              alt={`Generated image ${index + 1}`}
              className="h-auto max-w-full rounded-lg"
            />
          ))}
          {output ? (
            <pre className="max-h-[32rem] max-w-full overflow-auto whitespace-pre-wrap break-all rounded-[var(--kova-radius-output)] bg-muted/40 p-4 text-xs">
              {output}
            </pre>
          ) : (
            !busy &&
            !error && (
              <p className="text-sm text-muted-foreground">Your response will appear here.</p>
            )
          )}
          {dispatched && (
            <p className="text-xs text-muted-foreground">
              Check request logs for confirmed settlement before repeating a paid request,
              especially after an error.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
