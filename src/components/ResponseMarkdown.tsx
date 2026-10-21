import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { ResponseImage } from "./ResponseImage";
import type { Components, ExtraProps } from "react-markdown";
import type { Element, Root, RootContent } from "hast";
import remarkGfm from "remark-gfm";
import { Check, Copy, Download, ExternalLink } from "lucide-react";
import type { ResponseSource } from "@/lib/response-sources";
import "./response-output-blocks.css";
import { observeTableOverflow } from "@/lib/table-overflow";

declare module "hast" {
  interface ElementData {
    kovaTextOutput?: string;
    kovaOutputLabel?: string;
    kovaCodeFilename?: string;
  }
}

function ResponseTable({ children }: { children?: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const cueId = useId();
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    if (!container.current || !table.current) return;
    return observeTableOverflow(container.current, table.current, (value) =>
      setOverflow(value.overflow),
    );
  }, [children]);
  return (
    <div className="kova-table-container">
      <div
        ref={container}
        className="kova-table-scroll"
        role="region"
        aria-label="Scrollable comparison table"
        aria-describedby={overflow ? cueId : undefined}
        tabIndex={0}
      >
        <table ref={table}>{children}</table>
      </div>
      {overflow && (
        <p id={cueId} className="kova-table-overflow-cue">
          More columns are available. Scroll horizontally to read the table.
        </p>
      )}
    </div>
  );
}

type CopyState = "idle" | "copying" | "copied" | "error";

export function ResponseContentBox({
  text,
  kind = "text",
  label = "Text",
  filename,
  children,
  writeClipboard = (value: string) => navigator.clipboard.writeText(value),
}: {
  text: string;
  kind?: "text" | "code";
  label?: string;
  filename?: string;
  children: ReactNode;
  writeClipboard?: (value: string) => Promise<void>;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const errorId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempt = useRef(0);
  const pending = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setCopyState("idle");
    pending.current = false;
    return () => {
      attempt.current += 1;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text]);
  const copy = async () => {
    if (pending.current) return;
    pending.current = true;
    const current = ++attempt.current;
    if (timer.current) clearTimeout(timer.current);
    setCopyState("copying");
    try {
      await writeClipboard(text);
      if (attempt.current !== current) return;
      setCopyState("copied");
      timer.current = setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      if (attempt.current === current) setCopyState("error");
    } finally {
      if (attempt.current === current) pending.current = false;
    }
  };
  const select = () => {
    if (!content.current) return;
    const range = document.createRange();
    range.selectNodeContents(content.current);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    content.current.focus();
  };
  const download = () => {
    if (!filename) return;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = safeOutputFilename(filename);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return (
    <section
      className="kova-response-output"
      data-output-kind={kind}
      aria-label={filename || label}
    >
      <header className="kova-response-output-header">
        <span className="kova-response-output-label">{filename || label}</span>
        {filename && <span className="kova-response-output-language">{label}</span>}
      </header>
      <div
        ref={content}
        className="kova-response-output-content"
        tabIndex={copyState === "error" ? 0 : undefined}
      >
        {children}
      </div>
      <div className="kova-response-copy-panel">
        <button
          type="button"
          onClick={() => void copy()}
          disabled={copyState === "copying"}
          className="kova-response-copy-button"
          aria-describedby={copyState === "error" ? errorId : undefined}
          aria-label={
            copyState === "copied"
              ? "Copied"
              : copyState === "error"
                ? "Couldn’t copy. Retry"
                : `Copy ${kind}`
          }
        >
          {copyState === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          <span className="kova-copy-label-stack">
            <span className="kova-copy-label-reserve" aria-hidden="true">
              Couldn’t copy
            </span>
            <span className="kova-copy-label-reserve" aria-hidden="true">
              Copying…
            </span>
            <span className="kova-copy-label-reserve" aria-hidden="true">
              Copy {kind}
            </span>
            <span>
              {copyState === "copied" ? (
                "Copied"
              ) : copyState === "copying" ? (
                "Copying…"
              ) : copyState === "error" ? (
                "Couldn’t copy"
              ) : (
                <>
                  <span className="kova-copy-desktop-label">Copy</span>
                  <span className="kova-copy-mobile-label">Copy {kind}</span>
                </>
              )}
            </span>
          </span>
        </button>
        {filename && (
          <button type="button" className="kova-response-download-button" onClick={download}>
            <Download aria-hidden="true" /> Download file
          </button>
        )}
      </div>
      <span role="status" className="sr-only">
        {copyState === "copied" ? `${kind === "code" ? "Code" : "Text"} copied.` : ""}
      </span>
      {copyState === "error" && (
        <div id={errorId} role="alert" className="kova-response-copy-error">
          Couldn’t copy. The content is still selectable.{" "}
          <button type="button" onClick={select}>
            Select content
          </button>
        </div>
      )}
    </section>
  );
}

function safeOutputFilename(value: string) {
  const name = value.split(/[\\/]/).pop() || "";
  return (
    Array.from(name)
      .filter(
        (character) =>
          character.charCodeAt(0) >= 32 &&
          character.charCodeAt(0) !== 127 &&
          !'<>:"|?*'.includes(character),
      )
      .join("")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 160) || "output.txt"
  );
}

const writingLanguages = new Set([
  "writing",
  "draft",
  "email",
  "message",
  "prompt",
  "letter",
  "document",
]);
function MarkdownPre({ node, children, ...props }: ComponentProps<"pre"> & ExtraProps) {
  const code = node?.children.length === 1 ? node.children[0] : undefined;
  if (
    code?.type !== "element" ||
    code.tagName !== "code" ||
    code.children.some((child) => child.type !== "text")
  ) {
    return (
      <pre {...props} tabIndex={0}>
        {children}
      </pre>
    );
  }
  const className = Array.isArray(code.properties.className)
    ? code.properties.className.join(" ")
    : String(code.properties.className || "");
  const language = /(?:^|\s)language-([^\s]+)/.exec(className)?.[1] ?? "text";
  const text = code.children
    .map((child) => (child.type === "text" ? child.value : ""))
    .join("")
    .replace(/\n$/, "");
  const writing = writingLanguages.has(language.toLowerCase());
  return (
    <ResponseContentBox
      text={text}
      kind={writing ? "text" : "code"}
      label={writing ? `${language[0].toUpperCase()}${language.slice(1)}` : language}
      filename={node?.data?.kovaCodeFilename}
    >
      {writing ? (
        <ResponseMarkdown boxLongProse={false}>{text}</ResponseMarkdown>
      ) : (
        <pre tabIndex={0} aria-label={`${language} code block`}>
          <code className={className}>{text}</code>
        </pre>
      )}
    </ResponseContentBox>
  );
}

// URL destinations and image payloads are attributes, not visible prose.
function visibleProseLength(node: RootContent): number {
  if (node.type === "text") return node.value.length;
  if (node.type !== "element") return 0;
  return node.children.reduce((length, child) => length + visibleProseLength(child), 0);
}

function isImageOnlyOutput(node: RootContent): boolean {
  if (node.type !== "element") return false;
  if (node.tagName === "img") return true;
  const content = node.children.filter((child) => child.type !== "text" || child.value.trim());
  return content.length > 0 && content.every(isImageOnlyOutput);
}

/** Source positions, rather than rendered DOM text, keep Copy exact and exclude controls. */
function separateTextOutputs(options: { boxLongProse: boolean } = { boxLongProse: true }) {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    const visit = (node: Root | Element) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        if (child.tagName === "pre") {
          const start = child.position?.start.offset;
          const firstLine = start === undefined ? "" : source.slice(start).split("\n")[0];
          const filename = /\b(?:filename|file)=(["'])(.*?)\1|\b(?:filename|file)=([^\s]+)/.exec(
            firstLine,
          );
          if (filename)
            child.data = {
              ...child.data,
              kovaCodeFilename: safeOutputFilename(filename[2] || filename[3]),
            };
        }
        visit(child);
      }
    };
    visit(tree);
    const output: RootContent[] = [];
    let section: RootContent[] = [];
    const flush = () => {
      const first = section.find((node) => node.type === "element");
      const last = [...section].reverse().find((node) => node.type === "element");
      const start = first?.position?.start.offset;
      const end = last?.position?.end.offset;
      const text = start === undefined || end === undefined ? "" : source.slice(start, end);
      if (
        options.boxLongProse &&
        section.reduce((length, node) => length + visibleProseLength(node), 0) > 800
      ) {
        output.push({
          type: "element",
          tagName: "div",
          properties: {},
          data: { kovaTextOutput: text, kovaOutputLabel: "Text" },
          children: section as Element["children"],
        });
      } else output.push(...section);
      section = [];
    };
    for (const node of tree.children) {
      if (node.type === "element" && node.tagName === "blockquote") {
        flush();
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (start !== undefined && end !== undefined) {
          node.data = {
            ...node.data,
            kovaTextOutput: source.slice(start, end).replace(/^ {0,3}>[ \t]?/gm, ""),
            kovaOutputLabel: "Text",
          };
        }
        output.push(node);
      } else if (
        (node.type === "element" && ["pre", "hr"].includes(node.tagName)) ||
        isImageOnlyOutput(node)
      ) {
        flush();
        output.push(node);
      } else {
        if (node.type === "element" && /^h[1-6]$/.test(node.tagName)) flush();
        section.push(node);
      }
    }
    flush();
    tree.children = output;
  };
}

type MarkdownActions = {
  sources?: ResponseSource[];
  onSourceClick?: (sourceId: string, trigger: HTMLButtonElement) => void;
  onSaveImage?: (src: string, title: string) => Promise<void>;
};

const MarkdownActionsContext = createContext<MarkdownActions>({});

function MarkdownLink({ node: _node, children, href, ...props }: ComponentProps<"a"> & ExtraProps) {
  const { sources, onSourceClick } = useContext(MarkdownActionsContext);
  const source = sources?.find((item) => item.url === href || item.id === href?.replace(/^#/, ""));
  return source && onSourceClick ? (
    <button
      type="button"
      className="kova-citation-link"
      onClick={(event) => onSourceClick(source.id, event.currentTarget)}
      aria-label={`View source: ${source.title}`}
    >
      {children}
    </button>
  ) : (
    <a {...props} href={href} target="_blank" rel="noreferrer noopener">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function MarkdownImage({ src, alt }: ComponentProps<"img"> & ExtraProps) {
  const { onSaveImage } = useContext(MarkdownActionsContext);
  return typeof src === "string" && src ? (
    <ResponseImage key={src} src={src} alt={alt || "Generated image"} onSave={onSaveImage} />
  ) : (
    <span>Image unavailable</span>
  );
}

// React treats these functions as component types. Keep every type stable when
// callbacks or source metadata refresh so image viewers, errors and focus survive.
const markdownComponents: Components = {
  pre: MarkdownPre,
  div: ({ node, children, ...props }) =>
    typeof node?.data?.kovaTextOutput === "string" ? (
      <ResponseContentBox text={node.data.kovaTextOutput} label={node.data.kovaOutputLabel}>
        {children}
      </ResponseContentBox>
    ) : (
      <div {...props}>{children}</div>
    ),
  blockquote: ({ node, children, ...props }) =>
    typeof node?.data?.kovaTextOutput === "string" ? (
      <ResponseContentBox text={node.data.kovaTextOutput} label={node.data.kovaOutputLabel}>
        {children}
      </ResponseContentBox>
    ) : (
      <blockquote {...props}>{children}</blockquote>
    ),
  table: ({ children }) => <ResponseTable>{children}</ResponseTable>,
  a: MarkdownLink,
  img: MarkdownImage,
};

export function ResponseMarkdown({
  children,
  boxLongProse = true,
  sources,
  onSourceClick,
  onSaveImage,
}: MarkdownActions & {
  children: string;
  boxLongProse?: boolean;
}) {
  const actions = useMemo(
    () => ({ sources, onSourceClick, onSaveImage }),
    [sources, onSourceClick, onSaveImage],
  );
  return (
    <MarkdownActionsContext.Provider value={actions}>
      <ReactMarkdown
        urlTransform={(url, key) =>
          key === "src" && /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(url)
            ? url
            : defaultUrlTransform(url)
        }
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[separateTextOutputs, { boxLongProse }]]}
        components={markdownComponents}
      >
        {children}
      </ReactMarkdown>
    </MarkdownActionsContext.Provider>
  );
}
