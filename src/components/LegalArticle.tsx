import { type ReactNode } from "react";

/**
 * Shared wrapper for long-form legal / informational pages.
 * Provides generous spacing and readable typography without depending on
 * the @tailwindcss/typography plugin (which is not installed).
 */
export function LegalArticle({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="flex-1">
      <article
        className={[
          "mx-auto max-w-3xl px-6 py-16 text-foreground",
          // Headings
          "[&_h1]:text-4xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:mb-10",
          "[&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:mt-14 [&_h2]:mb-4",
          "[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-10 [&_h3]:mb-3",
          // Body
          "[&_p]:my-5 [&_p]:leading-[1.8] [&_p]:text-[15px] [&_p]:text-foreground/85",
          // Lists
          "[&_ul]:my-5 [&_ul]:pl-6 [&_ul]:list-disc [&_ul]:space-y-2",
          "[&_ol]:my-5 [&_ol]:pl-6 [&_ol]:list-decimal [&_ol]:space-y-2",
          "[&_li]:leading-[1.75] [&_li]:text-foreground/85",
          // Links
          "[&_a]:underline [&_a]:underline-offset-2 [&_a]:text-foreground hover:[&_a]:text-foreground/70",
          // Horizontal rule between sections (optional, via <hr/>)
          "[&_hr]:my-12 [&_hr]:border-border",
        ].join(" ")}
      >
        {children}
      </article>
    </main>
  );
}
