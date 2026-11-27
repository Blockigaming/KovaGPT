import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Play, RotateCcw } from "lucide-react";
import { PUBLICATIONS, type Publication } from "@/lib/publications";
import "./marketing-showcase.css";

type Demo = { label: string; prompt: string; steps: readonly string[] };
const demos: Record<string, Demo> = {
  chat: { label: "Chat", prompt: "Help me make a clear plan for a new project.", steps: ["Define the goal", "Break the work into milestones", "Choose the first action"] },
  search: { label: "Web search", prompt: "Find reliable sources about renewable energy.", steps: ["Frame the research question", "Compare sources and dates", "Review the cited findings"] },
  reasoning: { label: "Thinking", prompt: "Compare three ways to approach this problem.", steps: ["List the assumptions", "Compare the tradeoffs", "Check the recommendation"] },
  images: { label: "Images", prompt: "Create a geometric poster in blue and violet.", steps: ["Describe the composition", "Choose the visual direction", "Review the result"] },
  files: { label: "Files", prompt: "Summarize the key themes in these meeting notes.", steps: ["meeting-notes.pdf", "Identify decisions and questions", "Organize the action items"] },
  projects: { label: "Projects", prompt: "Create a workspace for my design project.", steps: ["Project instructions", "Research and reference files", "Related conversations"] },
  memory: { label: "Memory", prompt: "Keep my preference for concise answers in mind.", steps: ["Review memory settings", "Choose what to retain", "Manage saved preferences"] },
  library: { label: "Library", prompt: "Find the draft I was working on.", steps: ["Browse saved items", "Filter by category", "Open the original"] },
  voice: { label: "Voice", prompt: "Explain this idea in simple terms.", steps: ["Check microphone availability", "Review speech input", "Continue the conversation"] },
  agents: { label: "Agents", prompt: "Organize a research task with clear boundaries.", steps: ["Define the task", "Review permitted sources", "Inspect the result"] },
  "cloud-browser": { label: "Cloud Browser", prompt: "Research public product information.", steps: ["Choose a permitted site", "Review the browsing steps", "Check the findings"] },
  "scheduled-tasks": { label: "Scheduled Tasks", prompt: "Remind me to review my notes on Friday.", steps: ["Choose a schedule", "Review task availability", "Check the saved schedule"] },
  connections: { label: "Connections", prompt: "Find the document I need for this task.", steps: ["Choose an available connection", "Review permissions", "Select relevant information"] },
  research: { label: "Research", prompt: "Compare the evidence for these two approaches.", steps: ["Collect relevant material", "Identify gaps in evidence", "Summarize with sources"] },
  code: { label: "Code", prompt: "Help me understand why this function fails.", steps: ["Inspect the input", "Suggest a focused fix", "Review the tests"] },
  "temporary-chats": { label: "Temporary chat", prompt: "Start a separate conversation.", steps: ["Review temporary chat controls", "Ask a question", "Check the retention policy"] },
  "shared-chats": { label: "Sharing", prompt: "Prepare a conversation to share.", steps: ["Review the conversation", "Check sharing permissions", "Choose what to share"] },
  personalization: { label: "Personalization", prompt: "Make my responses easier to scan.", steps: ["Review preferences", "Choose a response style", "Check the result"] },
  security: { label: "Security", prompt: "Review my account controls.", steps: ["Review account settings", "Check data permissions", "Use the available security controls"] },
  mobile: { label: "Mobile", prompt: "Continue my work on the go.", steps: ["Open the mobile web experience", "Choose a conversation", "Continue your work"] },
  developers: { label: "Developer workflow", prompt: "Prepare a request to the KovaGPT API.", steps: ["Read the API documentation", "Configure an authorized key", "Review the response and errors"] },
};

export function MarketingDemo({ demo }: { demo: Demo }) {
  const [playing, setPlaying] = useState(true);
  const [replay, setReplay] = useState(0);
  return (
    <figure className="kova-marketing-demo" data-playing={playing ? "true" : "false"}>
      <div className="kova-marketing-demo-top">
        <span>KovaGPT / {demo.label}</span>
        <span>Illustrative demo</span>
      </div>
      <div className="kova-marketing-stage" key={replay}>
        <div className="kova-marketing-prompt">{demo.prompt}</div>
        {demo.label === "Images" && <div className="kova-marketing-art" aria-hidden="true"><i /><i /><i /></div>}
        {demo.label === "Voice" && <div className="kova-marketing-wave" aria-hidden="true">{[12, 24, 38, 18, 44, 30, 14, 34, 20].map((height, i) => <i key={i} style={{ height }} />)}</div>}
        <ol className="kova-marketing-steps">
          {demo.steps.map((step, i) => <li key={step} style={{ animationDelay: (i * 450 + 200) + "ms" }}><span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>{step}</li>)}
        </ol>
      </div>
      <figcaption className="kova-marketing-controls">
        <span>Example only. Availability varies by account.</span>
        <button type="button" onClick={() => { setPlaying(true); setReplay((n) => n + 1); }} aria-label="Replay demo"><RotateCcw size={15} aria-hidden="true" /> Replay</button>
        <button type="button" aria-pressed={!playing} onClick={() => setPlaying((value) => !value)}><Play size={15} aria-hidden="true" />{playing ? "Pause" : "Resume"}</button>
      </figcaption>
    </figure>
  );
}

export function FeatureMarketing({ path, title, sections }: { path: string; title: string; sections: readonly { title: string }[] }) {
  const slug = path.split("/").at(-1) ?? "";
  const demo = demos[slug] ?? (path.startsWith("/developers") ? demos.developers : { label: title, prompt: "Explore " + title.toLowerCase(), steps: sections.slice(0, 3).map((section) => section.title) });
  return <div className="kova-marketing-feature"><MarketingDemo key={path} demo={demo} /></div>;
}

const featuredFeatures = ["chat", "search", "reasoning", "images", "files", "projects", "voice", "agents", "cloud-browser", "scheduled-tasks", "connections", "research", "code", "memory", "library", "temporary-chats", "shared-chats", "personalization", "security", "mobile"] as const;
export function MarketingShowcase({ compact = false }: { compact?: boolean }) {
  const [active, setActive] = useState<string>("chat");
  const items = compact ? featuredFeatures.slice(0, 6) : featuredFeatures;
  return (
    <section className="kova-marketing-showcase" aria-label="Explore KovaGPT demonstrations">
      <h2>See KovaGPT in action.</h2>
      <p>Explore illustrated workflows, then open the feature guide for availability and details.</p>
      <div className="kova-marketing-tabs" aria-label="Choose a demonstration">
        {items.map((slug) => <button key={slug} type="button" aria-pressed={active === slug} onClick={() => setActive(slug)}>{demos[slug].label}</button>)}
      </div>
      <MarketingDemo key={active} demo={demos[active]} />
      <Link to={("/features/" + active) as never} className="kova-marketing-link">Explore {demos[active].label} <ArrowRight size={16} aria-hidden="true" /></Link>
    </section>
  );
}

function PublicationCover({ item }: { item: Publication }) {
  return <div className="kova-marketing-cover" data-category={item.section} aria-hidden="true"><span>KovaGPT / {item.section.replaceAll("-", " ")}</span><div className="kova-marketing-cover-shape"><i /><i /><i /></div></div>;
}
export function MarketingNews({
  items = PUBLICATIONS,
  heading = "Latest from KovaGPT",
}: {
  items?: readonly Publication[];
  heading?: string;
}) {
  const [category, setCategory] = useState("all");
  const sorted = [...items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const categories = [...new Set(sorted.map((item) => item.section))];
  const visible = sorted.filter((item) => category === "all" || item.section === category);
  if (!sorted.length) return null;
  return (
    <section className="kova-marketing-news col-span-full" aria-label={heading}>
      <h2>{heading}</h2>
      {categories.length > 1 && (
        <div className="kova-marketing-tabs" aria-label="Filter publications">
          {["all", ...categories].map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
              className="capitalize"
            >
              {item.replaceAll("-", " ")}
            </button>
          ))}
        </div>
      )}
      <div className="kova-marketing-news-grid">
        {visible.map((item, i) => (
          <Link
            key={item.section + "/" + item.slug}
            to={("/" + item.section + "/" + item.slug) as never}
            className="kova-marketing-news-card"
            data-featured={i === 0 ? "true" : "false"}
          >
            <PublicationCover item={item} />
            <div>
              <p className="kova-marketing-meta">
                {item.section.replaceAll("-", " ")} ·{" "}
                <time dateTime={item.publishedAt}>{item.publishedAt}</time>
              </p>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <span className="kova-marketing-link">
                Read article <ArrowRight size={15} aria-hidden="true" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function PublicationVisual({ item }: { item: Publication }) {
  return (
    <div className="col-span-full">
      <PublicationCover item={item} />
    </div>
  );
}
