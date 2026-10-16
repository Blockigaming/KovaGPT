import { trackLegalSection } from "@/lib/legal-active-section";
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
    <ol className="legal-toc-list" role="list">
      {sections.map((section, index) => (
        <li key={section.id}>
          <a
            href={`#${section.id}`}
            data-active={activeId === section.id || undefined}
            aria-current={activeId === section.id ? "location" : undefined}
            onClick={(event) => {
              const menu = event.currentTarget.closest("details");
              if (menu) menu.open = false;
            }}
          >
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
    if (!root) return;
    return trackLegalSection(root, setActiveId);
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
