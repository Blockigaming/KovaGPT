import { CONNECTION_FLOWS } from "@/integrations/connection-flows.mjs";
import { getPluginReview } from "./plugin-review-catalog";

type Profile = {
  publisher: string;
  overview: string;
  example: string;
  related: readonly string[];
  authorization?: string;
  gallery?: readonly { src: string; alt: string; caption: string }[];
};

// Editorial copy is display-only. The catalog and account managers own capabilities and grants.
const profiles: Readonly<Record<string, Profile>> = {
  box: profile(
    "Box",
    "Find files in shared Box workspaces without switching away from Kova. Results include file names, descriptions, and links.",
    "Find the supplier onboarding checklist in Box.",
    ["google-drive", "onedrive", "sharepoint"],
  ),
  calendly: profile(
    "Calendly",
    "Look up upcoming meetings for the connected Calendly user. You can also create a single-use link for an existing event type with a write grant.",
    "Find my upcoming product walkthroughs.",
    ["google-calendar", "outlook-calendar", "granola"],
  ),
  canva: profile(
    "Canva",
    "Find designs in your Canva workspace by title and reference their details. Enable write access to create a blank design when you want a new canvas.",
    "Find the Canva design titled Spring campaign.",
    ["figma", "gamma", "hyperframes-heygen"],
  ),
  etoro: profile(
    "eToro",
    "Review the portfolio value, cash balance, and unrealized gain or loss reported by your linked eToro account. A watchlist write grant lets you create an empty static watchlist.",
    "Look up the reported value and cash balance of my eToro portfolio.",
    ["interactive-brokers", "webull", "sp-global"],
  ),
  excalidraw: profile(
    "Excalidraw",
    "Attach an Excalidraw scene to a conversation to discuss a diagram, or sketch in Kova and download a scene to continue editing in Excalidraw.",
    "Sketch an onboarding flow and export it as an editable scene.",
    ["figma", "canva", "notion"],
    "Local files",
  ),
  figma: profile(
    "Figma",
    "Open design file details with a Figma link or file key, then reference the file while you work. A reviewed write can post a comment to that file.",
    "Look up the file details for this Figma design link.",
    ["canva", "excalidraw", "linear"],
  ),
  gamma: profile(
    "Gamma",
    "Find existing presentations and documents in the authorized Gamma workspace. You can also review a request to generate a short private deck and check its progress.",
    "Find the quarterly planning presentation in Gamma.",
    ["canva", "notion", "hyperframes-heygen"],
  ),
  github: profile(
    "GitHub",
    "Bring approved repositories into your Kova workflow. Look up files, issues, and pull requests in repositories you’ve granted access to, then review any supported changes before applying them.",
    "Find open issues about the sign-in flow in an authorized repository.",
    ["linear", "vercel", "custom-mcp"],
    "GitHub app installation and repository access",
  ),
  gmail: profile(
    "Google",
    "Use relevant Gmail messages as context for your work. With write access, you can save a draft and review the recipient, subject, and message before sending.",
    "Find the email that confirmed the project kickoff date.",
    ["outlook", "google-calendar", "google-drive"],
  ),
  "google-calendar": profile(
    "Google",
    "Look up events on an authorized Google Calendar. Review details such as the title and time before creating a new event.",
    "Find my next design review on Google Calendar.",
    ["outlook-calendar", "calendly", "gmail"],
  ),
  "google-bigquery": profile(
    "Google Cloud",
    "Find dataset names and locations in a Google Cloud project you can access. With the required role and write grant, create an empty dataset in a chosen location.",
    "List the datasets in my analytics project and show their locations.",
    ["mixpanel", "vercel", "google-drive"],
  ),
  "google-docs": profile(
    "Google",
    "Google Docs is coming soon. Its dedicated connector will let you work with documents from Kova.",
    "Summarize the project brief in Google Docs.",
    ["google-drive", "gmail", "notion"],
  ),
  "google-drive": profile(
    "Google",
    "Find and reference files shared with your Google Drive connection. You can also review and create a folder in My Drive with write access.",
    "Find the project brief in Google Drive.",
    ["box", "onedrive", "notion"],
  ),
  hubspot: profile(
    "HubSpot",
    "Look up company names and domains in an authorized HubSpot portal. With write access you can review a new company record before adding it.",
    "Find the HubSpot company record for a customer domain.",
    ["salesforce", "granola", "meltwater"],
  ),
  "hyperframes-heygen": profile(
    "HeyGen",
    "Track recent HyperFrames renders by title or use a render ID to check its status. A reviewed render uses an existing project asset and can use HeyGen credits.",
    "Check the status of my latest HyperFrames render.",
    ["canva", "gamma", "figma"],
  ),
  "interactive-brokers": profile(
    "Interactive Brokers",
    "Read open positions from the selected Activity Flex report. The report provides the symbol, currency, and quantity for each available position.",
    "List the open positions in my Activity Flex report.",
    ["webull", "etoro", "sp-global"],
    "Flex query ID and token",
  ),
  linear: profile(
    "Linear",
    "Find issues by title in an authorized Linear workspace. With write access, choose a team and review the issue before creating it.",
    "Find Linear issues related to password recovery.",
    ["github", "notion", "slack"],
  ),
  meltwater: profile(
    "Meltwater",
    "Find saved media searches and open the searches your account can access. With write permission, save a reviewed Boolean query.",
    "Find the saved media search for our product launch.",
    ["hubspot", "mixpanel", "salesforce"],
  ),
  "ms-teams": profile(
    "Microsoft",
    "Find teams you’ve joined and search chats visible to your work or school account after granting chat access. With the appropriate permission, send a reviewed plain-text message to an existing chat.",
    "Find Teams chats that mention the rollout schedule.",
    ["slack", "sharepoint", "outlook"],
    "Microsoft work or school sign-in",
  ),
  mixpanel: profile(
    "Mixpanel",
    "Find cohorts and view their aggregate counts in an authorized Mixpanel project. Reviewed event imports use the linked project and its configured region.",
    "Find the trial users cohort and show its count.",
    ["google-bigquery", "hubspot", "stripe"],
  ),
  notion: profile(
    "Notion",
    "Find Notion pages by title and read the pages you’ve shared with Kova. With the proper page permission, review and append a paragraph.",
    "Find the shared product roadmap and open its notes.",
    ["tana", "granola", "google-drive"],
    "Notion sign-in or an integration token for a shared page",
  ),
  onedrive: profile(
    "Microsoft",
    "Find files accessible in the OneDrive account you linked. With a write grant, review a new folder name before adding it to your drive.",
    "Find the latest budget spreadsheet in OneDrive.",
    ["sharepoint", "google-drive", "box"],
  ),
  outlook: profile(
    "Microsoft",
    "Search mail in your linked Outlook account. You can save reviewed drafts with write access and send a reviewed message after granting separate send permission.",
    "Find the Outlook message with the meeting agenda.",
    ["gmail", "outlook-calendar", "ms-teams"],
  ),
  "outlook-calendar": profile(
    "Microsoft",
    "Find event titles and times in your default Outlook calendar. Enable write access to review and create a new event on that calendar.",
    "Find the time of my next operations review in Outlook.",
    ["outlook", "google-calendar", "calendly"],
  ),
  salesforce: profile(
    "Salesforce",
    "Search accounts, contacts, or opportunities visible to the linked Salesforce role. Choose the record type, or review a new account record if your organization grants write access.",
    "Find opportunities matching the renewal project.",
    ["hubspot", "granola", "slack"],
  ),
  "sp-global": profile(
    "S&P Global",
    "Match a company name to a Capital IQ company and review the industry and country returned by your licensed API access.",
    "Match a company name to a Capital IQ entry.",
    ["interactive-brokers", "etoro", "webull"],
    "Licensed Capital IQ API credentials",
  ),
  sharepoint: profile(
    "Microsoft",
    "Find sites accessible to your Microsoft work or school account. With write access, you can add a reviewed item to an existing list that accepts a title.",
    "Find the operations SharePoint site.",
    ["onedrive", "ms-teams", "box"],
    "Microsoft work or school sign-in",
  ),
  stripe: profile(
    "Stripe",
    "Check the amounts, currencies, and statuses of recent Stripe charges. With the correct Stripe App permission, create an empty draft invoice for a linked customer.",
    "Look up the status of a specific Stripe charge.",
    ["plaid", "mixpanel", "hubspot"],
    "Stripe App authorization",
  ),
  vercel: profile(
    "Vercel",
    "Review recent deployments in the linked Vercel team. With an authorized token, create an empty project for that team.",
    "Check the latest deployment status for a project.",
    ["github", "wix", "custom-mcp"],
  ),
  webull: profile(
    "Webull",
    "See which account types are authorized for your linked Webull OpenAPI app. With the required access token, create an empty watchlist in the linked environment.",
    "List the accounts available to my Webull app.",
    ["interactive-brokers", "etoro", "sp-global"],
    "Webull OpenAPI credentials",
  ),
  wix: profile(
    "Wix",
    "View the linked Wix Headless site’s business name and locale. You can review and apply a new public business name with the appropriate permissions.",
    "Check the current business name and locale for my Wix site.",
    ["vercel", "hubspot", "canva"],
    "Wix Headless app credentials",
  ),
  "custom-mcp": profile(
    "KovaGPT",
    "Connect an approved MCP endpoint and run its reviewed text tools. The tools you can use depend on the selected server and the grants it gives your account.",
    "Query the reviewed read tool on my connected server.",
    ["github", "vercel", "google-bigquery"],
    "Approved MCP endpoint and server credential",
  ),
  granola: profile(
    "Granola",
    "Look up recent meeting note titles and dates visible to your Granola API key. On eligible plans, you can also pause or resume a webhook your key can manage.",
    "Find the Granola note for the roadmap review.",
    ["notion", "tana", "calendly"],
  ),
  tana: profile(
    "Tana",
    "Search notes and workspace items in your linked Tana workspace. With write access you can propose a document for review in Tana.",
    "Find the workshop notes in my Tana workspace.",
    ["notion", "granola", "linear"],
  ),
  slack: profile(
    "Slack",
    "Search the channel and direct messages available to your linked Slack account. With send permission, review the conversation and message before posting.",
    "Find the Slack thread about the release checklist.",
    ["ms-teams", "linear", "notion"],
  ),
  plaid: profile(
    "Plaid",
    "Review balances and recent transactions for the bank accounts you select. You can opt in to connection maintenance to restore KovaGPT’s webhook for a linked bank.",
    "Review recent transactions for a connected bank account.",
    ["stripe", "etoro", "webull"],
    "Plaid Link and bank consent",
  ),
  oura: profile(
    "Oura",
    "View the Oura trends you authorize in Health. Available categories depend on the permissions granted by your Oura account.",
    "Review the Oura trends available in Health.",
    ["apple-health", "android-health-connect"],
    "Oura sign-in and health data consent",
  ),
  "apple-health": profile(
    "Apple",
    "View approved Apple Health trends in the signed iPhone app for KovaGPT Health. Read access and manual step entry use separate device permissions.",
    "Open Health and review the step trend on your iPhone.",
    ["oura", "android-health-connect"],
    "Apple HealthKit device permission",
  ),
  "android-health-connect": profile(
    "Google",
    "View the steps, sleep, and heart rate you share with KovaGPT Health on Android. Manually recorded steps require a separate write permission and device confirmation.",
    "Check the latest steps available through Health Connect.",
    ["oura", "apple-health"],
    "Android Health Connect device permission",
  ),
};

function profile(
  publisher: string,
  overview: string,
  example: string,
  related: readonly string[],
  authorization?: string,
): Profile {
  return { publisher, overview, example, related, authorization };
}

const exampleResults: Readonly<Record<string, string>> = {
  gmail:
    "Project kickoff confirmed for Tuesday at 10:00 AM. The email includes the agenda and meeting link.",
  github:
    "Two matching issues in the sample repository: #42 Sign-in callback loops and #57 Improve sign-in error messages.",
  "google-docs":
    "The brief proposes a two-week pilot. The next steps are to confirm owners and schedule a review.",
  canva: "Spring campaign · Presentation · 8 pages. Open the design in Canva to continue editing.",
};

const galleries: Readonly<Record<string, NonNullable<Profile["gallery"]>>> = {
  canva: [
    {
      src: "/connectors/canva-presentation.jpg",
      alt: "Presentation template on a laptop",
      caption: "Make a presentation about our spring campaign launch",
    },
    {
      src: "/connectors/canva-social.svg",
      alt: "Illustration of a social post",
      caption: "Create a social post announcing our new coffee shop",
    },
    {
      src: "/connectors/canva-poster.jpg",
      alt: "Retro lighthouse poster",
      caption: "Design a retro poster for a coastal festival",
    },
  ],
};

export function getConnectorPageProfile(id: string) {
  const review = getPluginReview(id);
  if (!review) return undefined;
  const custom = Object.hasOwn(profiles, id) ? profiles[id] : undefined;
  const supported = review.permissions.filter(
    ({ verification }) => verification === "source_contract",
  );
  const capabilities = (access: "read" | "write") => [
    ...new Set(
      supported.filter((permission) => permission.access === access).map(({ label }) => label),
    ),
  ];
  return {
    ...custom,
    gallery: Object.hasOwn(galleries, id) ? galleries[id] : undefined,
    overview: custom?.overview ?? review.connector.description,
    related: custom?.related ?? [],
    exampleResult: Object.hasOwn(exampleResults, id) ? exampleResults[id] : capabilities("read")[0],
    authorization:
      custom?.authorization ??
      (review.availability === "planned"
        ? "Setup pending"
        : CONNECTION_FLOWS[id]?.authentication === "api-key"
          ? "Provider API credential"
          : "Provider sign-in"),
    read: capabilities("read"),
    write: capabilities("write"),
    availability: review.availability,
    availabilityNote: review.availabilityNote,
  };
}
