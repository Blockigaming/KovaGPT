import { createFileRoute } from "@tanstack/react-router";

// The shared workspace lives in the root so a new saved URL never interrupts a stream.
export const Route = createFileRoute("/c/$conversationId")({
  component: () => null,
  head: () => ({ meta: [{ title: "Chat · KovaGPT" }, { name: "robots", content: "noindex" }] }),
});
