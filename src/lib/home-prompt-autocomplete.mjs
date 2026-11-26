// Pure, bounded local completions. Do not turn a typed draft into a provider request.
const DEFAULTS = [
  "How to learn a new skill",
  "How to organize a project",
  "How to do research for an assignment",
  "How to do a step-by-step analysis",
  "How to get started with a new project",
  "What can I learn today?",
  "What is the difference between",
  "Explain this concept with examples",
  "Help me plan my next steps",
  "Summarize the main points",
  "Write a clear project outline",
  "Create a practice quiz",
  "Compare the options",
];
const PLUGIN_PROMPTS = {
  github: ["How to review a GitHub repository", "Find recent GitHub pull requests"],
  gmail: ["How to organize my Gmail inbox", "Find my recent emails"],
  "google-calendar": ["What is on my Google Calendar today?", "Show my upcoming meetings"],
  "google-drive": ["Find a document in Google Drive", "How to organize my Google Drive"],
  outlook: ["Find my recent Outlook emails"],
  "outlook-calendar": ["What is on my Outlook calendar today?"],
  onedrive: ["Find my documents in OneDrive"],
  notion: ["Find my notes in Notion"],
  linear: ["Show my Linear issues"],
  slack: ["Find a conversation in Slack"],
};

function safeText(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (
    !text ||
    text.length > 140 ||
    /[\r\n\t<>]/u.test(text) ||
    /https?:\/\/|@|[0-9]{7,}/iu.test(text) ||
    /password|secret|token|api.key|credential|private.key|ssn|social security/iu.test(text) ||
    /self.harm|suicid|porn|weapon|explosive|bypass|unlock speed/iu.test(text)
  )
    return "";
  return text;
}

export function homePromptSuggestions(draft, conversations = [], memories = [], connectedIds = []) {
  const prefix = safeText(draft);
  if (!prefix) return [];
  const typed = prefix.toLocaleLowerCase();
  const candidates = new Map();
  function add(value, score) {
    const text = safeText(value);
    const key = text.toLocaleLowerCase();
    if (!text || key === typed || !key.startsWith(typed)) return;
    if (draft.endsWith(" ") && text.charAt(prefix.length) !== " ") return;
    const current = candidates.get(key);
    if (!current || current.score < score) candidates.set(key, { text, score });
  }
  const recent = [...conversations]
    .filter((chat) => !chat.temporary)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 40);
  for (const [index, chat] of recent.entries()) {
    for (const message of chat.messages.slice(-20)) {
      if (message.role !== "user" || message.attachments?.length) continue;
      add(message.content, 100 - index + (message.requestedTool === "web_search" ? 15 : 0));
    }
  }
  for (const memory of memories.slice(0, 40)) add(memory.title, 55);
  for (const id of connectedIds) {
    if (!Object.hasOwn(PLUGIN_PROMPTS, id)) continue;
    for (const prompt of PLUGIN_PROMPTS[id]) add(prompt, 45);
  }
  for (const prompt of DEFAULTS) add(prompt, 1);
  return [...candidates.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ text }) => draft.trimEnd() + text.slice(prefix.length));
}
