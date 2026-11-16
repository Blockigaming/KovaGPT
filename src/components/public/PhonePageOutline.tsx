import { ChevronDown } from "lucide-react";

export function PhonePageOutline({ sections }: { sections: readonly { title: string }[] }) {
  if (sections.length < 2) return null;

  return (
    <details className="public-phone-outline">
      <summary>
        On this page
        <ChevronDown size={17} aria-hidden="true" />
      </summary>
      <nav aria-label="Page sections">
        <ul>
          {sections.map(({ title }, index) => (
            <li key={title}>
              <a href={`#section-${index + 1}`}>{title}</a>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
