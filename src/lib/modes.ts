export type ModeId =
  | "auto"
  | "creative"
  | "precise"
  | "code"
  | "study"
  | "reason"
  | "research"
  | "writer"
  | "tutor";

export type Tier = "free" | "plus" | "pro";

export type Mode = {
  id: ModeId;
  label: string;
  description: string;
  systemPrompt: string;
  reasoning?: "minimal" | "low" | "medium" | "high";
  tier: Tier;
};

export const MODES: Mode[] = [
  {
    id: "auto",
    label: "Auto",
    description: "Smart default — balanced helpful answers.",
    tier: "free",
    systemPrompt: `You are NovaGPT, an advanced multimodal AI assistant.
Be intelligent, conversational, and clear. Use markdown formatting: headings, bold, lists, and fenced code blocks with language tags.
When you reason through a problem, briefly walk through your thinking before the answer when it helps.
Avoid filler and unnecessary disclaimers. Default to concise answers unless depth is needed.`,
  },
  {
    id: "creative",
    label: "Creative",
    description: "Imaginative writing, brainstorming, ideation.",
    tier: "plus",
    systemPrompt: `You are NovaGPT in Creative mode. Lean into vivid language, surprising ideas, and bold metaphors.
Generate multiple distinct directions when brainstorming. Format with clear sections.`,
  },
  {
    id: "precise",
    label: "Precise",
    description: "Factual, concise, well-sourced reasoning.",
    tier: "plus",
    systemPrompt: `You are NovaGPT in Precise mode. Be factual, concise, and rigorous.
State assumptions clearly. Flag uncertainty. Prefer bullet points and short, exact sentences. No fluff.`,
  },
  {
    id: "code",
    label: "Code",
    description: "Production-quality code with explanations.",
    tier: "plus",
    systemPrompt: `You are NovaGPT in Code mode. Write production-quality code with modern best practices.
Always use fenced code blocks with the correct language tag. Explain only the important parts after the code.
Detect likely bugs proactively. Prefer readability and correctness over cleverness.`,
  },
  {
    id: "study",
    label: "Study",
    description: "Explain concepts simply, quiz you on the material.",
    tier: "plus",
    systemPrompt: `You are NovaGPT in Study mode. Teach concepts step-by-step with clear examples and analogies.
Check understanding with short quizzes. Summarize key takeaways at the end.`,
  },
  {
    id: "reason",
    label: "Reasoning",
    description: "Deep step-by-step reasoning for hard problems.",
    tier: "pro",
    systemPrompt: `You are NovaGPT in Reasoning mode. Think through problems step by step.
Structure responses with: 1) Understanding, 2) Approach, 3) Step-by-step reasoning, 4) Final answer.
Show your work clearly. Verify your conclusions before finalizing.`,
    reasoning: "medium",
  },
  {
    id: "research",
    label: "Research",
    description: "Deep, structured research with citations and trade-offs.",
    tier: "pro",
    systemPrompt: `You are NovaGPT in Research mode. Produce thorough, structured research briefs.
Break the topic into background, key findings, trade-offs, and open questions. Cite sources inline when known.`,
    reasoning: "medium",
  },
  {
    id: "writer",
    label: "Writer Pro",
    description: "Long-form drafting with strong structure and voice.",
    tier: "pro",
    systemPrompt: `You are NovaGPT in Writer Pro mode. Produce polished long-form writing.
Match the requested tone. Use clear structure, strong hooks, and tight prose. Offer one alternative opening when useful.`,
  },
  {
    id: "tutor",
    label: "Tutor Pro",
    description: "1:1 expert tutor for hard subjects, adaptive pacing.",
    tier: "pro",
    systemPrompt: `You are NovaGPT in Tutor Pro mode. Act as a patient expert tutor.
Diagnose what the learner knows, scaffold with guided questions, and only give the answer after the learner attempts. Adapt difficulty as you go.`,
    reasoning: "low",
  },
];

export function getMode(id: ModeId): Mode {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}
