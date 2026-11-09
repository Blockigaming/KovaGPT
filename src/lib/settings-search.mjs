// A local, deterministic settings index. No user settings or search terms leave the device.
const SYNONYMS = Object.freeze({
  general: ["response", "answers", "writing", "reply", "chat behavior", "send", "enter key", "language", "preferences", "default"],
  appearance: ["theme", "dark mode", "light mode", "dark", "light", "color", "colour", "accent", "font", "text", "size", "display", "layout", "screen", "interface", "bright", "brightness", "look"],
  notifications: ["alerts", "notify", "reminders", "push", "popup", "messages", "updates", "sound"],
  personalization: ["profile", "name", "display name", "nickname", "custom instructions", "about me", "account details"],
  security: ["password", "reset password", "passkey", "two factor", "2fa", "mfa", "authenticator", "login", "sign in", "authentication", "sessions", "security", "protect"],
  email: ["email address", "change email", "account email", "phone", "contact"],
  parental: ["parent", "parents", "child", "children", "teen", "family safety", "restrictions", "guardian"],
  voice: ["speak", "speech", "talk", "dictation", "microphone", "audio", "read aloud", "sound", "voice"],
  storage: ["disk", "space", "cache", "device", "saved files", "storage"],
  data: ["privacy", "export", "download data", "delete account", "remove", "erase", "chat history", "personal data", "information", "data controls"],
  memory: ["remember", "remembered", "memories", "forget", "forgotten", "personalized", "saved facts", "memory"],
  shortcuts: ["key", "keys", "hotkey", "hotkeys", "shortcut", "keyboard", "cmd", "control"],
  usage: ["limit", "limits", "remaining", "quota", "credits", "meter", "usage", "reset time", "allowance"],
  linked: ["integrations", "plugin", "plugins", "connect", "connectors", "apps", "oauth", "linked accounts", "gmail", "google drive", "calendar"],
  "cloud-browser": ["browser", "website", "websites", "web access", "agent", "online", "permissions", "site sign in"],
  family: ["family", "household", "member", "members", "kids", "invites"],
  location: ["where", "location", "geolocation", "city", "region", "gps"],
  billing: ["bill", "billing", "pay", "payment", "price", "pricing", "plan", "upgrade", "downgrade", "checkout", "credit card", "subscription", "invoice", "receipt", "cancel", "refund"],
  report: ["bug", "problem", "error", "feedback", "issue", "broken", "contact support"],
  help: ["support", "help", "questions", "faq", "troubleshoot", "guide"],
  about: ["version", "about", "information", "license"],
  logout: ["logout", "log off", "sign out", "exit", "disconnect"],
});

const STOP_WORDS = new Set([
  "a", "an", "the", "i", "me", "my", "mine", "you", "your", "to", "for", "from",
  "of", "in", "on", "with", "is", "are", "can", "how", "do", "does", "where",
  "what", "which", "please", "find", "show", "settings", "setting", "option",
  "options", "change", "edit", "update", "make", "get", "see", "want", "need",
  "turn", "off", "set", "up", "go", "it", "this", "that", "and", "or", "be",
]);

export function normalizeSettingsSearch(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Permit short prefixes, plurals and one typo or transposition for real words.
// Bounded comparison prevents unrelated short fragments from matching.
function nearWord(queryWord, indexedWord) {
  if (queryWord === indexedWord) return true;
  if (queryWord.length >= 2 && indexedWord.startsWith(queryWord)) return true;
  if (queryWord.length < 4 || indexedWord.length < 4) return false;
  if (Math.abs(queryWord.length - indexedWord.length) > 1) return false;
  let prefix = 0;
  while (prefix < Math.min(queryWord.length, indexedWord.length) &&
    queryWord[prefix] === indexedWord[prefix]) prefix++;
  if (prefix === queryWord.length || prefix === indexedWord.length) return true;
  if (queryWord.length === indexedWord.length &&
      queryWord[prefix] === indexedWord[prefix + 1] &&
      queryWord[prefix + 1] === indexedWord[prefix] &&
      queryWord.slice(prefix + 2) === indexedWord.slice(prefix + 2)) return true;
  const remainingQuery = queryWord.slice(prefix);
  const remainingIndex = indexedWord.slice(prefix);
  return remainingQuery.slice(1) === remainingIndex.slice(1) ||
    remainingQuery.slice(1) === remainingIndex ||
    remainingQuery === remainingIndex.slice(1);
}

/**
 * Search section titles, actual settings descriptions, action names and
 * explicitly curated alternate terms. Query tokens can appear in different
 * fields; words such as "my" and "change" are not required to match.
 */
export function matchesSettingsSearch(
  { id = "", label = "", keywords = [], description = "", groups = [] },
  query,
) {
  const normalizedQuery = normalizeSettingsSearch(query);
  if (!normalizedQuery) return true;
  const text = normalizeSettingsSearch([
    id, label, ...keywords, description, ...groups, ...(SYNONYMS[id] ?? []),
  ].join(" "));
  if (text.includes(normalizedQuery)) return true;
  const tokens = [...new Set(normalizedQuery.split(" ").filter((word) => !STOP_WORDS.has(word)))];
  if (!tokens.length) return true;
  const words = [...new Set(text.split(" "))];
  return tokens.every((token) => words.some((word) => nearWord(token, word)));
}
