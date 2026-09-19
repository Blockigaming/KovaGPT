import { Link } from "@tanstack/react-router";

/** A state inside the page's existing main landmark; it never enables a feature. */
export function PublicState({
  kind,
  title,
  children,
  action,
}: {
  kind: "loading" | "empty" | "unavailable" | "error";
  title: string;
  children: string;
  action?: Readonly<{ label: string; to: string }>;
}) {
  return (
    <section
      data-public-state={kind}
      aria-busy={kind === "loading" ? true : undefined}
      className="mx-auto w-full min-w-0 max-w-2xl rounded-3xl border border-border bg-card p-6 [overflow-wrap:anywhere] sm:p-10"
    >
      <div
        role={kind === "error" ? "alert" : "status"}
        aria-live={kind === "error" ? "assertive" : "polite"}
      >
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-3 max-w-prose leading-relaxed text-muted-foreground">{children}</p>
      </div>
      {action && kind !== "loading" ? (
        <Link
          to={action.to as never}
          className="mt-6 inline-flex min-h-11 min-w-0 max-w-full items-center justify-center rounded-full border border-border px-5 py-2.5 text-center text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {action.label}
        </Link>
      ) : null}
    </section>
  );
}
