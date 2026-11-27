import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Copy } from "lucide-react";

const examples = {
  cURL: [
    'curl https://kovagpt.com/api/v1/models \\',
    '  -H "Authorization: Bearer $KOVA_API_KEY"',
  ].join("\n"),
  JavaScript: [
    'const response = await fetch(',
    '  "https://kovagpt.com/api/v1/models",',
    '  { headers: {',
    '    Authorization: "Bearer " + process.env.KOVA_API_KEY,',
    '  } },',
    ');',
    'if (!response.ok) throw new Error(String(response.status));',
    'console.log(await response.json());',
  ].join("\n"),
  Python: [
    "import os, json, urllib.request",
    "",
    'request = urllib.request.Request(',
    '    "https://kovagpt.com/api/v1/models",',
    '    headers={"Authorization": "Bearer " + os.environ["KOVA_API_KEY"]},',
    ")",
    "with urllib.request.urlopen(request) as response:",
    "    print(json.load(response))",
  ].join("\n"),
};

type Language = keyof typeof examples;
const languages = Object.keys(examples) as Language[];

export function DeveloperMarketing() {
  const [language, setLanguage] = useState<Language>("cURL");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(examples[language]);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <section className="kova-marketing-showcase col-span-full" aria-label="Developer examples">
      <h2>From idea to integration.</h2>
      <p>
        Explore the versioned API with a scoped server-side key. Paid operations require a matching
        quote, enabled account, and funding.
      </p>
      <div className="kova-developer-example">
        <div className="kova-marketing-tabs" aria-label="Code language">
          {languages.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={language === item}
              onClick={() => {
                setLanguage(item);
                setCopied(false);
                setCopyError(false);
              }}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="kova-developer-terminal">
          <div className="kova-developer-toolbar">
            <span>GET /api/v1/models</span>
            <button type="button" onClick={copy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre tabIndex={0}>
            <code>{examples[language]}</code>
          </pre>
        </div>
        {copyError && <p role="status">Copy is unavailable. Select the example to copy it manually.</p>}
      </div>
      <div className="kova-developer-flow">
        {[
          ["01", "Discover models", "GET /api/v1/models"],
          ["02", "Request a quote", "POST /api/v1/quotes"],
          ["03", "Submit identical input", "X-Kova-Quote + Idempotency-Key"],
        ].map(([number, title, description]) => (
          <article key={number}>
            <span>{number}</span>
            <h3>{title}</h3>
            <p>{description}</p>
          </article>
        ))}
      </div>
      <div className="flex flex-wrap gap-5">
        <Link to="/developers/console" className="kova-marketing-link">
          Open developer console <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <Link
          to="/developers/$docSlug"
          params={{ docSlug: "quickstart" }}
          className="kova-marketing-link"
        >
          Read the quickstart <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
