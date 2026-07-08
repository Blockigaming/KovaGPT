import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoLandingHead } from "@/components/SeoLanding";

const faq = [
  {
    q: "Is KovaGPT a real ChatGPT alternative?",
    a: "Yes. KovaGPT is an AI chatbot that handles writing, studying, coding, research, and image generation in a single app, with focused modes so you get answers tuned to the task instead of a one-size-fits-all reply.",
  },
  {
    q: "Do I need to pay to try it?",
    a: "No. You can try KovaGPT free with a generous daily allowance. Paid plans unlock higher limits, priority models, larger uploads, and image generation credits.",
  },
  {
    q: "Can KovaGPT connect to my Gmail and Google Calendar?",
    a: "Yes. Connect your Google account from the Apps page and KovaGPT can search email, read messages, draft or send email, and create calendar events — always asking you to confirm before it sends anything.",
  },
  {
    q: "Does KovaGPT keep my chats private?",
    a: "Your conversations are stored in your account so you can pick them up later. You can delete any chat at any time, and we never sell your data.",
  },
];

export const Route = createFileRoute("/chatgpt-alternative")({
  head: () =>
    seoLandingHead({
      title: "ChatGPT Alternative for Work, Study & Creativity | KovaGPT",
      description:
        "KovaGPT is a fast ChatGPT alternative with focused modes for writing, studying, coding, research, and image generation. Free to try, no card required.",
      path: "/chatgpt-alternative",
      faq,
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="The ChatGPT Alternative Built Around How You Actually Work"
      intro="KovaGPT is a modern AI chatbot that swaps a blank prompt for focused modes — writing, study, code, research, images, everyday chat — so answers arrive tuned to the task. It runs fast, remembers what you asked, and can act on Gmail and Google Calendar when you connect them."
      benefits={[
        "Purpose-built modes for writing, study, coding, research, and images",
        "Connect Gmail and Google Calendar to read, draft, and schedule",
        "Long-term memory of your projects, preferences, and tone",
        "Upload files, screenshots, and documents for context",
        "Saved chat history you can search and share",
        "Transparent pricing with a real free tier",
      ]}
      details={[
        "Most AI chatbots hand you a blank text box and expect you to figure out how to prompt them. KovaGPT flips that: pick a mode and the assistant already knows what good looks like — a study mode that explains step-by-step, a writer mode that keeps your voice, a code mode that debugs before it lectures.",
        "It also does the thing generic chatbots can't: real work in your inbox and calendar. Connect Google once and KovaGPT can find that email from your accountant, draft a reply in your tone, or schedule a meeting for next Tuesday — with a confirmation card before anything is sent.",
      ]}
      prompts={[
        "Draft a follow-up email to the client I met yesterday",
        "Summarize this PDF and pull out the three decisions",
        "Explain gradient descent like I'm a first-year CS student",
        "Find my Amazon receipts from November and total them",
        "Create a 30-minute focus block tomorrow at 10am",
      ]}
      ctas={[
        { label: "Try KovaGPT Free", to: "/" },
        { label: "See Pricing", to: "/pricing" },
        { label: "Explore Modes", to: "/modes" },
      ]}
      faq={faq}
    />
  );
}
