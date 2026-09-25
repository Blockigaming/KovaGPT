import { useEffect, useRef, useState, type ReactNode } from "react";

export type LegalDocSection = Readonly<{ id: string; label: string }>;

/**
 * Shared composition for long legal documents (Terms, Privacy).
 * Reference register: OpenAI legal pages — quiet oversized hero, sticky
 * numbered table of contents on desktop, anchored sections, monochrome only.
 */
export function LegalDocHero({
  eyebrow,
  title,
  meta,
  description,
}: {
  eyebrow: string;
  title: string;
  meta?: string;
  description?: string;
}) {
  return (
    <header className="legal-hero">
      <p className="legal-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {meta ? <p className="legal-hero-meta">{meta}</p> : null}
      {description ? <p className="legal-hero-lede">{description}</p> : null}
    </header>
  );
}

function LegalTocList({
  sections,
  activeId,
}: {
  sections: readonly LegalDocSection[];
  activeId: string | null;
}) {
  return (
    <ol className="legal-toc-list">
      {sections.map((section, index) => (
        <li key={section.id}>
          <a href={`#${section.id}`} data-active={activeId === section.id || undefined}>
            <span className="legal-toc-index" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="legal-toc-label">{section.label}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

export function LegalDoc({
  sections,
  children,
}: {
  sections: readonly LegalDocSection[];
  children: ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = bodyRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-legal-section]"));
    if (!targets.length) return;

    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
          else visible.delete(entry.target.id);
        }
        if (!visible.size) return;
        let top = Number.POSITIVE_INFINITY;
        for (const value of visible.values()) top = Math.min(top, value);
        const match = targets.find((target) => visible.get(target.id) === top);
        if (match) setActiveId(match.id);
      },
      { rootMargin: "0px 0px -55% 0px", threshold: 0 },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="legal-doc">
      <details className="legal-toc-mobile">
        <summary>
          <span>On this page</span>
          <span aria-hidden="true" className="legal-toc-toggle">
            +
          </span>
        </summary>
        <nav aria-label="Page sections">
          <LegalTocList sections={sections} activeId={activeId} />
        </nav>
      </details>

      <div className="legal-layout">
        <aside className="legal-toc-aside">
          <p className="legal-toc-title">On this page</p>
          <nav aria-label="Page sections">
            <LegalTocList sections={sections} activeId={activeId} />
          </nav>
        </aside>
        <div className="legal-body" ref={bodyRef}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LegalDocEndnote({ children }: { children: ReactNode }) {
  return (
    <footer className="legal-endnote">
      <span className="legal-endnote-links">{children}</span>
      <a href="#main-content">Back to top</a>
    </footer>
  );
}
