import { useEffect, useRef, useState } from "react";
import { ChevronDown, ArrowUpRight } from "lucide-react";
import "./approved-marketing.css";
import "./marketing-pages.css";

export function MarketingHeader() {
  const headerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const root = headerRef.current;
    if (!root) return;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    root.querySelectorAll<HTMLDetailsElement>("details").forEach((menu) => {
      menu.addEventListener(
        "mouseenter",
        () => {
          if (window.matchMedia("(hover:hover)").matches) menu.open = true;
        },
        options,
      );
      menu.addEventListener(
        "mouseleave",
        () => {
          if (window.matchMedia("(hover:hover)").matches) menu.open = false;
        },
        options,
      );
      menu.addEventListener(
        "focusout",
        (event) => {
          if (!menu.contains(event.relatedTarget as Node | null)) menu.open = false;
        },
        options,
      );
    });
    document.addEventListener(
      "click",
      (event) => {
        root.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((menu) => {
          if (!menu.contains(event.target as Node)) menu.open = false;
        });
      },
      options,
    );
    root.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          root.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((menu) => {
            menu.open = false;
            menu.querySelector("summary")?.focus();
          });
          setOpen(false);
          if (window.matchMedia("(max-width:1000px)").matches) toggleRef.current?.focus();
        }
      },
      options,
    );
    return () => controller.abort();
  }, []);
  return (
    <header ref={headerRef} className="nav">
      <a className="logo" href="/overview">
        <img src="/kova-logo.png" alt="" />
        {"KovaGPT"}
      </a>
      <button
        ref={toggleRef}
        className="marketing-menu pill sales"
        type="button"
        aria-expanded={open}
        aria-controls="marketing-navigation"
        onClick={() => setOpen(!open)}
      >
        {open ? "Close" : "Menu"}
      </button>
      <nav
        id="marketing-navigation"
        data-open={open}
        className="navlinks"
        aria-label="Main navigation"
      >
        <details className="nav-dropdown">
          <summary>
            {"Products "}
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="quicklinks">
            <a href="/features">{"All products"}</a>
            <a href="/">{"KovaGPT"}</a>
            <a href="/features/chat">{"Chat"}</a>
            <a href="/features/projects">{"Projects"}</a>
            <a href="/features/images">{"Images"}</a>
            <a href="/features/library">{"Library"}</a>
            <a href="/features/search">{"Search"}</a>
            <a href="/features/reasoning">{"Thinking"}</a>
            <a href="/features/agents">{"Agents"}</a>
            <a href="/features/cloud-browser">{"Cloud Browser"}</a>
          </div>
        </details>
        <details className="nav-dropdown">
          <summary>
            {"Info "}
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="quicklinks">
            <a href="/info">{"Overview"}</a>
            <a href="/help">{"Help Center"}</a>
            <a href="/help/getting-started">{"Getting started"}</a>
            <a href="/resources/guides">{"Guides"}</a>
            <a href="/resources/tutorials">{"Tutorials"}</a>
            <a href="/resources/faq">{"FAQ"}</a>
            <a href="/resources/updates">{"Product updates"}</a>
            <a href="/status">{"Status"}</a>
            <a href="/help/contact">{"Contact support"}</a>
          </div>
        </details>
        <details className="nav-dropdown">
          <summary>
            {"Developer "}
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="quicklinks">
            <a href="/developers">{"Overview"}</a>
            <a href="/developers/docs">{"Documentation"}</a>
            <a href="/developers/quickstart">{"Quickstart"}</a>
            <a href="/developers/authentication">{"Authentication"}</a>
            <a href="/developers/models">{"Models"}</a>
            <a href="/developers/responses">{"Responses"}</a>
            <a href="/developers/images">{"Images"}</a>
            <a href="/developers/webhooks">{"Webhooks"}</a>
            <a href="/developers/rate-limits">{"Rate limits"}</a>
            <a href="/developers/changelog">{"Changelog"}</a>
          </div>
        </details>
        <details className="nav-dropdown">
          <summary>
            {"Business "}
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="quicklinks">
            <a href="/business">{"For business"}</a>
            <a href="/contact">{"Contact sales"}</a>
          </div>
        </details>
        <details className="nav-dropdown">
          <summary>
            {"Pricing "}
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="quicklinks">
            <a href="/pricing">{"KovaGPT plans"}</a>
            <a href="/developers/pricing">{"API pricing"}</a>
          </div>
        </details>
        <details className="nav-dropdown">
          <summary>
            {"Articles "}
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="quicklinks">
            <a href="/news">{"Kovapedia"}</a>
            <a href="/news/argon">{"Argon"}</a>
            <a href="/news/neon">{"Neon"}</a>
            <a href="/news/interactive-workspace">{"Interactive workspace"}</a>
          </div>
        </details>
      </nav>
      <div className="navright">
        <a className="pill sales" href="/contact">
          {"Contact sales"}
        </a>
        <details className="try-dropdown">
          <summary className="pill black">
            {"Try for free "}
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="quicklinks">
            <a href="/">
              {"KovaGPT "}
              <ArrowUpRight aria-hidden="true" />
            </a>
            <a href="/developers">
              {"Developers "}
              <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
        </details>
      </div>
      <a href="#main-content" className="marketing-skip">
        Skip to content
      </a>
    </header>
  );
}
export function MarketingFooter() {
  return (
    <footer className="site-footer" id="kx-footer">
      <div className="footer-brand">
        <a href="/overview">
          <img src="/kova-logo.png" alt="" />
          {"KovaGPT"}
        </a>
        <small>{"© 2026 KovaGPT"}</small>
      </div>
      <div className="footer-columns">
        <section>
          <h3>{"Products"}</h3>
          <a href="/">{"KovaGPT"}</a>
          <a href="/features">{"Features"}</a>
          <a href="/features/projects">{"Projects"}</a>
          <a href="/features/images">{"Images"}</a>
          <a href="/features/voice">{"Voice"}</a>
          <a href="/download">{"Download"}</a>
        </section>
        <section>
          <h3>{"Explore"}</h3>
          <a href="/business">{"Business"}</a>
          <a href="/use-cases">{"Use cases"}</a>
          <a href="/pricing">{"Pricing"}</a>
          <a href="/news">{"Kovapedia"}</a>
        </section>
        <section>
          <h3>{"Developers"}</h3>
          <a href="/developers">{"API overview"}</a>
          <a href="/developers/quickstart">{"Quickstart"}</a>
          <a href="/developers/models">{"Models"}</a>
          <a href="/developers/pricing">{"API pricing"}</a>
          <a href="/developers/console">{"Console"}</a>
        </section>
        <section>
          <h3>{"Company"}</h3>
          <a href="/about">{"About"}</a>
          <a href="/news">{"News"}</a>
          <a href="/contact">{"Contact"}</a>
          <a href="/help">{"Help center"}</a>
        </section>
        <section>
          <h3>{"Trust"}</h3>
          <a href="/security">{"Security"}</a>
          <a href="/privacy">{"Privacy"}</a>
          <a href="/terms">{"Terms"}</a>
          <a href="/features">{"All guides"}</a>
        </section>
      </div>
    </footer>
  );
}
