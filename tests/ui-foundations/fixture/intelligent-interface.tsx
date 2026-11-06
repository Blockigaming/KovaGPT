import { useState } from "react";
import { InteractiveBlock } from "@/components/interactive-ui/InteractiveBlock";
import { validateInteractiveBlock } from "@/lib/interactive-ui.mjs";

const block = validateInteractiveBlock({
  version: 1,
  type: "form",
  id: "launch-next-step",
  title: "Choose your next step",
  actions: [
    {
      id: "plan",
      label: "Turn these recommendations into a step-by-step launch plan for my website",
      style: "primary",
    },
    { id: "compare", label: "Compare the options", style: "secondary" },
  ],
})!;

export function IntelligentInterfaceFixture() {
  const [messages, setMessages] = useState<string[]>([]);
  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <h1 className="text-xl font-semibold">Next steps</h1>
      <p>Here are the recommendations for your website.</p>
      <InteractiveBlock
        block={block}
        storageKey={null}
        onSubmit={(message) => setMessages((previous) => [...previous, message])}
      />
      <ol aria-label="Sent messages">
        {messages.map((message, index) => (
          <li key={index} className="whitespace-pre-wrap break-words">
            {message}
          </li>
        ))}
      </ol>
    </main>
  );
}
