import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

export function PublicAction({
  to,
  children,
  secondary = false,
}: {
  to: string;
  children: ReactNode;
  secondary?: boolean;
}) {
  return (
    <Link to={to as never} className={`public-action ${secondary ? "is-secondary" : ""}`}>
      {children}
      <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
    </Link>
  );
}

export function PublicHero({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="public-hero" aria-labelledby="public-hero-title">
      {eyebrow ? <p className="public-eyebrow">{eyebrow}</p> : null}
      <h1 id="public-hero-title">{title}</h1>
      {description ? <p className="public-hero-description">{description}</p> : null}
      <div className="public-actions">{children}</div>
    </section>
  );
}

export function PublicSection({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="public-editorial-section" aria-labelledby={`${id}-title`}>
      <div>
        {eyebrow ? <p className="public-eyebrow">{eyebrow}</p> : null}
        <h2 id={`${id}-title`}>{title}</h2>
      </div>
      <div className="public-editorial-body">{children}</div>
    </section>
  );
}
