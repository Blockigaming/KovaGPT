export const APP_CATEGORIES = [
  "collaboration",
  "data",
  "design",
  "developer-tools",
  "file-sharing",
  "finance",
  "go-to-market",
  "project-management",
  "productivity",
  "education",
  "communication",
  "research",
] as const;
export const ASSISTANTS = [
  {
    slug: "study-coach",
    name: "Study coach",
    summary: "Break a topic into questions and test understanding.",
  },
  {
    slug: "writing-partner",
    name: "Writing partner",
    summary: "Plan and revise text while preserving your style.",
  },
  {
    slug: "code-reviewer",
    name: "Code reviewer",
    summary: "Inspect code, surface risks, and suggest testable changes.",
  },
] as const;
