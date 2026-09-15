import { useEffect, useState } from "react";
import { PublicDetailPageView, PublicPageView } from "@/components/public/PublicSite";
import { PublicState } from "@/components/public/PublicState";
import { PublicShell } from "@/components/public/PublicShell";
import { SeoLanding } from "@/components/SeoLanding";
import { LegalArticle } from "@/components/LegalArticle";
import { PUBLIC_DETAIL_PAGES } from "@/lib/public-detail-content";
import { PUBLIC_ACADEMY_PAGES } from "@/lib/public-academy-content";
import { PUBLIC_POLICY_PAGES } from "@/lib/public-policy-content";
import { PUBLIC_BUSINESS_PAGES } from "@/lib/public-business-content";
import { PUBLIC_ECOSYSTEM_PAGES } from "@/lib/public-ecosystem-content";
import { PUBLIC_FORM_PAGES } from "@/lib/public-form-content";
import { PUBLIC_GLOBAL_AFFAIRS_PAGES } from "@/lib/public-global-affairs-content";
import { PUBLIC_SOLUTION_PAGES } from "@/lib/public-solution-content";

const catalog = [
  ...PUBLIC_DETAIL_PAGES,
  ...PUBLIC_ACADEMY_PAGES,
  ...PUBLIC_POLICY_PAGES,
  ...PUBLIC_BUSINESS_PAGES,
  ...PUBLIC_ECOSYSTEM_PAGES,
  ...PUBLIC_FORM_PAGES,
  ...PUBLIC_GLOBAL_AFFAIRS_PAGES,
  ...PUBLIC_SOLUTION_PAGES,
];
const metadata = catalog.map((item) => ({
  path: `/${item.section}/${item.slug}`,
  title: item.title,
}));
const longWord = "LongProjectReference".repeat(18);
const faqQuestion = "Can I keep a long project reference without losing its complete text?";

export function PublicFixture({ surface }: { surface: string }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const select = (event: Event) => {
      const value: unknown = (event as CustomEvent).detail;
      if (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value < catalog.length
      )
        setIndex(value);
    };
    window.addEventListener("kova-fixture-page", select);
    return () => window.removeEventListener("kova-fixture-page", select);
  }, []);

  if (surface === "public-landing") {
    return (
      <PublicPageView
        eyebrow="Synthetic fixture"
        title="One consistent public workspace"
        summary="A layout fixture for the shared landing page, not a statement of live capabilities."
        primaryAction={{ label: "Open KovaGPT", to: "/" }}
      >
        <article className="min-w-0 rounded-3xl border bg-card p-6">
          <h2 className="text-xl font-semibold">Clear hierarchy</h2>
          <p className="mt-3">{longWord}</p>
        </article>
        <article className="min-w-0 rounded-3xl border bg-card p-6">
          <h2 className="text-xl font-semibold">Room for the content</h2>
          <p className="mt-3">
            Real templates share space, controls and typography without copying page claims.
          </p>
        </article>
      </PublicPageView>
    );
  }
  if (surface === "public-detail") {
    return (
      <PublicDetailPageView item={{ ...catalog[0], faq: [{ q: faqQuestion, a: longWord }] }} />
    );
  }
  if (surface.startsWith("public-state-")) {
    const kind = surface.slice("public-state-".length) as
      "loading" | "empty" | "unavailable" | "error";
    return (
      <PublicShell>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full min-w-0 max-w-7xl px-4 py-12"
        >
          <h1 className="mb-8 text-4xl font-semibold">Public page state</h1>
          <PublicState
            kind={kind}
            title={`${kind[0].toUpperCase()}${kind.slice(1)} fixture`}
            action={{ label: "Return to KovaGPT", to: "/" }}
          >
            Synthetic state content, not a production error or availability claim.
          </PublicState>
        </main>
      </PublicShell>
    );
  }
  if (surface === "public-catalog") {
    return (
      <>
        <pre id="fixture-public-catalog" hidden>
          {JSON.stringify(metadata)}
        </pre>
        <div data-current-public-path={metadata[index].path}>
          <PublicDetailPageView item={catalog[index]} />
        </div>
      </>
    );
  }
  if (surface === "public-seo") {
    return (
      <SeoLanding
        h1="Keep your work readable at every screen size"
        intro={`A synthetic layout example, not a product claim. ${longWord}`}
        benefits={["Keep useful controls reachable.", longWord]}
        prompts={[`Compare this exact reference without shortening it: ${longWord}`]}
        ctas={[
          { label: "Open KovaGPT and continue reviewing your project", to: "/" },
          { label: "Review plans and available capabilities", to: "/pricing" },
        ]}
        faq={[{ q: faqQuestion, a: longWord }]}
      />
    );
  }
  return (
    <PublicShell>
      <LegalArticle>
        <h1>Readable document layout</h1>
        <p>
          This is synthetic verification content, not KovaGPT policy.{" "}
          <a href="#document-reference">{longWord}</a>
        </p>
        <h2 id="document-reference">Document reference</h2>
        <p>{longWord}</p>
        <ul>
          <li>Keep the complete text available while allowing it to wrap.</li>
        </ul>
      </LegalArticle>
    </PublicShell>
  );
}
