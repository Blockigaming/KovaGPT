import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ComponentProps } from "react";
import type { SnapshotMessageDto } from "@/lib/shared-chats.functions";

// Use the same GFM renderer and prose/table styles as answers, without response
// actions. Snapshot strings remain untouched; user messages remain literal text.
const components = {
  pre: ({ children }: ComponentProps<"pre">) => (
    <pre tabIndex={0} aria-label="Scrollable code block">
      {children}
    </pre>
  ),
  table: ({ children }: ComponentProps<"table">) => (
    <div className="kova-table-scroll" role="region" aria-label="Scrollable table" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
  a: ({ children, href, title }: ComponentProps<"a">) => (
    <a href={href} title={title} target="_blank" rel="noreferrer noopener">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ),
  // As in DocumentPaper, never load untrusted model-image URLs automatically.
  // A surrounding Markdown link still retains its safe destination.
  img: ({ alt }: ComponentProps<"img">) => <span>[Image reference: {alt || "image"}]</span>,
};

export function SharedSnapshotMessage({ message }: { message: SnapshotMessageDto }) {
  return message.role === "assistant" ? (
    <div className="prose-chat kova-shared-markdown">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {message.content}
      </Markdown>
    </div>
  ) : (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
  );
}
