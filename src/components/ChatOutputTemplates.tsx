import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  chatOutputTemplates,
  parseCustomChatOutputTemplates,
  chatOutputTypes,
  type ChatOutputFormat,
} from "@/lib/chat-output-templates";
import { usePrincipalSessionPreferences } from "@/hooks/use-principal-session-preferences";
import "./chat-output-templates.css";

export function ChatOutputTemplates({
  format,
  onClose,
  onChoose,
  userKey,
}: {
  format: ChatOutputFormat;
  onClose: () => void;
  onChoose: (template: string, customInstructions?: string) => void;
  userKey: string | null;
}) {
  const [{ templates }, setTemplates] = usePrincipalSessionPreferences(
    "kova-chat-output-templates",
    userKey,
    parseCustomChatOutputTemplates,
  );
  const [customOpen, setCustomOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const customTemplates = templates.filter((template) => template.format === format);
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const move = (direction: number) => {
    const container = scroller.current;
    if (!container) return;
    container.scrollBy({ left: direction * container.clientWidth, behavior: "auto" });
  };
  return (
    <section
      className="kova-starter-templates"
      aria-label={`${chatOutputTypes[format].label} templates`}
    >
      <header>
        <h2>Templates</h2>
        <button
          type="button"
          className="kova-template-custom"
          aria-expanded={customOpen}
          onClick={() => setCustomOpen(!customOpen)}
        >
          Create template
        </button>
        <button
          type="button"
          aria-label="Previous templates"
          disabled={edges.start}
          onClick={() => move(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Next templates"
          disabled={edges.end}
          onClick={() => move(1)}
        >
          <ChevronRight aria-hidden="true" />
        </button>
        <button type="button" aria-label="Close templates" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      {customOpen && (
        <form
          className="kova-template-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim() || !instructions.trim()) return;
            const entry = { title: title.trim(), instructions: instructions.trim(), format };
            setTemplates({
              templates: [
                ...templates.filter(
                  (item) =>
                    item.format !== format ||
                    item.title.toLowerCase() !== entry.title.toLowerCase(),
                ),
                entry,
              ],
            });
            onChoose(entry.title, entry.instructions);
          }}
        >
          <label>
            Template name
            <input
              value={title}
              required
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Instructions
            <textarea
              value={instructions}
              required
              maxLength={1000}
              rows={3}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </label>
          <button type="submit" disabled={!title.trim() || !instructions.trim()}>
            Save and use template
          </button>
        </form>
      )}
      {customTemplates.length > 0 && (
        <div className="kova-template-saved" aria-label="Your templates">
          {customTemplates.map((template) => (
            <span key={template.title}>
              <button type="button" onClick={() => onChoose(template.title, template.instructions)}>
                {template.title}
              </button>
              <button
                type="button"
                aria-label={`Remove template ${template.title}`}
                onClick={() =>
                  setTemplates({ templates: templates.filter((item) => item !== template) })
                }
              >
                <X aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div
        className="kova-template-scroll"
        ref={scroller}
        onScroll={(event) => {
          const { scrollLeft, scrollWidth, clientWidth } = event.currentTarget;
          setEdges({ start: scrollLeft < 2, end: scrollLeft >= scrollWidth - clientWidth - 2 });
        }}
      >
        {chatOutputTemplates[format].map((template, index) => (
          <button
            type="button"
            key={template}
            className="kova-template-card"
            onClick={() => onChoose(template)}
          >
            <span className="kova-template-frame" aria-hidden="true">
              <span className="kova-template-preview" data-format={format} data-style={index % 3}>
                <strong>{template}</strong>
                <i />
              </span>
            </span>
            <span>{template}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
