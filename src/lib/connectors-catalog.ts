// Catalog of connectable services shown in Settings -> Linked apps.
// Tier 1 entries have working OAuth/connection flows. Tier 2 entries are
// roadmap placeholders rendered with a "Coming soon" badge.

export type ConnectorStatus = "live" | "coming-soon";

export type ConnectorCategory =
  | "Productivity"
  | "Email"
  | "Storage & Files"
  | "Calendar"
  | "Education"
  | "Communication"
  | "Notes & Docs"
  | "Social & Media"
  | "Development";

export type ConnectorItem = {
  id: string;
  label: string;
  description: string;
  category: ConnectorCategory;
  status: ConnectorStatus;
  // Optional: existing per-user OAuth provider in `linked-accounts.ts`
  // (only set for live entries we already wired).
  legacyProvider?: "google" | "google-drive" | "gmail" | "youtube" | "apple";
};

export const CONNECTOR_CATALOG: ConnectorItem[] = [
  // ===== LIVE (real OAuth wired today) =====
  { id: "google", label: "Google", description: "Sign in with your Google account.", category: "Productivity", status: "live", legacyProvider: "google" },
  { id: "gmail", label: "Gmail", description: "Read message context from Gmail.", category: "Email", status: "live", legacyProvider: "gmail" },
  { id: "google-drive", label: "Google Drive", description: "Reference files from your Drive.", category: "Storage & Files", status: "live", legacyProvider: "google-drive" },
  { id: "youtube", label: "YouTube", description: "Reference your YouTube activity.", category: "Social & Media", status: "live", legacyProvider: "youtube" },
  { id: "apple", label: "Apple", description: "Sign in with your Apple ID.", category: "Productivity", status: "live", legacyProvider: "apple" },

  // ===== COMING SOON - Email =====
  { id: "outlook", label: "Outlook", description: "Read Microsoft Outlook mail.", category: "Email", status: "coming-soon" },
  { id: "icloud-mail", label: "iCloud Mail", description: "Read iCloud mail.", category: "Email", status: "coming-soon" },
  { id: "yahoo-mail", label: "Yahoo Mail", description: "Read Yahoo mail.", category: "Email", status: "coming-soon" },
  { id: "proton-mail", label: "Proton Mail", description: "Read Proton mail.", category: "Email", status: "coming-soon" },

  // ===== COMING SOON - Storage & Files =====
  { id: "onedrive", label: "OneDrive", description: "Reference files from OneDrive.", category: "Storage & Files", status: "coming-soon" },
  { id: "dropbox", label: "Dropbox", description: "Reference files from Dropbox.", category: "Storage & Files", status: "coming-soon" },
  { id: "icloud-drive", label: "iCloud Drive", description: "Reference files from iCloud.", category: "Storage & Files", status: "coming-soon" },
  { id: "box", label: "Box", description: "Reference files from Box.", category: "Storage & Files", status: "coming-soon" },

  // ===== COMING SOON - Calendar =====
  { id: "google-calendar", label: "Google Calendar", description: "Read and create events.", category: "Calendar", status: "coming-soon" },
  { id: "outlook-calendar", label: "Outlook Calendar", description: "Read and create events.", category: "Calendar", status: "coming-soon" },
  { id: "apple-calendar", label: "Apple Calendar", description: "Read and create events.", category: "Calendar", status: "coming-soon" },

  // ===== COMING SOON - Notes & Docs =====
  { id: "notion", label: "Notion", description: "Read and update Notion pages.", category: "Notes & Docs", status: "coming-soon" },
  { id: "google-docs", label: "Google Docs", description: "Read and edit Docs.", category: "Notes & Docs", status: "coming-soon" },
  { id: "google-sheets", label: "Google Sheets", description: "Read and update Sheets.", category: "Notes & Docs", status: "coming-soon" },
  { id: "ms-word", label: "Microsoft Word", description: "Read and edit Word docs.", category: "Notes & Docs", status: "coming-soon" },
  { id: "ms-excel", label: "Microsoft Excel", description: "Read and update Excel.", category: "Notes & Docs", status: "coming-soon" },
  { id: "evernote", label: "Evernote", description: "Read Evernote notes.", category: "Notes & Docs", status: "coming-soon" },
  { id: "obsidian", label: "Obsidian", description: "Sync Obsidian vaults.", category: "Notes & Docs", status: "coming-soon" },
  { id: "apple-notes", label: "Apple Notes", description: "Read Apple Notes.", category: "Notes & Docs", status: "coming-soon" },

  // ===== COMING SOON - Communication =====
  { id: "slack", label: "Slack", description: "Read channels and DMs you allow.", category: "Communication", status: "coming-soon" },
  { id: "ms-teams", label: "Microsoft Teams", description: "Read Teams chats.", category: "Communication", status: "coming-soon" },
  { id: "discord", label: "Discord", description: "Read allowed Discord servers.", category: "Communication", status: "coming-soon" },
  { id: "whatsapp", label: "WhatsApp", description: "Connect WhatsApp Business.", category: "Communication", status: "coming-soon" },
  { id: "telegram", label: "Telegram", description: "Connect Telegram bot.", category: "Communication", status: "coming-soon" },
  { id: "zoom", label: "Zoom", description: "Read meeting transcripts.", category: "Communication", status: "coming-soon" },

  // ===== COMING SOON - Productivity =====
  { id: "trello", label: "Trello", description: "Read your boards.", category: "Productivity", status: "coming-soon" },
  { id: "asana", label: "Asana", description: "Read tasks and projects.", category: "Productivity", status: "coming-soon" },
  { id: "linear", label: "Linear", description: "Read issues and projects.", category: "Productivity", status: "coming-soon" },
  { id: "todoist", label: "Todoist", description: "Read and update tasks.", category: "Productivity", status: "coming-soon" },
  { id: "monday", label: "Monday.com", description: "Read your boards.", category: "Productivity", status: "coming-soon" },
  { id: "jira", label: "Jira", description: "Read issues and sprints.", category: "Productivity", status: "coming-soon" },
  { id: "clickup", label: "ClickUp", description: "Read tasks and docs.", category: "Productivity", status: "coming-soon" },

  // ===== COMING SOON - Education =====
  { id: "google-classroom", label: "Google Classroom", description: "Read assignments and classes.", category: "Education", status: "coming-soon" },
  { id: "canvas", label: "Canvas LMS", description: "Read courses and grades.", category: "Education", status: "coming-soon" },
  { id: "schoology", label: "Schoology", description: "Read courses and grades.", category: "Education", status: "coming-soon" },
  { id: "powerschool", label: "PowerSchool", description: "Read grades and schedules.", category: "Education", status: "coming-soon" },
  { id: "khan-academy", label: "Khan Academy", description: "Sync progress and recommendations.", category: "Education", status: "coming-soon" },
  { id: "duolingo", label: "Duolingo", description: "Sync your learning streak.", category: "Education", status: "coming-soon" },
  { id: "quizlet", label: "Quizlet", description: "Read study sets.", category: "Education", status: "coming-soon" },

  // ===== COMING SOON - Social & Media =====
  { id: "tiktok", label: "TikTok", description: "Reference saved content.", category: "Social & Media", status: "coming-soon" },
  { id: "instagram", label: "Instagram", description: "Reference saved posts.", category: "Social & Media", status: "coming-soon" },
  { id: "x-twitter", label: "X (Twitter)", description: "Reference bookmarks.", category: "Social & Media", status: "coming-soon" },
  { id: "reddit", label: "Reddit", description: "Reference saved posts.", category: "Social & Media", status: "coming-soon" },
  { id: "linkedin", label: "LinkedIn", description: "Reference your profile.", category: "Social & Media", status: "coming-soon" },
  { id: "spotify", label: "Spotify", description: "Reference your playlists.", category: "Social & Media", status: "coming-soon" },
  { id: "apple-music", label: "Apple Music", description: "Reference your library.", category: "Social & Media", status: "coming-soon" },
  { id: "pinterest", label: "Pinterest", description: "Reference your boards.", category: "Social & Media", status: "coming-soon" },

  // ===== COMING SOON - Development =====
  { id: "github", label: "GitHub", description: "Read repos and issues.", category: "Development", status: "coming-soon" },
  { id: "gitlab", label: "GitLab", description: "Read repos and issues.", category: "Development", status: "coming-soon" },
  { id: "vercel", label: "Vercel", description: "Read deployments.", category: "Development", status: "coming-soon" },
  { id: "stripe", label: "Stripe", description: "Read payment summaries.", category: "Development", status: "coming-soon" },
];

export const CONNECTOR_CATEGORIES: ConnectorCategory[] = [
  "Productivity",
  "Email",
  "Storage & Files",
  "Calendar",
  "Notes & Docs",
  "Communication",
  "Education",
  "Social & Media",
  "Development",
];
