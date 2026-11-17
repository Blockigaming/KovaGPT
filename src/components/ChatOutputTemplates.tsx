import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  chatOutputTemplates,
  chatOutputTypes,
  type ChatOutputFormat,
} from "@/lib/chat-output-templates";
import "./chat-output-templates.css";

export function ChatOutputTemplates({
  format,
  onClose,
  onChoose,
}: {
  format: ChatOutputFormat;
  onClose: () => void;
  onChoose: (template?: string) => void;
}) {
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
        <button type="button" className="kova-template-custom" onClick={() => onChoose()}>
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
