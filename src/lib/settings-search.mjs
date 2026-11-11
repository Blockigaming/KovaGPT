// Search by meaning, not just the exact navigation label. Keep the vocabulary
// curated so a short query never silently navigates to an unrelated setting.
const ALIASES = Object.freeze({
  general: "chat messages responses language defaults send enter shortcuts settings",
  appearance: "theme mode light dark color font style display text contrast",
  notifications: "alerts reminders emails pushes badges sounds updates announcement",
  personalization: "profile name identity account avatar photo personal information",
  security:
    "security verification verify verified login sign in sign out password passkey two factor mfa authentication account recovery trusted device identity",
  email: "email address verification verify verified account sign in change email login",
  parental: "family parental controls guardian child teen supervision restrictions",
  voice: "audio mic microphone spoken voice speaker pronunciation talk",
  storage: "files uploads quota space usage data cleanup library",
  data: "privacy controls delete export download history archive information permissions tracking security",
  memory:
    "remember memories personalized personalization saved knowledge facts preferences updates",
  shortcuts: "keyboard keys hotkeys commands accessibility navigation",
  usage: "usage credits limits quotas messages rate capacity plan models tokens",
  linked:
    "plugins connections apps integrations connected providers gmail google drive calendar health finances bank tools",
  "cloud-browser": "web browsing internet permissions websites agents browser remote",
  family: "family members child guardian parent family center",
  location: "location gps map city region address privacy",
  billing:
    "subscriptions billing payment invoice receipt renew upgrade downgrade plan refund price cost finance",
  report: "error bug support issue report broken problem",
  help: "help support documentation frequently asked questions questions tutorial learn",
  about: "about version product information release update",
  logout: "logout log out sign out session security",
});

function normalize(value) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function oneEditApart(a, b) {
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let x = 0,
    y = 0,
    edits = 0;
  while (x < a.length && y < b.length) {
    if (a[x] === b[y]) {
      x++;
      y++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length >= b.length) x++;
    if (a.length <= b.length) y++;
  }
  return edits + Number(x < a.length || y < b.length) <= 1;
}

/** A settings section matches its title, hints, body description, and synonyms. */
export function settingsSearchMatches(item, query, description = "") {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalize(
    [item.label, item.v, ...(item.keywords ?? []), description, ALIASES[item.v] ?? ""].join(" "),
  );
  const words = haystack.split(" ");
  return terms.every(
    (term) =>
      haystack.includes(term) ||
      words.some((word) => word.startsWith(term) || oneEditApart(word, term)),
  );
}
