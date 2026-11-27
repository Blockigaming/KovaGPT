// Lightweight route metadata: keep full article bodies out of the application entry.
// The public-website unit tests require exact parity with the full content catalog.
export const PUBLIC_WEBSITE_ROUTE_INDEX = Object.freeze(
  [
    {
      path: "/features/chat",
      title: "Chat",
      indexable: true,
    },
    {
      path: "/features/search",
      title: "Search the web",
      indexable: true,
    },
    {
      path: "/features/reasoning",
      title: "Thinking",
      indexable: true,
    },
    {
      path: "/features/images",
      title: "Create images",
      indexable: true,
    },
    {
      path: "/features/files",
      title: "Work with files",
      indexable: true,
    },
    {
      path: "/features/projects",
      title: "Projects",
      indexable: true,
    },
    {
      path: "/features/memory",
      title: "Memory",
      indexable: true,
    },
    {
      path: "/features/library",
      title: "Library",
      indexable: true,
    },
    {
      path: "/features/voice",
      title: "Voice",
      indexable: true,
    },
    {
      path: "/features/agents",
      title: "Agents",
      indexable: true,
    },
    {
      path: "/features/cloud-browser",
      title: "Cloud Browser",
      indexable: true,
    },
    {
      path: "/features/scheduled-tasks",
      title: "Scheduled Tasks",
      indexable: true,
    },
    {
      path: "/features/connections",
      title: "Connections",
      indexable: true,
    },
    {
      path: "/features/research",
      title: "Research",
      indexable: true,
    },
    {
      path: "/features/code",
      title: "Code",
      indexable: true,
    },
    {
      path: "/features/temporary-chats",
      title: "Temporary chats",
      indexable: true,
    },
    {
      path: "/features/shared-chats",
      title: "Share a conversation",
      indexable: true,
    },
    {
      path: "/features/personalization",
      title: "Personalization",
      indexable: true,
    },
    {
      path: "/features/security",
      title: "Security controls",
      indexable: true,
    },
    {
      path: "/features/mobile",
      title: "KovaGPT on mobile",
      indexable: true,
    },
    {
      path: "/connections/github",
      title: "GitHub connection",
      indexable: true,
    },
    {
      path: "/connections/google-drive",
      title: "Google Drive connection",
      indexable: true,
    },
    {
      path: "/connections/gmail",
      title: "Gmail connection",
      indexable: true,
    },
    {
      path: "/connections/google-calendar",
      title: "Google Calendar connection",
      indexable: true,
    },
    {
      path: "/connections/stripe",
      title: "Stripe connection",
      indexable: true,
    },
    {
      path: "/connections/notion",
      title: "Notion connection",
      indexable: true,
    },
    {
      path: "/connections/linear",
      title: "Linear connection",
      indexable: true,
    },
    {
      path: "/connections/figma",
      title: "Figma connection",
      indexable: true,
    },
    {
      path: "/connections/canva",
      title: "Canva connection",
      indexable: true,
    },
    {
      path: "/connections/box",
      title: "Box connection",
      indexable: true,
    },
    {
      path: "/connections/onedrive",
      title: "OneDrive connection",
      indexable: true,
    },
    {
      path: "/connections/sharepoint",
      title: "SharePoint connection",
      indexable: true,
    },
    {
      path: "/connections/microsoft-teams",
      title: "Microsoft Teams connection",
      indexable: true,
    },
    {
      path: "/connections/outlook",
      title: "Outlook connection",
      indexable: true,
    },
    {
      path: "/connections/salesforce",
      title: "Salesforce connection",
      indexable: true,
    },
    {
      path: "/connections/vercel",
      title: "Vercel connection",
      indexable: true,
    },
    {
      path: "/connections/wix",
      title: "Wix connection",
      indexable: true,
    },
    {
      path: "/connections/custom-mcp",
      title: "Custom MCP connection",
      indexable: true,
    },
    {
      path: "/connections/health",
      title: "Health connections connection",
      indexable: true,
    },
    {
      path: "/help/getting-started",
      title: "Get started",
      indexable: true,
    },
    {
      path: "/help/account",
      title: "Manage your account",
      indexable: true,
    },
    {
      path: "/help/login",
      title: "Sign-in help",
      indexable: true,
    },
    {
      path: "/help/billing",
      title: "Billing help",
      indexable: true,
    },
    {
      path: "/help/subscriptions",
      title: "Manage a subscription",
      indexable: true,
    },
    {
      path: "/help/cancel",
      title: "Cancel a subscription",
      indexable: true,
    },
    {
      path: "/help/refunds",
      title: "Ask about a refund",
      indexable: true,
    },
    {
      path: "/help/files",
      title: "File help",
      indexable: true,
    },
    {
      path: "/help/projects",
      title: "Project help",
      indexable: true,
    },
    {
      path: "/help/connections",
      title: "Connection help",
      indexable: true,
    },
    {
      path: "/help/troubleshooting",
      title: "Troubleshooting",
      indexable: true,
    },
    {
      path: "/help/contact",
      title: "Contact support",
      indexable: true,
    },
    {
      path: "/help/plans",
      title: "Compare plan allowances",
      indexable: true,
    },
    {
      path: "/help/recovery",
      title: "Recover account access",
      indexable: true,
    },
    {
      path: "/help/data-export",
      title: "Export your data",
      indexable: true,
    },
    {
      path: "/security/privacy",
      title: "Privacy controls",
      indexable: true,
    },
    {
      path: "/security/encryption",
      title: "Encryption and transport",
      indexable: true,
    },
    {
      path: "/security/authentication",
      title: "Account authentication",
      indexable: true,
    },
    {
      path: "/security/data-isolation",
      title: "Customer data isolation",
      indexable: true,
    },
    {
      path: "/security/permissions",
      title: "Permissions",
      indexable: true,
    },
    {
      path: "/security/incident-response",
      title: "Report a security incident",
      indexable: true,
    },
    {
      path: "/security/vulnerability-reporting",
      title: "Report a vulnerability",
      indexable: true,
    },
    {
      path: "/security/data-retention",
      title: "Data retention",
      indexable: true,
    },
    {
      path: "/security/account-deletion",
      title: "Account deletion",
      indexable: true,
    },
    {
      path: "/security/subprocessors",
      title: "Service providers",
      indexable: true,
    },
    {
      path: "/security/compliance",
      title: "Compliance information",
      indexable: true,
    },
    {
      path: "/legal/terms",
      title: "Terms of Service",
      indexable: false,
    },
    {
      path: "/legal/privacy",
      title: "Privacy Policy",
      indexable: false,
    },
    {
      path: "/legal/cookies",
      title: "Cookies and browser storage",
      indexable: false,
    },
    {
      path: "/legal/acceptable-use",
      title: "Acceptable use",
      indexable: false,
    },
    {
      path: "/legal/billing",
      title: "Billing terms",
      indexable: false,
    },
    {
      path: "/legal/refunds",
      title: "Refund Policy",
      indexable: false,
    },
    {
      path: "/legal/data-processing",
      title: "Data-processing information",
      indexable: false,
    },
    {
      path: "/legal/intellectual-property",
      title: "Intellectual property",
      indexable: false,
    },
    {
      path: "/legal/third-party-services",
      title: "Third-party services",
      indexable: false,
    },
    {
      path: "/company",
      title: "About KovaGPT",
      indexable: true,
    },
    {
      path: "/company/mission",
      title: "Make room for the next question",
      indexable: true,
    },
    {
      path: "/company/news",
      title: "KovaGPT news",
      indexable: true,
    },
    {
      path: "/company/careers",
      title: "Careers",
      indexable: false,
    },
    {
      path: "/company/press",
      title: "Press information",
      indexable: true,
    },
    {
      path: "/resources",
      title: "Resources",
      indexable: true,
    },
    {
      path: "/resources/guides",
      title: "Practical guides",
      indexable: true,
    },
    {
      path: "/resources/tutorials",
      title: "Tutorials",
      indexable: true,
    },
    {
      path: "/resources/faq",
      title: "Frequently asked questions",
      indexable: true,
    },
    {
      path: "/resources/updates",
      title: "Product updates",
      indexable: true,
    },
    {
      path: "/downloads",
      title: "Use KovaGPT on the web",
      indexable: true,
    },
    {
      path: "/roadmap",
      title: "Development direction",
      indexable: false,
    },
    {
      path: "/contact",
      title: "Contact KovaGPT",
      indexable: true,
    },
    {
      path: "/developers/quickstart",
      title: "API quickstart",
      indexable: false,
    },
    {
      path: "/developers/authentication",
      title: "API authentication",
      indexable: false,
    },
    {
      path: "/developers/api-keys",
      title: "Developer API keys",
      indexable: false,
    },
    {
      path: "/developers/models",
      title: "Public model catalog",
      indexable: false,
    },
    {
      path: "/developers/files",
      title: "Developer Files API",
      indexable: false,
    },
    {
      path: "/developers/rate-limits",
      title: "Rate limits and budgets",
      indexable: false,
    },
    {
      path: "/developers/errors",
      title: "API errors",
      indexable: false,
    },
    {
      path: "/developers/changelog",
      title: "Developer changelog",
      indexable: false,
    },
    {
      path: "/developers/docs",
      title: "Developer documentation",
      indexable: false,
    },
    {
      path: "/developers/responses",
      title: "Responses API",
      indexable: false,
    },
    {
      path: "/developers/images",
      title: "Images API",
      indexable: false,
    },
    {
      path: "/developers/search",
      title: "Search API availability",
      indexable: false,
    },
    {
      path: "/developers/agents",
      title: "Agent API availability",
      indexable: false,
    },
    {
      path: "/developers/webhooks",
      title: "Developer webhooks",
      indexable: false,
    },
    {
      path: "/features",
      title: "Explore KovaGPT",
      indexable: true,
    },
    {
      path: "/connections",
      title: "Connections",
      indexable: true,
    },
    {
      path: "/security",
      title: "Security",
      indexable: true,
    },
    {
      path: "/legal",
      title: "Legal and policies",
      indexable: false,
    },
  ].map(Object.freeze),
);

export const PUBLIC_WEBSITE_ROUTE_BY_PATH = new Map(
  PUBLIC_WEBSITE_ROUTE_INDEX.map((item) => [item.path, item]),
);
export const PUBLIC_WEBSITE_INDEXABLE_PATHS = Object.freeze(
  PUBLIC_WEBSITE_ROUTE_INDEX.filter((item) => item.indexable).map((item) => item.path),
);

export const PUBLIC_WEBSITE_FOOTER = Object.freeze(
  [
    {
      label: "Products",
      links: [
        ["KovaGPT", "/"],
        ["Chat", "/features/chat"],
        ["Projects", "/features/projects"],
        ["Images", "/features/images"],
        ["Library", "/features/library"],
        ["Search", "/features/search"],
        ["Thinking", "/features/reasoning"],
        ["Agents", "/features/agents"],
        ["Cloud Browser", "/features/cloud-browser"],
        ["Scheduled Tasks", "/features/scheduled-tasks"],
        ["Connections", "/connections"],
        ["Pricing", "/pricing"],
        ["Downloads", "/downloads"],
        ["Log in", "/login"],
      ],
    },
    {
      label: "Developers",
      links: [
        ["Overview", "/developers"],
        ["Documentation", "/developers/docs"],
        ["Quickstart", "/developers/quickstart"],
        ["Authentication", "/developers/authentication"],
        ["Models", "/developers/models"],
        ["Responses", "/developers/responses"],
        ["Images", "/developers/images"],
        ["Webhooks", "/developers/webhooks"],
        ["Rate limits", "/developers/rate-limits"],
        ["Changelog", "/developers/changelog"],
      ],
    },
    {
      label: "Resources",
      links: [
        ["Help Center", "/help"],
        ["Getting started", "/help/getting-started"],
        ["Guides", "/resources/guides"],
        ["Tutorials", "/resources/tutorials"],
        ["FAQ", "/resources/faq"],
        ["Product updates", "/resources/updates"],
        ["Status", "/status"],
        ["Contact support", "/help/contact"],
      ],
    },
    {
      label: "Security and legal",
      links: [
        ["Security", "/security"],
        ["Privacy", "/privacy"],
        ["Terms", "/terms"],
        ["Acceptable use", "/legal/acceptable-use"],
        ["Data retention", "/security/data-retention"],
        ["Account deletion", "/security/account-deletion"],
        ["Billing", "/legal/billing"],
        ["Refunds", "/refund"],
        ["Cookies and storage", "/legal/cookies"],
        ["Service providers", "/security/subprocessors"],
        ["Vulnerability reporting", "/security/vulnerability-reporting"],
        ["Accessibility", "/accessibility"],
      ],
    },
    {
      label: "Company",
      links: [
        ["About", "/company"],
        ["Mission", "/company/mission"],
        ["News", "/company/news"],
        ["Careers", "/company/careers"],
        ["Press", "/company/press"],
        ["Contact", "/contact"],
        ["Transparency", "/transparency"],
      ],
    },
    {
      label: "Connections",
      links: [
        ["GitHub", "/connections/github"],
        ["Google Drive", "/connections/google-drive"],
        ["Gmail", "/connections/gmail"],
        ["Google Calendar", "/connections/google-calendar"],
        ["Notion", "/connections/notion"],
        ["Linear", "/connections/linear"],
        ["Microsoft Teams", "/connections/microsoft-teams"],
        ["SharePoint", "/connections/sharepoint"],
        ["All connections", "/connections"],
      ],
    },
  ].map((group) =>
    Object.freeze({
      ...group,
      links: group.links.map(([label, to]) => Object.freeze({ label, to })),
    }),
  ),
);
