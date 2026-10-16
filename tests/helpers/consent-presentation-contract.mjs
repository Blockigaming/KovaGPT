// The bounded presentation delta; callers compare all remaining executable source unchanged.
export function consentPresentation(source) {
  return source
    .replace("useEffect, useRef", "useEffect, useId, useRef")
    .replace(
      "  const [details, setDetails] = useState<Details | null>(null),",
      "  const limitsId = useId();\n  const [details, setDetails] = useState<Details | null>(null),",
    )
    .replace(
      '<section className="space-y-5 rounded-xl border p-5">',
      '<section className="kova-workspace-controls space-y-5 rounded-xl border p-5">',
    )
    .replace(
      '                <span>\n                  {key === "request"',
      '                <span id={`${limitsId}-${key}-label`}>\n                  {key === "request"',
    )
    .replace(
      '                        : "Concurrent requests"}\n                </span>',
      '                        : "Concurrent requests"}\n                  {key !== "concurrent" ? ` (${project.currency})` : ""}\n                </span>',
    )
    .replace(
      "                  aria-label={key}",
      "                  aria-labelledby={`${limitsId}-${key}-label`}\n                  aria-describedby={`${limitsId}-${key}-help`}",
    )
    .replace(
      '                <span className="text-xs text-muted-foreground">\n                  At most',
      '                <span id={`${limitsId}-${key}-help`} className="text-xs text-muted-foreground">\n                  At most',
    )
    .replace(
      "                        : project.concurrent_limit}\n                </span>",
      '                        : project.concurrent_limit}{" "}\n                  {key === "concurrent" ? "requests" : project.currency}\n                </span>',
    );
}
