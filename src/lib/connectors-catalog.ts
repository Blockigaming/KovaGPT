// Catalog of connectable services shown in Settings -> Linked apps.

export type ConnectorStatus = "live";

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
  /** Domain used to fetch a brand logo via Logo.dev. */
  domain: string;
  legacyProvider?: "google" | "google-drive" | "gmail" | "youtube" | "apple";
};

export const CONNECTOR_CATALOG: ConnectorItem[] = [
  { id: "google", label: "Google", description: "Sign in with your Google account.", category: "Productivity", status: "live", domain: "google.com", legacyProvider: "google" },
  { id: "gmail", label: "Gmail", description: "Read message context from Gmail.", category: "Email", status: "live", domain: "gmail.com", legacyProvider: "gmail" },
  { id: "google-drive", label: "Google Drive", description: "Reference files from your Drive.", category: "Storage & Files", status: "live", domain: "drive.google.com", legacyProvider: "google-drive" },
  { id: "youtube", label: "YouTube", description: "Reference your YouTube activity.", category: "Social & Media", status: "live", domain: "youtube.com", legacyProvider: "youtube" },
  { id: "apple", label: "Apple", description: "Sign in with your Apple ID.", category: "Productivity", status: "live", domain: "apple.com", legacyProvider: "apple" },

  { id: "outlook", label: "Outlook", description: "Read Microsoft Outlook mail.", category: "Email", status: "live", domain: "outlook.com" },
  { id: "icloud-mail", label: "iCloud Mail", description: "Read iCloud mail.", category: "Email", status: "live", domain: "icloud.com" },
  { id: "yahoo-mail", label: "Yahoo Mail", description: "Read Yahoo mail.", category: "Email", status: "live", domain: "yahoo.com" },
  { id: "proton-mail", label: "Proton Mail", description: "Read Proton mail.", category: "Email", status: "live", domain: "proton.me" },

  { id: "onedrive", label: "OneDrive", description: "Reference files from OneDrive.", category: "Storage & Files", status: "live", domain: "onedrive.live.com" },
  { id: "dropbox", label: "Dropbox", description: "Reference files from Dropbox.", category: "Storage & Files", status: "live", domain: "dropbox.com" },
  { id: "icloud-drive", label: "iCloud Drive", description: "Reference files from iCloud.", category: "Storage & Files", status: "live", domain: "icloud.com" },
  { id: "box", label: "Box", description: "Reference files from Box.", category: "Storage & Files", status: "live", domain: "box.com" },

  { id: "google-calendar", label: "Google Calendar", description: "Read and create events.", category: "Calendar", status: "live", domain: "calendar.google.com" },
  { id: "outlook-calendar", label: "Outlook Calendar", description: "Read and create events.", category: "Calendar", status: "live", domain: "outlook.com" },
  { id: "apple-calendar", label: "Apple Calendar", description: "Read and create events.", category: "Calendar", status: "live", domain: "apple.com" },

  { id: "notion", label: "Notion", description: "Read and update Notion pages.", category: "Notes & Docs", status: "live", domain: "notion.so" },
  { id: "google-docs", label: "Google Docs", description: "Read and edit Docs.", category: "Notes & Docs", status: "live", domain: "docs.google.com" },
  { id: "google-sheets", label: "Google Sheets", description: "Read and update Sheets.", category: "Notes & Docs", status: "live", domain: "sheets.google.com" },
  { id: "ms-word", label: "Microsoft Word", description: "Read and edit Word docs.", category: "Notes & Docs", status: "live", domain: "microsoft.com" },
  { id: "ms-excel", label: "Microsoft Excel", description: "Read and update Excel.", category: "Notes & Docs", status: "live", domain: "microsoft.com" },
  { id: "evernote", label: "Evernote", description: "Read Evernote notes.", category: "Notes & Docs", status: "live", domain: "evernote.com" },
  { id: "obsidian", label: "Obsidian", description: "Sync Obsidian vaults.", category: "Notes & Docs", status: "live", domain: "obsidian.md" },
  { id: "apple-notes", label: "Apple Notes", description: "Read Apple Notes.", category: "Notes & Docs", status: "live", domain: "apple.com" },

  { id: "slack", label: "Slack", description: "Read channels and DMs you allow.", category: "Communication", status: "live", domain: "slack.com" },
  { id: "ms-teams", label: "Microsoft Teams", description: "Read Teams chats.", category: "Communication", status: "live", domain: "teams.microsoft.com" },
  { id: "discord", label: "Discord", description: "Read allowed Discord servers.", category: "Communication", status: "live", domain: "discord.com" },
  { id: "whatsapp", label: "WhatsApp", description: "Connect WhatsApp Business.", category: "Communication", status: "live", domain: "whatsapp.com" },
  { id: "telegram", label: "Telegram", description: "Connect Telegram bot.", category: "Communication", status: "live", domain: "telegram.org" },
  { id: "zoom", label: "Zoom", description: "Read meeting transcripts.", category: "Communication", status: "live", domain: "zoom.us" },

  { id: "trello", label: "Trello", description: "Read your boards.", category: "Productivity", status: "live", domain: "trello.com" },
  { id: "asana", label: "Asana", description: "Read tasks and projects.", category: "Productivity", status: "live", domain: "asana.com" },
  { id: "linear", label: "Linear", description: "Read issues and projects.", category: "Productivity", status: "live", domain: "linear.app" },
  { id: "todoist", label: "Todoist", description: "Read and update tasks.", category: "Productivity", status: "live", domain: "todoist.com" },
  { id: "monday", label: "Monday.com", description: "Read your boards.", category: "Productivity", status: "live", domain: "monday.com" },
  { id: "jira", label: "Jira", description: "Read issues and sprints.", category: "Productivity", status: "live", domain: "atlassian.com" },
  { id: "clickup", label: "ClickUp", description: "Read tasks and docs.", category: "Productivity", status: "live", domain: "clickup.com" },

  { id: "google-classroom", label: "Google Classroom", description: "Read assignments and classes.", category: "Education", status: "live", domain: "classroom.google.com" },
  { id: "canvas", label: "Canvas LMS", description: "Read courses and grades.", category: "Education", status: "live", domain: "instructure.com" },
  { id: "schoology", label: "Schoology", description: "Read courses and grades.", category: "Education", status: "live", domain: "schoology.com" },
  { id: "powerschool", label: "PowerSchool", description: "Read grades and schedules.", category: "Education", status: "live", domain: "powerschool.com" },
  { id: "khan-academy", label: "Khan Academy", description: "Sync progress and recommendations.", category: "Education", status: "live", domain: "khanacademy.org" },
  { id: "duolingo", label: "Duolingo", description: "Sync your learning streak.", category: "Education", status: "live", domain: "duolingo.com" },
  { id: "quizlet", label: "Quizlet", description: "Read study sets.", category: "Education", status: "live", domain: "quizlet.com" },

  { id: "tiktok", label: "TikTok", description: "Reference saved content.", category: "Social & Media", status: "live", domain: "tiktok.com" },
  { id: "instagram", label: "Instagram", description: "Reference saved posts.", category: "Social & Media", status: "live", domain: "instagram.com" },
  { id: "x-twitter", label: "X (Twitter)", description: "Reference bookmarks.", category: "Social & Media", status: "live", domain: "x.com" },
  { id: "reddit", label: "Reddit", description: "Reference saved posts.", category: "Social & Media", status: "live", domain: "reddit.com" },
  { id: "linkedin", label: "LinkedIn", description: "Reference your profile.", category: "Social & Media", status: "live", domain: "linkedin.com" },
  { id: "spotify", label: "Spotify", description: "Reference your playlists.", category: "Social & Media", status: "live", domain: "spotify.com" },
  { id: "apple-music", label: "Apple Music", description: "Reference your library.", category: "Social & Media", status: "live", domain: "music.apple.com" },
  { id: "pinterest", label: "Pinterest", description: "Reference your boards.", category: "Social & Media", status: "live", domain: "pinterest.com" },

  { id: "github", label: "GitHub", description: "Read repos and issues.", category: "Development", status: "live", domain: "github.com" },
  { id: "gitlab", label: "GitLab", description: "Read repos and issues.", category: "Development", status: "live", domain: "gitlab.com" },
  { id: "vercel", label: "Vercel", description: "Read deployments.", category: "Development", status: "live", domain: "vercel.com" },
  { id: "stripe", label: "Stripe", description: "Read payment summaries.", category: "Development", status: "live", domain: "stripe.com" },
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
