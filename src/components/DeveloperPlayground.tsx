import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createDeveloperPlaygroundStream } from "@/lib/pricing/developer-playground-stream.mjs";
import { parseDeveloperPlaygroundOptions } from "@/lib/pricing/developer-playground-options.mjs";

type Operation =
  | "responses"
  | "streaming"
  | "images"
  | "embeddings"
  | "moderations"
  | "search"
  | "audio/transcriptions"
  | "audio/speech"
  | "analysis"
  | "browser";
type Model = {
  id: string;
  capability: string;
  reasoningEfforts: string[];
  inlineImageInput: boolean;
  imageEdits: boolean;
  webSearch: boolean;
};
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
  streaming: "streaming",
  images: "image_generation",
  embeddings: "embeddings",
  moderations: "moderation",
  "audio/transcriptions": "audio_transcription",
  "audio/speech": "audio_speech",
  search: "chat",
  analysis: "file_analysis",
  browser: "cloud_browser",
};

function eligibleModel(item: Model, operation: Operation) {
  return item.capability === capability[operation] && (operation !== "search" || item.webSearch);
}

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
  const [maxSearchCalls, setMaxSearchCalls] = useState("1");
  const [analysisFileIds, setAnalysisFileIds] = useState("");
  const [effort, setEffort] = useState("");
  const [advanced, setAdvanced] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const [size, setSize] = useState("1024x1024");
  const [quality, setQuality] = useState("medium");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [output, setOutput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [audio, setAudio] = useState<string | null>(null);
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
    setAudio(null);
    setError("");
  };

  const fetchRequest = async (
    path: "models" | "quotes" | Operation,
    controller: AbortController,
    body?: string,
    headers?: Record<string, string>,
  ) => {
    const endpoint = path === "streaming" ? "responses" : path;
    const response = await fetch(`/api/v1/${endpoint}`, {
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
    if (!response.ok) {
      const value: unknown = await response.json().catch(() => null);
      throw new Error(safeError(value, response.status));
    }
    return response;
  };

  const request = async (
    path: "models" | "quotes" | Operation,
    controller: AbortController,
    body?: string,
    headers?: Record<string, string>,
  ): Promise<unknown> => (await fetchRequest(path, controller, body, headers)).json();

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
      setEffort("");
      setAdvanced("");
      setMediaFile(null);
      if (mediaInput.current) mediaInput.current.value = "";
      const result = record(await request("models", controller));
      const catalog = Array.isArray(result.data)
        ? result.data.flatMap((entry): Model[] => {
            const row = record(entry);
            return typeof row.id === "string" && typeof row.capability === "string"
              ? [
                  {
                    id: row.id,
                    capability: row.capability,
                    inlineImageInput: row.inline_image_input === true,
                    imageEdits: row.image_edits === true,
                    webSearch: row.web_search === true,
                    reasoningEfforts: Array.isArray(row.reasoning_efforts)
                      ? row.reasoning_efforts.filter(
                          (effort): effort is string =>
                            typeof effort === "string" &&
                            ["none", "minimal", "low", "medium", "high", "xhigh"].includes(effort),
                        )
                      : [],
                  },
                ]
              : [];
          })
        : [];
      if (!mounted.current || controller.signal.aborted) return;
      setModels(catalog);
      setModel(catalog.find((item) => eligibleModel(item, operation))?.id ?? "");
      if (!catalog.length) setError("No approved models are available for this key.");
    });

  const eligible = models.filter((item) => eligibleModel(item, operation));
  const selectedModel = eligible.find((item) => item.id === model);
  const efforts = selectedModel?.reasoningEfforts ?? [];
  const textOperation = operation === "responses" || operation === "streaming";
  const acceptsImage = textOperation && selectedModel?.inlineImageInput === true;
  const acceptsEdit = operation === "images" && selectedModel?.imageEdits === true;
  const acceptsAudio = operation === "audio/transcriptions";
  const getQuote = () =>
    perform(async (controller) => {
      resetQuote();
      const extra = textOperation ? parseDeveloperPlaygroundOptions(advanced) : {};
      let responseInput: string | Record<string, unknown>[] = prompt;
      let sourceImage: string | undefined;
      let sourceAudio: string | undefined;
      if ((acceptsImage || acceptsEdit) && mediaFile) {
        if (mediaFile.type !== "image/png" || mediaFile.size < 1 || mediaFile.size > 32768)
          throw new Error("Select a PNG image of up to 32 KiB.");
        const bytes = new Uint8Array(await mediaFile.arrayBuffer());
        const dataUrl = "data:image/png;base64," + btoa(String.fromCharCode(...bytes));
        if (acceptsEdit) sourceImage = dataUrl;
        else
          responseInput = [
            {
              role: "user",
              content: [
                { type: "input_text", text: prompt },
                { type: "input_image", image_url: dataUrl, detail: "low" },
              ],
            },
          ];
      }
      if (acceptsAudio) {
        if (!mediaFile || mediaFile.size < 3244 || mediaFile.size > 640044)
          throw new Error("Select a WAV recording of 0.1–20 seconds (16 kHz mono PCM).");
        const bytes = new Uint8Array(await mediaFile.arrayBuffer());
        // Chunking avoids argument-count limits for larger audio recordings.
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 16384)
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
        sourceAudio = "data:audio/wav;base64," + btoa(binary);
      }
      const input = textOperation
        ? {
            model,
            input: responseInput,
            max_output_tokens: Number(maxOutput),
            stream: operation === "streaming",
            ...extra,
            ...(effort && efforts.includes(effort) ? { reasoning: { effort } } : {}),
          }
        : operation === "images"
          ? { model, prompt, size, quality, n: 1, ...(sourceImage ? { image: sourceImage } : {}) }
          : operation === "search"
            ? {
                model,
                query: prompt,
                max_output_tokens: Number(maxOutput),
                max_tool_calls: Number(maxSearchCalls),
              }
            : acceptsAudio
              ? { model, audio: sourceAudio }
              : operation === "audio/speech"
                ? { model, input: prompt, voice: "default", response_format: "mp3" }
                : operation === "analysis"
                  ? {
                      model,
                      input: prompt,
                      max_output_tokens: Number(maxOutput),
                      ...(analysisFileIds.trim()
                        ? { file_ids: analysisFileIds.trim().split(/[\s,]+/) }
                        : {}),
                    }
                  : operation === "browser"
                    ? (() => {
                        const [url, ...navigate] = prompt
                          .split(/\r?\n/)
                          .map((value) => value.trim())
                          .filter(Boolean);
                        return { model, url, ...(navigate.length ? { navigate } : {}) };
                      })()
                    : { model, input: prompt };
      const requestBody = JSON.stringify(input);
      const apiOperation = operation === "streaming" ? "responses" : operation;
      const quoteBody = JSON.stringify({ operation: apiOperation, input });
      const result = record(await request("quotes", controller, quoteBody));
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
      const headers = {
        "X-Kova-Quote": accepted.quoteToken,
        "Idempotency-Key": accepted.requestKey,
      };
      if (accepted.operation === "streaming") {
        const body = accepted.requestBody;
        const response = await fetchRequest("streaming", controller, body, headers);
        const isStream = response.headers.get("content-type")?.includes("text/event-stream");
        if (!response.body || !isStream) {
          throw new Error("Expected a response stream. Check Logs before retrying.");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true });
        const parser = createDeveloperPlaygroundStream();
        try {
          for (;;) {
            controller.signal.throwIfAborted();
            const next = await reader.read();
            if (next.done) break;
            const text = parser.push(decoder.decode(next.value, { stream: true }));
            if (mounted.current && !controller.signal.aborted) setOutput(text);
          }
          controller.signal.throwIfAborted();
          parser.push(decoder.decode());
          const result = parser.finish();
          if (mounted.current) {
            setOutput(result.output || "No text output.");
            if (result.status === "incomplete")
              setError("Response incomplete. Check Logs for usage and settlement.");
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        return;
      }
      const result = await request(accepted.operation, controller, accepted.requestBody, headers);
      if (!mounted.current || controller.signal.aborted) return;
      if (accepted.operation === "audio/speech") {
        const encoded = record(result).audio;
        if (
          typeof encoded !== "string" ||
          encoded.length > 2796204 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
        )
          throw new Error("Invalid speech result. Check Logs before retrying.");
        setAudio(`data:audio/mpeg;base64,${encoded}`);
        setOutput("AI-generated speech. Review usage in Logs.");
      } else if (accepted.operation === "images") {
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
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Playground</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Test approved text, image, audio and embedding models with your scoped API key. Every paid
          run requires a fresh signed quote and explicit confirmation.
        </p>
      </header>
      {!enabled && (
        <p role="status" className="rounded-lg border border-border p-3 text-sm">
          Paid API execution is not enabled.
        </p>
      )}
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-5 rounded-[var(--kova-radius-panel)] border border-border p-4">
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
                setEffort("");
                setAdvanced("");
                setMediaFile(null);
                if (mediaInput.current) mediaInput.current.value = "";
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
                setModel(models.find((item) => eligibleModel(item, next))?.id ?? "");
                setEffort("");
                setAdvanced("");
                setMediaFile(null);
                if (mediaInput.current) mediaInput.current.value = "";
                setDispatched(false);
                resetQuote();
              }}
            >
              <option value="responses">Text responses</option>
              <option value="streaming">Streaming responses</option>
              <option value="images">Images</option>
              <option value="embeddings">Embeddings</option>
              <option value="moderations">Moderation</option>
              <option value="search">Web search</option>
              <option value="analysis">Isolated code analysis</option>
              <option value="browser">Cloud Browser navigation</option>
              <option value="audio/speech">Speech generation</option>
              <option value="audio/transcriptions">Audio transcription</option>
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
                setEffort("");
                setAdvanced("");
                setMediaFile(null);
                if (mediaInput.current) mediaInput.current.value = "";
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
          {!acceptsAudio && (
            <label className="block space-y-1 text-sm">
              <span>
                {operation === "images"
                  ? "Image prompt"
                  : operation === "search"
                    ? "Search query"
                    : operation === "browser"
                      ? "Approved HTTPS pages (one per line, up to three on the same origin)"
                      : "Input"}
              </span>
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
          )}
          {acceptsAudio && (
            <label className="block min-w-0 space-y-1 text-sm">
              <span>WAV recording (16 kHz mono PCM, 0.1–20 seconds)</span>
              <Input
                ref={mediaInput}
                type="file"
                accept=".wav,audio/wav,audio/x-wav"
                disabled={busy}
                onChange={(event) => {
                  setMediaFile(event.target.files?.[0] ?? null);
                  setDispatched(false);
                  resetQuote();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Only submit recordings you have permission to transcribe.
              </p>
            </label>
          )}
          {(textOperation || operation === "search" || operation === "analysis") && (
            <label className="block space-y-1 text-sm">
              <span>Maximum output tokens</span>
              <Input
                type="number"
                min={1}
                max={operation === "analysis" ? 2048 : 32768}
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
          {operation === "analysis" && (
            <label className="block space-y-1 text-sm">
              <span>Project text file IDs (optional, up to four)</span>
              <Input
                value={analysisFileIds}
                disabled={busy}
                placeholder="Comma-separated file IDs"
                onChange={(event) => {
                  setAnalysisFileIds(event.target.value);
                  setDispatched(false);
                  resetQuote();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Requires files scope. Expanded text must fit 16,000 bytes. This is a temporary,
                network-disabled analysis session.
              </p>
            </label>
          )}
          {operation === "search" && (
            <label className="block space-y-1 text-sm">
              <span>Maximum search calls</span>
              <select
                className="block min-h-11 w-full min-w-0 rounded-full border border-input bg-background px-4 text-base md:text-sm"
                value={maxSearchCalls}
                disabled={busy}
                onChange={(event) => {
                  setMaxSearchCalls(event.target.value);
                  setDispatched(false);
                  resetQuote();
                }}
              >
                {["1", "2", "3"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Only models with an approved, enabled search contract appear here.
              </p>
            </label>
          )}
          {textOperation && (
            <details className="min-w-0 space-y-2">
              <summary className="cursor-pointer text-sm">Advanced request options</summary>
              <label className="block space-y-1 text-sm">
                <span>Additional Responses JSON</span>
                <Textarea
                  rows={5}
                  className="w-full min-w-0 font-mono text-xs"
                  value={advanced}
                  disabled={busy}
                  placeholder="Additional JSON options"
                  onChange={(event) => {
                    setAdvanced(event.target.value);
                    setDispatched(false);
                    resetQuote();
                  }}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Configure schemas, tools and files. Client code runs custom functions.
              </p>
            </details>
          )}
          {(acceptsImage || acceptsEdit) && (
            <label className="block min-w-0 space-y-1 text-sm">
              <span>
                {acceptsEdit ? "Source image for editing" : "Image input"} (optional, PNG up to 32
                KiB and 512 × 512)
              </span>
              <Input
                ref={mediaInput}
                type="file"
                accept="image/png"
                disabled={busy}
                onChange={(event) => {
                  setMediaFile(event.target.files?.[0] ?? null);
                  setDispatched(false);
                  resetQuote();
                }}
              />
            </label>
          )}
          {textOperation && efforts.length > 0 && (
            <label className="block space-y-1 text-sm">
              <span>Reasoning effort</span>
              <select
                className="block min-h-11 w-full min-w-0 rounded-full border border-input bg-background px-4 text-base md:text-sm"
                value={effort}
                disabled={busy}
                onChange={(event) => {
                  setEffort(event.target.value);
                  setDispatched(false);
                  resetQuote();
                }}
              >
                <option value="">Model default</option>
                {efforts.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
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
              disabled={
                !enabled ||
                busy ||
                !model ||
                (acceptsAudio ? !mediaFile : !prompt.trim()) ||
                dispatched
              }
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
        <div className="min-w-0 space-y-5 rounded-[var(--kova-radius-panel)] border border-border p-4">
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
          {audio && (
            <audio
              controls
              preload="none"
              src={audio}
              className="w-full"
              aria-label="AI-generated speech"
            />
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
