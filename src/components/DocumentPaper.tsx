import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { RefObject } from "react";
export function DocumentPaper({
  title,
  content,
  containerRef,
  visible,
}: {
  title: string;
  content: string;
  containerRef: RefObject<HTMLDivElement | null>;
  visible: boolean;
}) {
  if (content.length > 200000)
    return (
      <p role="alert">
        Paper view and print support up to 200,000 characters. Export the Markdown source to
        preserve the complete draft.
      </p>
    );
  return (
    <div
      ref={containerRef}
      hidden={!visible}
      className="min-h-0 min-w-0 flex-1 overflow-auto bg-white p-6 font-sans text-black [color-scheme:light] [--ring:#171717] [overflow-wrap:anywhere] sm:p-10"
      aria-label="Document paper view"
    >
      <h1 className="mb-6 text-3xl leading-tight font-semibold">{title}</h1>
      <div
        className="text-base leading-7 text-black
          [&_h1]:mt-8 [&_h1]:mb-4 [&_h1]:text-3xl [&_h1]:leading-tight [&_h1]:font-semibold
          [&_h2]:mt-7 [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:leading-snug [&_h2]:font-semibold
          [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-xl [&_h3]:leading-snug [&_h3]:font-semibold
          [&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:text-lg [&_h4]:font-semibold
          [&_h5]:mt-4 [&_h5]:mb-2 [&_h5]:font-semibold [&_h6]:mt-4 [&_h6]:mb-2 [&_h6]:font-semibold
          [&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6
          [&_li]:my-1 [&_li>ul]:my-1 [&_li>ol]:my-1 [&_li>p]:my-1 [&_li::marker]:text-neutral-700
          [&_a]:text-violet-800 [&_a]:underline [&_a]:underline-offset-2
          [&_blockquote]:my-5 [&_blockquote]:border-l-4 [&_blockquote]:border-neutral-300 [&_blockquote]:pl-4 [&_blockquote]:text-neutral-700
          [&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm
          [&_pre]:my-5 [&_pre]:rounded-lg [&_pre]:bg-neutral-100 [&_pre]:p-4 [&_pre]:whitespace-pre-wrap [&_pre_code]:p-0
          [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-sm
          [&_th]:min-w-32 [&_th]:border [&_th]:border-neutral-300 [&_th]:bg-neutral-100 [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold
          [&_td]:min-w-32 [&_td]:border [&_td]:border-neutral-300 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top
          [&_hr]:my-8 [&_hr]:border-neutral-300 [&>:first-child]:mt-0 [&>:last-child]:mb-0"
      >
        <Markdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={{
            h1: ({ node, children }) => (
              <h1 data-document-line={node?.position?.start.line} tabIndex={-1}>
                {children}
              </h1>
            ),
            h2: ({ node, children }) => (
              <h2 data-document-line={node?.position?.start.line} tabIndex={-1}>
                {children}
              </h2>
            ),
            h3: ({ node, children }) => (
              <h3 data-document-line={node?.position?.start.line} tabIndex={-1}>
                {children}
              </h3>
            ),
            h4: ({ node, children }) => (
              <h4 data-document-line={node?.position?.start.line} tabIndex={-1}>
                {children}
              </h4>
            ),
            h5: ({ node, children }) => (
              <h5 data-document-line={node?.position?.start.line} tabIndex={-1}>
                {children}
              </h5>
            ),
            h6: ({ node, children }) => (
              <h6 data-document-line={node?.position?.start.line} tabIndex={-1}>
                {children}
              </h6>
            ),
            table: ({ children }) => (
              <div
                className="my-5 max-w-full overflow-x-auto"
                role="region"
                aria-label="Scrollable table"
                tabIndex={0}
              >
                <table>{children}</table>
              </div>
            ),
            img: ({ alt }) => <span>[Image reference: {alt || "image"}]</span>,
          }}
        >
          {content}
        </Markdown>
      </div>
    </div>
  );
}
