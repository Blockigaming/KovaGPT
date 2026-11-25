import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { t, useLocalization } from "@/lib/localization";
import { intlLocale, searchMatches } from "@/lib/localization-format";
import { ArrowDown, ArrowUp, Check, Copy, Download, Search, X } from "lucide-react";
import { highlightLines } from "@/lib/code-highlight";
import { formatMediaTime, parseMediaTitle } from "@/lib/response-media.mjs";
import { compareCells, rowsToDelimited, type TableModel } from "@/lib/response-table.mjs";
// Mermaid is served as its prebuilt file (see vite.config.ts) and loads only for diagrams.
const mermaidScriptUrl = "/assets/vendor/mermaid-12.3.0.min.js";
import "./response-enhanced.css";

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
};
let mermaidLoad: Promise<MermaidApi> | null = null;
function loadMermaid() {
  mermaidLoad ??= new Promise<MermaidApi>((resolve, reject) => {
    const existing = (window as { mermaid?: MermaidApi }).mermaid;
    if (existing) return resolve(existing);
    const script = document.createElement("script");
    script.src = mermaidScriptUrl;
    script.async = true;
    script.onload = () => {
      const api = (window as { mermaid?: MermaidApi }).mermaid;
      if (api) resolve(api);
      else reject(new Error("Diagram renderer unavailable"));
    };
    script.onerror = () => {
      mermaidLoad = null;
      reject(new Error("Diagram renderer could not load"));
    };
    document.head.append(script);
  });
  return mermaidLoad;
}

/* ------------------------------------------------------------------ */
/* Code block: syntax colours, line numbers, wrap, download            */
/* ------------------------------------------------------------------ */

function downloadText(name: string, text: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const EXTENSIONS: Record<string, string> = {
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  jsx: "jsx",
  python: "py",
  py: "py",
  bash: "sh",
  shell: "sh",
  sh: "sh",
  html: "html",
  css: "css",
  json: "json",
  yaml: "yml",
  yml: "yml",
  sql: "sql",
  markdown: "md",
  md: "md",
  rust: "rs",
  go: "go",
  java: "java",
  ruby: "rb",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  swift: "swift",
  kotlin: "kt",
  toml: "toml",
  xml: "xml",
  diff: "diff",
};

const glyph = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
function LineNumbersGlyph() {
  return (
    <svg {...glyph}>
      <path d="M4 6h1v4M4 10h2M4 14.5a1 1 0 0 1 2 0c0 .8-2 1.5-2 3h2M10 7h10M10 12h10M10 17h10" />
    </svg>
  );
}
function WrapGlyph() {
  return (
    <svg {...glyph}>
      <path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4m0 0 2-2m-2 2 2 2M4 18h5" />
    </svg>
  );
}

function CodeView({ language, text }: { language: string; text: string }) {
  useLocalization();
  const [wrap, setWrap] = useState(false);
  const [numbers, setNumbers] = useState(() => text.split("\n").length > 3);
  const lines = useMemo(() => highlightLines(text, language), [text, language]);
  const plain = useMemo(() => text.split("\n"), [text]);
  return (
    <div className="kova-code" data-wrap={wrap || undefined} data-numbers={numbers || undefined}>
      <div className="kova-code-tools" role="toolbar" aria-label={`${language} code options`}>
        <button
          type="button"
          aria-pressed={numbers}
          aria-label={t("Line numbers")}
          title={t("Line numbers")}
          onClick={() => setNumbers((v) => !v)}
        >
          <LineNumbersGlyph />
        </button>
        <button
          type="button"
          aria-pressed={wrap}
          aria-label={t("Wrap lines")}
          title={t("Wrap lines")}
          onClick={() => setWrap((v) => !v)}
        >
          <WrapGlyph />
        </button>
        <button
          type="button"
          aria-label={t("Download")}
          title={t("Download")}
          onClick={() =>
            downloadText(`snippet.${EXTENSIONS[language.toLowerCase()] ?? "txt"}`, text)
          }
        >
          <Download aria-hidden="true" />
        </button>
      </div>
      <pre tabIndex={0} dir="ltr" aria-label={`${language} code block`}>
        <code className={`language-${language}`}>
          {(lines ?? plain).map((line, index) =>
            lines ? (
              <span
                key={index}
                className="kova-code-line"
                // Prism escapes the source; only its own token spans remain.
                dangerouslySetInnerHTML={{ __html: line || " " }}
              />
            ) : (
              <span key={index} className="kova-code-line">
                {line || " "}
              </span>
            ),
          )}
        </code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Table: sort, filter, copy and export                                */
/* ------------------------------------------------------------------ */

type ElementWithChildren = ReactElement<{ children?: ReactNode }>;
function elementChildren(node: ReactNode) {
  return Children.toArray(node).filter(isValidElement) as ElementWithChildren[];
}

function TableView({ model, children }: { model: TableModel; children: ReactNode }) {
  useLocalization();
  const [sort, setSort] = useState<{ column: number; direction: 1 | -1 } | null>(null);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const filterId = useId();
  const parts = elementChildren(children);
  const head = parts.find((part) => part.type === "thead");
  const body = parts.find((part) => part.type === "tbody");
  const headerCells = head
    ? elementChildren(elementChildren(head.props.children)[0]?.props.children)
    : [];
  const bodyRows = body ? elementChildren(body.props.children) : [];

  const order = useMemo(() => {
    const needle = query.trim();
    let indexes = model.rows.map((_, index) => index);
    if (needle)
      indexes = indexes.filter((index) =>
        model.rows[index].some((cell) => searchMatches(cell, needle)),
      );
    if (sort)
      indexes.sort(
        (a, b) =>
          compareCells(model.rows[a][sort.column], model.rows[b][sort.column], intlLocale()) *
          sort.direction,
      );
    return indexes;
  }, [model, query, sort]);

  const visibleRows = order.map((index) => model.rows[index]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(rowsToDelimited([model.header, ...visibleRows], "\t"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      setCopied(false);
    }
  };
  const interactive = model.rows.length > 1;
  return (
    <div className="kova-table-enhanced">
      {interactive && (
        <div className="kova-table-tools">
          {model.rows.length > 5 && (
            <label className="kova-table-filter" htmlFor={filterId}>
              <Search aria-hidden="true" />
              <span className="sr-only">{t("Filter rows")}</span>
              <input
                id={filterId}
                type="search"
                placeholder={t("Filter rows")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button type="button" aria-label="Clear filter" onClick={() => setQuery("")}>
                  <X aria-hidden="true" />
                </button>
              )}
            </label>
          )}
          <span className="kova-table-count" aria-live="polite">
            {query ? `${order.length} of ${model.rows.length} rows` : `${model.rows.length} rows`}
          </span>
          <button
            type="button"
            onClick={() => void copy()}
            aria-label={copied ? "Table copied" : "Copy table"}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? t("Copied") : t("Copy")}
          </button>
          <button
            type="button"
            onClick={() =>
              downloadText(
                "table.csv",
                rowsToDelimited([model.header, ...visibleRows], ","),
                "text/csv;charset=utf-8",
              )
            }
          >
            <Download aria-hidden="true" /> CSV
          </button>
        </div>
      )}
      <div className="kova-table-scroll" role="region" aria-label="Table" tabIndex={0} dir="auto">
        <table>
          <thead>
            <tr>
              {(headerCells.length ? headerCells : model.header.map((cell) => <>{cell}</>)).map(
                (cell, column) => {
                  const active = sort?.column === column;
                  return (
                    <th
                      key={column}
                      scope="col"
                      aria-sort={
                        active ? (sort.direction === 1 ? "ascending" : "descending") : "none"
                      }
                    >
                      {interactive ? (
                        <button
                          type="button"
                          className="kova-table-sort"
                          onClick={() =>
                            setSort((current) =>
                              current?.column !== column
                                ? { column, direction: 1 }
                                : current.direction === 1
                                  ? { column, direction: -1 }
                                  : null,
                            )
                          }
                        >
                          <span>
                            {isValidElement(cell)
                              ? (cell as ElementWithChildren).props.children
                              : cell}
                          </span>
                          {active ? (
                            sort.direction === 1 ? (
                              <ArrowUp aria-hidden="true" />
                            ) : (
                              <ArrowDown aria-hidden="true" />
                            )
                          ) : null}
                        </button>
                      ) : isValidElement(cell) ? (
                        (cell as ElementWithChildren).props.children
                      ) : (
                        cell
                      )}
                    </th>
                  );
                },
              )}
            </tr>
          </thead>
          <tbody>
            {order.map((index) => bodyRows[index] ?? null)}
            {order.length === 0 && (
              <tr>
                <td colSpan={Math.max(1, model.header.length)} className="kova-table-empty">
                  No rows match “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Diagram: Mermaid source rendered with strict security               */
/* ------------------------------------------------------------------ */

let mermaidCounter = 0;
function DiagramView({ source }: { source: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    setSvg(null);
    setError(null);
    void loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
          fontFamily: "inherit",
        });
        const { svg: rendered } = await mermaid.render(`kova-diagram-${++mermaidCounter}`, source);
        if (live.current) setSvg(rendered);
      })
      .catch((reason: unknown) => {
        if (live.current)
          setError(
            reason instanceof Error ? reason.message.split("\n")[0] : "Diagram could not be drawn.",
          );
      });
    return () => {
      live.current = false;
    };
  }, [source]);
  return (
    <figure className="kova-diagram">
      <div className="kova-diagram-tools">
        <button type="button" aria-pressed={!showSource} onClick={() => setShowSource(false)}>
          Diagram
        </button>
        <button type="button" aria-pressed={showSource} onClick={() => setShowSource(true)}>
          Source
        </button>
        {svg && (
          <button type="button" onClick={() => downloadText("diagram.svg", svg, "image/svg+xml")}>
            <Download aria-hidden="true" /> SVG
          </button>
        )}
      </div>
      {showSource || error ? (
        <>
          {error && (
            <p role="alert" className="kova-diagram-error">
              Couldn’t draw this diagram: {error}. The source is shown instead.
            </p>
          )}
          <pre tabIndex={0} aria-label="Diagram source">
            <code>{source}</code>
          </pre>
        </>
      ) : svg ? (
        <div
          className="kova-diagram-canvas"
          dir="ltr"
          role="img"
          aria-label="Diagram"
          // Mermaid's strict mode sanitizes labels and strips scripts and handlers.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <p role="status" className="kova-diagram-loading">
          Drawing diagram…
        </p>
      )}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Media: audio and video links play inline                            */
/* ------------------------------------------------------------------ */

function MediaView({
  src,
  kind,
  label,
  title,
}: {
  src: string;
  kind: "audio" | "video";
  label: string;
  title?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [rate, setRate] = useState(1);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const details = useMemo(() => parseMediaTitle(title), [title]);
  const rateId = useId();
  useEffect(() => {
    if (media.current) media.current.playbackRate = rate;
  }, [rate]);
  if (failed)
    return (
      <span className="kova-media-error">
        This {kind} couldn’t be played here.{" "}
        <a href={src} target="_blank" rel="noreferrer noopener">
          Open {label}
        </a>
      </span>
    );
  const seek = (seconds: number) => {
    if (!media.current) return;
    media.current.currentTime = seconds;
    void media.current.play().catch(() => undefined);
  };
  return (
    <span className="kova-media-block">
      <span className="kova-media" data-kind={kind}>
        {kind === "audio" ? (
          <audio
            ref={media}
            controls
            preload="none"
            src={src}
            aria-label={label}
            onError={() => setFailed(true)}
          />
        ) : (
          <video
            ref={media}
            controls
            playsInline
            preload="none"
            src={src}
            aria-label={label}
            crossOrigin={details.captions ? "anonymous" : undefined}
            onError={() => setFailed(true)}
          >
            {details.captions && (
              <track kind="captions" src={details.captions} srcLang="en" label="Captions" default />
            )}
          </video>
        )}
      </span>
      <span className="kova-media-tools">
        <label htmlFor={rateId}>Speed</label>
        <select id={rateId} value={rate} onChange={(event) => setRate(Number(event.target.value))}>
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
        <a href={src} target="_blank" rel="noreferrer noopener" download>
          <Download aria-hidden="true" /> Download
        </a>
      </span>
      {details.chapters.length > 0 && (
        <span className="kova-media-chapters" role="list" aria-label="Chapters">
          {details.chapters.map((chapter) => (
            <span role="listitem" key={`${chapter.seconds}-${chapter.label}`}>
              <button type="button" onClick={() => seek(chapter.seconds)}>
                <time>{formatMediaTime(chapter.seconds)}</time> {chapter.label}
              </button>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */

export type ResponseEnhancedProps =
  | { kind: "code"; language: string; text: string }
  | { kind: "table"; model: TableModel; children: ReactNode }
  | { kind: "diagram"; source: string }
  | { kind: "media"; src: string; media: "audio" | "video"; label: string; title?: string };

/** One lazily loaded module for every heavier response block. */
export default function ResponseEnhanced(props: ResponseEnhancedProps) {
  switch (props.kind) {
    case "code":
      return <CodeView language={props.language} text={props.text} />;
    case "table":
      return <TableView model={props.model}>{props.children}</TableView>;
    case "diagram":
      return <DiagramView source={props.source} />;
    case "media":
      return (
        <MediaView src={props.src} kind={props.media} label={props.label} title={props.title} />
      );
  }
}
