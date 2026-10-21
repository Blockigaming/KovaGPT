import { useState } from "react";
import { ResponseContentBox } from "../../src/components/ResponseMarkdown";

const text =
  "A clear plan starts with a small, reversible step.\n\nKeep the exact wording, spacing, and paragraph breaks when copying this sample.";
const code = `const example = "${"readable-long-code-".repeat(45)}";\nconsole.log(example);\n`;

/** Actual shared output component, with an explicit local clipboard dependency. */
export function ResponseCopyPreview() {
  const [reject, setReject] = useState(true);
  const writer = async (value: string) => {
    if (reject) throw new Error("Synthetic clipboard rejection");
    await navigator.clipboard.writeText(value);
  };
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Response copy control review</h1>
      <p className="text-sm text-muted-foreground">
        The real output-box component uses a local writer that can reject copying. No browser
        permission or clipboard API is changed. Turn off the rejection to copy the sample text.
      </p>
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={reject}
          onChange={(event) => setReject(event.target.checked)}
        />
        Simulate clipboard failure
      </label>
      <div className="prose-chat">
        <ResponseContentBox text={text} label="Draft sample" writeClipboard={writer}>
          {text.split("\n\n").map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </ResponseContentBox>
        <ResponseContentBox text={code} kind="code" label="JavaScript" writeClipboard={writer}>
          <pre>
            <code>{code}</code>
          </pre>
        </ResponseContentBox>
      </div>
    </section>
  );
}
