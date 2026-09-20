export const WRITING_FORMATS = ["Text", "Email", "Caption", "Article", "Social post"] as const;
export const WRITING_TONES = [
  "Friendly",
  "Neutral",
  "Professional",
  "Natural",
  "Concise",
  "Kind",
  "Casual",
] as const;
export const WRITING_LENGTHS = ["Brief", "Standard", "Detailed", "Comprehensive"] as const;

export type WritingToolAction =
  | "improve"
  | "expand"
  | "shorten"
  | "grammar"
  | "continue"
  | "tone"
  | "outline"
  | "custom"
  | "count"
  | "detector"
  | "plagiarism";

export type WritingTool = {
  slug: string;
  title: string;
  shortDescription: string;
  placeholder: string;
  action: WritingToolAction;
  instruction?: string;
  supportsSettings?: boolean;
  suggestions: readonly [string, string, string];
};

export const WRITING_TOOLS = [
  {
    slug: "ai-detector",
    title: "AI detector",
    shortDescription: "Review writing signals without pretending authorship can be proven.",
    placeholder: "Paste text to review its writing patterns",
    action: "detector",
    supportsSettings: false,
    suggestions: ["Review sentence patterns", "Find repetitive wording", "Explain detector limits"],
  },
  {
    slug: "ai-humanizer",
    title: "AI humanizer",
    shortDescription: "Rewrite stiff text so it sounds clearer, more natural, and more like you.",
    placeholder: "Paste the text you want to make more natural",
    action: "custom",
    instruction:
      "Rewrite this in a natural, direct voice. Preserve every fact and do not claim a detector outcome.",
    suggestions: ["Make this sound natural", "Remove robotic phrasing", "Vary the sentence rhythm"],
  },
  {
    slug: "ai-text-generator",
    title: "AI text generator",
    shortDescription: "Turn a topic or rough idea into a polished first draft.",
    placeholder: "Describe what you want to write",
    action: "custom",
    instruction: "Write a polished draft from this request.",
    suggestions: [
      "Write a launch announcement",
      "Draft a product description",
      "Create an event invitation",
    ],
  },
  {
    slug: "apa-citation",
    title: "APA citation generator",
    shortDescription: "Format source details as an APA-style citation for you to verify.",
    placeholder: "Paste the source title, author, date, publisher, and URL",
    action: "custom",
    instruction:
      "Format these source details as an APA 7 citation. Do not invent missing information; mark it as missing.",
    suggestions: ["Cite a web page", "Cite a journal article", "Cite a book"],
  },
  {
    slug: "cv-generator",
    title: "CV generator",
    shortDescription: "Organize your experience and accomplishments into a clear CV draft.",
    placeholder: "Add your experience, education, skills, and target role",
    action: "custom",
    instruction:
      "Turn these details into a clear, factual CV. Do not invent credentials, dates, or results.",
    suggestions: [
      "Create a student CV",
      "Organize work experience",
      "Improve accomplishment bullets",
    ],
  },
  {
    slug: "email-writer",
    title: "Email writer",
    shortDescription: "Draft a clear email for any audience, purpose, or tone.",
    placeholder: "Describe who the email is for and what it should say",
    action: "custom",
    instruction: "Write a complete email from this request, including a useful subject line.",
    suggestions: ["Write a follow-up", "Ask for a meeting", "Send a thank-you note"],
  },
  {
    slug: "essay-checker",
    title: "Essay checker",
    shortDescription: "Review an essay for clarity, structure, grammar, and unsupported claims.",
    placeholder: "Paste your essay for feedback",
    action: "custom",
    instruction:
      "Review this essay. Identify specific clarity, structure, grammar, and evidence issues without rewriting the whole essay.",
    suggestions: ["Check my introduction", "Review my argument", "Find unclear paragraphs"],
  },
  {
    slug: "grammar",
    title: "Grammar checker",
    shortDescription: "Correct grammar, spelling, and punctuation while keeping your meaning.",
    placeholder: "Paste text to check",
    action: "grammar",
    supportsSettings: false,
    suggestions: ["Fix a paragraph", "Check an email", "Polish an assignment"],
  },
  {
    slug: "harvard-referencing-generator",
    title: "Harvard reference generator",
    shortDescription: "Format source details in Harvard style for you to verify.",
    placeholder: "Paste the source title, author, date, publisher, and URL",
    action: "custom",
    instruction:
      "Format these source details as a Harvard-style reference. Do not invent missing information; mark it as missing.",
    suggestions: ["Reference a website", "Reference a journal", "Reference a book"],
  },
  {
    slug: "mla-citation",
    title: "MLA citation generator",
    shortDescription: "Format source details as an MLA citation for you to verify.",
    placeholder: "Paste the source title, author, date, publisher, and URL",
    action: "custom",
    instruction:
      "Format these source details as an MLA 9 citation. Do not invent missing information; mark it as missing.",
    suggestions: ["Cite a website", "Cite an article", "Cite a book"],
  },
  {
    slug: "paragraph-rewriter",
    title: "Paragraph rewriter",
    shortDescription: "Rewrite a paragraph for clarity while preserving its meaning.",
    placeholder: "Paste a paragraph to rewrite",
    action: "improve",
    suggestions: ["Make this clearer", "Make this more concise", "Use simpler wording"],
  },
  {
    slug: "paraphrase",
    title: "Paraphrasing tool",
    shortDescription: "Express the same idea with different wording and structure.",
    placeholder: "Paste text to paraphrase",
    action: "custom",
    instruction:
      "Paraphrase this text while preserving its meaning, facts, names, numbers, and citations.",
    suggestions: ["Paraphrase a sentence", "Rework a paragraph", "Simplify this explanation"],
  },
  {
    slug: "plagiarism-check",
    title: "Plagiarism checker",
    shortDescription:
      "Prepare text for a real source comparison without fabricating a match score.",
    placeholder: "Paste text to prepare for source checking",
    action: "plagiarism",
    supportsSettings: false,
    suggestions: ["Find phrases to search", "Review citation gaps", "Explain source checking"],
  },
  {
    slug: "punctuation-checker",
    title: "Punctuation checker",
    shortDescription: "Correct punctuation while keeping your wording and meaning intact.",
    placeholder: "Paste text to check its punctuation",
    action: "custom",
    instruction:
      "Correct only punctuation errors. Do not change spelling, grammar, wording, word order, facts, or formatting. Return only the corrected text.",
    supportsSettings: false,
    suggestions: ["Check commas", "Fix quotation marks", "Review a paragraph"],
  },
  {
    slug: "resume-building",
    title: "Resume builder",
    shortDescription: "Turn truthful experience details into a focused resume draft.",
    placeholder: "Add your experience, skills, results, and target role",
    action: "custom",
    instruction:
      "Create a concise resume draft from these facts. Do not invent employers, dates, skills, credentials, or metrics.",
    suggestions: ["Draft a first resume", "Improve bullet points", "Tailor for a role"],
  },
  {
    slug: "rewording-tool",
    title: "Rewording tool",
    shortDescription: "Try clearer alternatives without changing the core message.",
    placeholder: "Paste text to reword",
    action: "improve",
    suggestions: ["Reword this sentence", "Make this more direct", "Try a friendlier version"],
  },
  {
    slug: "sentence-rewriter",
    title: "Sentence rewriter",
    shortDescription: "Rewrite one or more sentences for clarity, tone, or flow.",
    placeholder: "Paste the sentence you want to rewrite",
    action: "improve",
    suggestions: [
      "Make this sentence clearer",
      "Make it more professional",
      "Shorten this sentence",
    ],
  },
  {
    slug: "spell-checker",
    title: "Spell checker",
    shortDescription: "Correct spelling and obvious typos while preserving your words.",
    placeholder: "Paste text to check its spelling",
    action: "custom",
    instruction:
      "Correct only spelling errors and obvious typos. Do not change grammar, punctuation, wording, word order, facts, or formatting. Return only the corrected text.",
    supportsSettings: false,
    suggestions: ["Check a paragraph", "Fix an email", "Review a document"],
  },
  {
    slug: "story-generator",
    title: "Story generator",
    shortDescription: "Develop a premise into a story draft with your chosen voice and detail.",
    placeholder: "Describe the characters, setting, conflict, and style",
    action: "custom",
    instruction: "Write an original story draft from this prompt.",
    suggestions: ["Write a mystery opening", "Create a bedtime story", "Develop my character idea"],
  },
  {
    slug: "summarizer",
    title: "Text summarizer",
    shortDescription: "Condense long text into its central ideas and important details.",
    placeholder: "Paste the text you want to summarize",
    action: "shorten",
    suggestions: ["Summarize an article", "Create key takeaways", "Make study notes"],
  },
  {
    slug: "word-counter",
    title: "Word counter",
    shortDescription: "Count words, characters, sentences, and lines locally as you type.",
    placeholder: "Type or paste text to count",
    action: "count",
    supportsSettings: false,
    suggestions: ["Count an essay", "Check a caption length", "Measure a draft"],
  },
] as const satisfies readonly WritingTool[];

export function getWritingTool(slug: string): WritingTool | undefined {
  return WRITING_TOOLS.find((tool) => tool.slug === slug);
}
