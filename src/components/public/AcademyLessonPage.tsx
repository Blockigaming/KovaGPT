import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowLeft, ArrowRight, Check } from "lucide-react";
import { PublicShell } from "@/components/public/PublicShell";
import type { PublicDetailPage } from "@/lib/public-detail-content";
import "./academy-lesson.css";

/** Academy presentation only; the existing route remains the source of lesson content. */
export function AcademyLessonPage({ item }: { item: PublicDetailPage }) {
  const closing = item.closing ?? {
    title: "Ready to put it to work?",
    body: "Start with a clear goal, use only the context you need, and verify important output.",
  };

  return (
    <PublicShell>
      <main id="main-content" tabIndex={-1} className="academy-lesson">
        <div className="academy-lesson__frame">
          <nav aria-label="Breadcrumb" className="academy-lesson__breadcrumb">
            <Link to="/academy" data-public-breadcrumb className="min-h-11">
              <ArrowLeft size={16} aria-hidden="true" />
              Academy
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{item.slug.replaceAll("-", " ")}</span>
          </nav>

          <div id="academy-overview" className="academy-lesson__hero" tabIndex={-1}>
            <div className="academy-lesson__intro">
              <p className="academy-lesson__eyebrow">
                <span className="academy-lesson__mark" aria-hidden="true" />
                {item.eyebrow}
                <span className="academy-lesson__format">Practical guide</span>
              </p>
              <h1>{item.title}</h1>
              <p className="academy-lesson__summary">{item.summary}</p>
              <div className="academy-lesson__actions">
                <Link
                  to={item.primaryAction.to as never}
                  data-public-primary
                  className="academy-lesson__button min-h-11"
                >
                  {item.primaryAction.label}
                  <ArrowRight size={18} aria-hidden="true" />
                </Link>
                <a href="#academy-section-1" className="academy-lesson__text-link">
                  Explore the guide
                  <ArrowDown size={16} aria-hidden="true" />
                </a>
              </div>
            </div>

            <section aria-label="Page highlights" className="academy-lesson__outcomes">
              <div className="academy-lesson__art" aria-hidden="true">
                <svg viewBox="0 0 360 190" fill="none" focusable="false">
                  <g stroke="currentColor" strokeWidth="0.8">
                    {[0, 1, 2, 3, 4, 5, 6].map((ring) => (
                      <ellipse
                        key={ring}
                        cx="180"
                        cy="95"
                        rx={124 - ring * 12}
                        ry={70 - ring * 6}
                        transform={`rotate(${-28 + ring * 8} 180 95)`}
                      />
                    ))}
                    <path d="M32 95H328M180 12V178" strokeDasharray="2 6" opacity="0.45" />
                  </g>
                  <circle cx="180" cy="95" r="6" fill="currentColor" />
                  <circle cx="291" cy="36" r="4" fill="currentColor" />
                </svg>
              </div>
              <div className="academy-lesson__outcomes-body">
                <h2>In this guide</h2>
                <ol>
                  {item.highlights.map((highlight, index) => (
                    <li key={highlight}>
                      <span className="academy-lesson__number" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          </div>

          <div className="academy-lesson__reading-layout">
            <nav aria-label="On this page" className="academy-lesson__contents">
              <p className="academy-lesson__eyebrow">On this page</p>
              <ol>
                {item.sections.map((section, index) => (
                  <li key={section.title}>
                    <a href={`#academy-section-${index + 1}`}>
                      <span className="academy-lesson__number" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {section.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="academy-lesson__chapters">
              {item.sections.map((section, index) => (
                <article
                  id={`academy-section-${index + 1}`}
                  key={section.title}
                  tabIndex={-1}
                  aria-labelledby={`academy-heading-${index + 1}`}
                  className={`academy-lesson__chapter${index === 1 ? " academy-lesson__chapter--review" : ""}`}
                >
                  <p className="academy-lesson__eyebrow">
                    <span className="academy-lesson__number" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {index === 0 ? "Practice" : "Review"}
                  </p>
                  <h2 id={`academy-heading-${index + 1}`}>{section.title}</h2>
                  <p className="academy-lesson__body">{section.body}</p>
                  <ul className="academy-lesson__points">
                    {section.points.map((point, pointIndex) => (
                      <li key={point}>
                        {index === 0 ? (
                          <span className="academy-lesson__step" aria-hidden="true">
                            {String(pointIndex + 1).padStart(2, "0")}
                          </span>
                        ) : (
                          <Check size={18} aria-hidden="true" />
                        )}
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>

          <section aria-labelledby="academy-closing-heading" className="academy-lesson__closing">
            <div>
              <p className="academy-lesson__eyebrow">From learning to doing</p>
              <h2 id="academy-closing-heading">{closing.title}</h2>
              <p className="academy-lesson__body">{closing.body}</p>
            </div>
            <div className="academy-lesson__closing-actions">
              <Link to={item.primaryAction.to as never} className="academy-lesson__button">
                {item.primaryAction.label}
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              {item.secondaryAction ? (
                <Link to={item.secondaryAction.to as never} className="academy-lesson__text-link">
                  {item.secondaryAction.label}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          </section>
        </div>
      </main>
    </PublicShell>
  );
}
