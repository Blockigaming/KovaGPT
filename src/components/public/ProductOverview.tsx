import { MarketingHeader, MarketingFooter } from "./MarketingChrome";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight, Code2 } from "lucide-react";
import "./approved-marketing.css";
const galleryImages = Array.from({ length: 6 }, (_, i) => `/marketing/scene-${i + 1}.jpg`);
const words = ["build", "write", "learn", "create"];
export function ProductOverview() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [wordIndex, setWordIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const images = window.setInterval(() => {
      if (!motion.matches && !document.hidden) setImageIndex((i) => (i + 1) % galleryImages.length);
    }, 2000);
    const headline = window.setInterval(() => {
      if (!motion.matches && !document.hidden) setWordIndex((i) => (i + 1) % words.length);
    }, 2800);
    root.querySelectorAll<HTMLDetailsElement>(".nav-dropdown").forEach((menu) => {
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
      (event) =>
        root.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((menu) => {
          if (!menu.contains(event.target as Node)) menu.open = false;
        }),
      options,
    );
    root.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape")
          root.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((menu) => {
            menu.open = false;
            menu.querySelector("summary")?.focus();
          });
      },
      options,
    );
    return () => {
      clearInterval(images);
      clearInterval(headline);
      controller.abort();
    };
  }, []);
  return (
    <div id="kx" ref={rootRef} data-public-shell data-ui="modern">
      <MarketingHeader />
      <main id="main-content" tabIndex={-1}>
        <section className="hero">
          <a className="badge" href="#kx-products">
            <em>{"Explore"}</em>
            <span>{"Meet KovaGPT · Your AI workspace"}</span>
            <span>
              <ArrowUpRight aria-hidden="true" />
            </span>
          </a>
          <h1>
            {"AI for everything"}
            <br />
            {"you think, create, and "}
            <span className="word" id="kx-word">
              {words[wordIndex]}
            </span>
            {"."}
          </h1>
          <p>{"Chat. Create. Code. All in KovaGPT."}</p>
          <div className="actions">
            <a className="pill black" href="/">
              {"Try KovaGPT "}
              <ArrowUpRight aria-hidden="true" />
            </a>
            <a className="pill" href="#kx-products">
              {"Explore features"}
            </a>
          </div>
        </section>
        <section className="products" id="kx-products">
          <a className="product code" href="/features/code">
            <div className="terminal">
              <div className="bar">{"● ● ●　 kova_client.py"}</div>
              <div className="long-code-viewport">
                <div className="long-code-track">
                  <pre>
                    <span className="kw">{"import"}</span>
                    {" os\n"}
                    <span className="kw">{"import"}</span>
                    {" time\n"}
                    <span className="kw">{"from"}</span>
                    {" dataclasses "}
                    <span className="kw">{"import"}</span>
                    {" dataclass\n"}
                    <span className="kw">{"from"}</span>
                    {" typing "}
                    <span className="kw">{"import"}</span>
                    {" Any\n"}
                    <span className="kw">{"import"}</span>
                    {" requests\n\n@dataclass\n"}
                    <span className="kw">{"class"}</span>
                    {" KovaClient:\n    api_key: str\n    base_url: str = "}
                    <span className="str">{'"https://kovagpt.com/api/v1"'}</span>
                    {"\n    timeout: int = 30\n\n    "}
                    <span className="kw">{"def"}</span>
                    {" headers(self) -> dict[str, str]:\n        "}
                    <span className="kw">{"return"}</span>
                    {" {\n            "}
                    <span className="str">{'"Authorization"'}</span>
                    {": f"}
                    <span className="str">{'"Bearer {self.api_key}"'}</span>
                    {",\n            "}
                    <span className="str">{'"Accept"'}</span>
                    {": "}
                    <span className="str">{'"application/json"'}</span>
                    {",\n        }\n\n    "}
                    <span className="kw">{"def"}</span>
                    {" list_models(self) -> Any:\n        response = requests.get(\n            f"}
                    <span className="str">{'"{self.base_url}/models"'}</span>
                    {
                      ",\n            headers=self.headers(),\n            timeout=self.timeout,\n        )\n        response.raise_for_status()\n        "
                    }
                    <span className="kw">{"return"}</span>
                    {" response.json()\n\n    "}
                    <span className="kw">{"def"}</span>
                    {" check_connection(self) -> bool:\n        "}
                    <span className="kw">{"try"}</span>
                    {":\n            self.list_models()\n            "}
                    <span className="kw">{"return"}</span>
                    <span className="kw">{"True"}</span>
                    <span className="kw">{"except"}</span>
                    {" requests.RequestException:\n            "}
                    <span className="kw">{"return"}</span>
                    <span className="kw">{"False"}</span>
                    <span className="kw">{"def"}</span>
                    {" main() -> None:\n    key = os.environ["}
                    <span className="str">{'"KOVA_API_KEY"'}</span>
                    {
                      "]\n    client = KovaClient(api_key=key)\n    started = time.monotonic()\n    catalog = client.list_models()\n    elapsed = time.monotonic() - started\n    print("
                    }
                    <span className="str">{'"Available models:"'}</span>
                    {")\n    print(catalog)\n    print(f"}
                    <span className="str">{'"Loaded in {elapsed:.2f}s"'}</span>
                    {")\n\n"}
                    <span className="kw">{"if"}</span>
                    {" __name__ == "}
                    <span className="str">{'"__main__"'}</span>
                    {":\n    main()"}
                  </pre>
                  <pre aria-hidden="true">
                    <span className="kw">{"import"}</span>
                    {" os\n"}
                    <span className="kw">{"import"}</span>
                    {" time\n"}
                    <span className="kw">{"from"}</span>
                    {" dataclasses "}
                    <span className="kw">{"import"}</span>
                    {" dataclass\n"}
                    <span className="kw">{"from"}</span>
                    {" typing "}
                    <span className="kw">{"import"}</span>
                    {" Any\n"}
                    <span className="kw">{"import"}</span>
                    {" requests\n\n@dataclass\n"}
                    <span className="kw">{"class"}</span>
                    {" KovaClient:\n    api_key: str\n    base_url: str = "}
                    <span className="str">{'"https://kovagpt.com/api/v1"'}</span>
                    {"\n    timeout: int = 30\n\n    "}
                    <span className="kw">{"def"}</span>
                    {" headers(self) -> dict[str, str]:\n        "}
                    <span className="kw">{"return"}</span>
                    {" {\n            "}
                    <span className="str">{'"Authorization"'}</span>
                    {": f"}
                    <span className="str">{'"Bearer {self.api_key}"'}</span>
                    {",\n            "}
                    <span className="str">{'"Accept"'}</span>
                    {": "}
                    <span className="str">{'"application/json"'}</span>
                    {",\n        }\n\n    "}
                    <span className="kw">{"def"}</span>
                    {" list_models(self) -> Any:\n        response = requests.get(\n            f"}
                    <span className="str">{'"{self.base_url}/models"'}</span>
                    {
                      ",\n            headers=self.headers(),\n            timeout=self.timeout,\n        )\n        response.raise_for_status()\n        "
                    }
                    <span className="kw">{"return"}</span>
                    {" response.json()\n\n    "}
                    <span className="kw">{"def"}</span>
                    {" check_connection(self) -> bool:\n        "}
                    <span className="kw">{"try"}</span>
                    {":\n            self.list_models()\n            "}
                    <span className="kw">{"return"}</span>
                    <span className="kw">{"True"}</span>
                    <span className="kw">{"except"}</span>
                    {" requests.RequestException:\n            "}
                    <span className="kw">{"return"}</span>
                    <span className="kw">{"False"}</span>
                    <span className="kw">{"def"}</span>
                    {" main() -> None:\n    key = os.environ["}
                    <span className="str">{'"KOVA_API_KEY"'}</span>
                    {
                      "]\n    client = KovaClient(api_key=key)\n    started = time.monotonic()\n    catalog = client.list_models()\n    elapsed = time.monotonic() - started\n    print("
                    }
                    <span className="str">{'"Available models:"'}</span>
                    {")\n    print(catalog)\n    print(f"}
                    <span className="str">{'"Loaded in {elapsed:.2f}s"'}</span>
                    {")\n\n"}
                    <span className="kw">{"if"}</span>
                    {" __name__ == "}
                    <span className="str">{'"__main__"'}</span>
                    {":\n    main()"}
                  </pre>
                </div>
              </div>
            </div>
            <footer>
              <span>{"Code"}</span>
              <span>
                {"Explore "}
                <ArrowRight aria-hidden="true" />
              </span>
            </footer>
          </a>
          <a className="product" href="/projects">
            <div className="taskdemo">
              <div className="request">{"Turn my notes into a plan for the week."}</div>
              <div className="reply">{"Three priorities. A clear next step."}</div>
              <div className="done">
                {"✓ Monday · Start the draft"}
                <br />
                {"✓ Tuesday · Review the details"}
                <br />
                {"✓ Wednesday · Share your work"}
              </div>
            </div>
            <footer>
              <span>{"Projects"}</span>
              <span>
                {"Explore "}
                <ArrowRight aria-hidden="true" />
              </span>
            </footer>
          </a>
          <a className="product wide" href="/images">
            <div className="image-demo">
              {galleryImages.map((src, index) => (
                <img
                  key={src}
                  src={src}
                  alt={index === imageIndex ? "AI-generated showcase" : ""}
                  aria-hidden={index !== imageIndex}
                  className="marketing-gallery-frame"
                  style={{ opacity: index === imageIndex ? 1 : 0 }}
                />
              ))}
              <div className="scene-controls">
                <button
                  id="kx-scene-prev"
                  aria-label="Previous image"
                  type="button"
                  onClick={() =>
                    setImageIndex((i) => (i + galleryImages.length - 1) % galleryImages.length)
                  }
                >
                  {"‹"}
                </button>
                <span id="kx-scene-count">
                  {imageIndex + 1} / {galleryImages.length}
                </span>
                <button
                  id="kx-scene-next"
                  aria-label="Next image"
                  type="button"
                  onClick={() => setImageIndex((i) => (i + 1) % galleryImages.length)}
                >
                  {"›"}
                </button>
              </div>
              <span className="image-credit">AI-generated examples</span>
              <small>{"Make something your own."}</small>
              <strong>{"Create images."}</strong>
            </div>
            <footer>
              <span>{"Images"}</span>
              <span>
                {"Explore "}
                <ArrowRight aria-hidden="true" />
              </span>
            </footer>
          </a>
          <a className="product wide" href="/features/voice">
            <div className="voice-demo" aria-label="Voice waveform">
              <i style={{ "--height": "16px" } as CSSProperties}></i>
              <i style={{ "--height": "25px" } as CSSProperties}></i>
              <i style={{ "--height": "54px" } as CSSProperties}></i>
              <i style={{ "--height": "80px" } as CSSProperties}></i>
              <i style={{ "--height": "43px" } as CSSProperties}></i>
              <i style={{ "--height": "98px" } as CSSProperties}></i>
              <i style={{ "--height": "125px" } as CSSProperties}></i>
              <i style={{ "--height": "82px" } as CSSProperties}></i>
              <i style={{ "--height": "49px" } as CSSProperties}></i>
              <i style={{ "--height": "73px" } as CSSProperties}></i>
              <i style={{ "--height": "40px" } as CSSProperties}></i>
              <i style={{ "--height": "22px" } as CSSProperties}></i>
            </div>
            <footer>
              <span>{"Voice"}</span>
              <span>
                {"Explore "}
                <ArrowRight aria-hidden="true" />
              </span>
            </footer>
          </a>
        </section>
        <section className="section developer" id="kx-developer">
          <div>
            <div className="eyebrow">{"For developers"}</div>
            <h2>
              {"Your next idea."}
              <br />
              {"Powered by Kova."}
            </h2>
            <p>
              {"Build with the KovaGPT API."}
              <br />
              {"Start with Python. Explore the model catalog."}
            </p>
            <div className="leftactions">
              <a className="pill black" href="/developers">
                {"Explore the API "}
                <ArrowUpRight aria-hidden="true" />
              </a>
              <a className="pill" href="/developers/quickstart">
                {"Read docs"}
              </a>
            </div>
          </div>
          <div className="api-window">
            <div className="api-top">
              <span>{"Python"}</span>
              <button
                type="button"
                className="cursor-interaction"
                id="kx-pause"
                onClick={() => setPaused((value) => !value)}
                aria-pressed={paused}
              >
                {paused ? "Resume animation" : "Pause animation"}
              </button>
            </div>
            <div
              className="api-viewport"
              aria-label="Python example: list available KovaGPT models"
            >
              <pre
                className="api-scroll"
                data-paused={paused}
                style={{ animationPlayState: paused ? "paused" : "running" }}
              >
                <code>
                  <span className="kw">{"import"}</span>
                  {" os\n"}
                  <span className="kw">{"import"}</span>
                  {" requests\n"}
                  <span className="comment">{"# Connect with your developer key"}</span>
                  {"\nheaders = {\n    "}
                  <span className="str">{'"Authorization"'}</span>
                  {": "}
                  <span className="str">{"f\"Bearer {os.environ['KOVA_API_KEY']}\""}</span>
                  {"\n}\n"}
                  <span className="comment">{"# Discover available models"}</span>
                  {"\nresponse = requests."}
                  <span className="fn">{"get"}</span>
                  {"(\n    "}
                  <span className="str">{'"https://kovagpt.com/api/v1/models"'}</span>
                  {",\n    headers=headers,\n    timeout="}
                  <span className="num">{"30"}</span>
                  {",\n)\nresponse."}
                  <span className="fn">{"raise_for_status"}</span>
                  {"()\nmodels = response."}
                  <span className="fn">{"json"}</span>
                  {"()\n"}
                  <span className="fn">{"print"}</span>
                  {"(models)\n"}
                </code>
              </pre>
            </div>
            <div className="api-caption">{"Model catalog example · Python / requests"}</div>
          </div>
        </section>
        <section className="news" id="kx-news">
          <div className="news-heading">
            <div>
              <div className="eyebrow">{"Latest from KovaGPT"}</div>
              <h2>{"Kovapedia"}</h2>
            </div>
            <a href="/news">
              {"Explore all "}
              <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
          <div className="news-grid">
            <a href="/news/argon">
              <div className="news-art argon">
                <div className="model-face argon-face" aria-hidden="true">
                  <i></i>
                  <i></i>
                  <b></b>
                </div>
                <strong>{"Argon"}</strong>
              </div>
              <small>{"KovaGPT model"}</small>
              <h3>{"Inside Argon: from question to clarity"}</h3>
            </a>
            <a href="/news/neon">
              <div className="news-art neon">
                <div className="model-face neon-face" aria-hidden="true">
                  <i></i>
                  <i></i>
                  <b></b>
                </div>
                <strong>{"Neon"}</strong>
              </div>
              <small>{"KovaGPT model"}</small>
              <h3>{"Meet Neon. Explore another way to think."}</h3>
            </a>
            <a href="/news/interactive-workspace">
              <div className="news-art interface">
                <div className="matching-mark workspace-mark product-brand-mark">
                  <img src="/kova-logo.png" alt="KovaGPT logo" />
                </div>
                <strong className="matching-name">{"KovaGPT"}</strong>
              </div>
              <small>{"Product · Feature guide"}</small>
              <h3>{"KovaGPT is moving beyond the chat box"}</h3>
            </a>
            <a href="/news/developer-platform">
              <div className="news-art api-art">
                <div className="matching-mark api-mark" aria-hidden="true">
                  <Code2 aria-hidden="true" />
                </div>
                <strong className="matching-name">{"KovaGPT API"}</strong>
              </div>
              <small>{"Developers · Platform overview"}</small>
              <h3>{"Your next app could start with KovaGPT"}</h3>
            </a>
          </div>
        </section>
        <section className="getting" id="kx-get-started">
          <h2>{"Choose how to get started"}</h2>
          <div className="choices">
            <article className="choice">
              <h3>{"Make it your everyday AI"}</h3>
              <p>{"Start a conversation with KovaGPT."}</p>
              <ul>
                <li>{"Ask questions and explore ideas"}</li>
                <li>{"Get help with writing and code"}</li>
                <li>{"Keep your work in one place"}</li>
              </ul>
              <a className="pill black" href="/">
                {"Try for free "}
                <ArrowUpRight aria-hidden="true" />
              </a>
            </article>
            <article className="choice">
              <h3>{"Get more from Kova"}</h3>
              <p>{"Find the plan that fits how you work."}</p>
              <ul>
                <li>{"Compare Free, Plus, and Pro"}</li>
                <li>{"Explore included features"}</li>
                <li>{"Review your plan allowances"}</li>
              </ul>
              <a className="pill black" href="/pricing">
                {"Explore plans "}
                <ArrowUpRight aria-hidden="true" />
              </a>
            </article>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
