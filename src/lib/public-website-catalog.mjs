/** Public information only. Presence here never enables an app, provider, or entitlement. */
const section = (title, body, points = []) => ({ title, body, points });
const page = (path, title, description, sections, related = [], options = {}) => ({
  path,
  title,
  description,
  sections,
  related,
  indexable: true,
  ...options,
});
const link = (label, to) => ({ label, to });

const featureRows = [
  [
    "chat",
    "Chat",
    "Start with a question. Build toward an answer you can use.",
    "Describe the outcome",
    "Give KovaGPT your goal, the audience, and any constraints. A specific request gives the conversation a clearer starting point than a topic alone.",
    [
      "Ask for an explanation at your level",
      "Paste a draft to revise",
      "Follow up on the part that needs work",
    ],
    "Keep the useful context",
    "New chat starts a separate conversation. Projects keep related conversations and instructions together. Review the answer before sharing it, especially when it includes facts or calculations.",
    "/",
  ],
  [
    "search",
    "Search the web",
    "Bring current sources into a focused conversation.",
    "Ask a sourceable question",
    "Include the subject, date range, and location when they matter. Use the search tool available in the composer to request current information from the configured search provider.",
    ["Ask for primary sources", "Open the citations", "Compare publication dates with event dates"],
    "Check what a source supports",
    "A source appearing in search does not establish that every claim in an answer is correct. Open the relevant page and compare its evidence with the generated summary.",
    "/",
  ],
  [
    "reasoning",
    "Thinking",
    "Choose how much structure and depth your question needs.",
    "Use Thinking deliberately",
    "Thinking is useful for comparisons, planning, and questions with several constraints. State your assumptions and ask for checks the answer should satisfy.",
    [
      "Define the result you need",
      "Ask for alternatives and tradeoffs",
      "Review calculations independently",
    ],
    "Options follow your plan",
    "Free includes the published basic Thinking control. Plus and Pro expose additional supported levels. Mode labels describe KovaGPT behavior and do not guarantee a particular upstream model.",
    "/help/plans",
  ],
  [
    "images",
    "Create images",
    "Turn a visual idea into an image when your account has an available image allowance.",
    "Describe the picture",
    "Choose Create Image in the composer or open Images. Describe the subject, style, framing, and any text to include. Use the size options supported by the selected image model.",
    [
      "Choose an aspect ratio",
      "Be precise about text and placement",
      "Review the result before publishing",
    ],
    "Know the limits",
    "Image generation requires sign-in, a configured provider, and remaining plan allowance. It is separate from attaching an existing image for discussion. Generated text and fine details may need correction.",
    "/images",
  ],
  [
    "files",
    "Work with files",
    "Ask focused questions about supported documents and attachments.",
    "Choose a useful input",
    "Chat supports text, code, CSV, JSON, and images. Supported PDF, DOCX, XLSX, and PPTX files can supply extracted text; extraction is limited to 10 MB and can omit formatting or scanned content.",
    [
      "Ask about specific pages or fields",
      "Check extracted numbers against the original",
      "Avoid uploading information you do not need",
    ],
    "Extraction is not the original",
    "An extracted document may not preserve tables, slides, or layout. Library original previews and downloads are separate from readable text used in a conversation.",
    "/files",
  ],
  [
    "projects",
    "Projects",
    "Keep related work, instructions, and context in one place.",
    "Give the project a purpose",
    "Create a project for a continuing goal, add instructions that apply to that work, and keep related chats together. Attach supported files when they are relevant to the question.",
    [
      "Describe the project outcome",
      "Keep instructions specific",
      "Update source files as the work changes",
    ],
    "Review access and context",
    "Project membership and file permissions govern access. Browsing a file or another workspace item does not automatically attach it to every request.",
    "/projects",
  ],
  [
    "memory",
    "Memory",
    "Keep useful context while retaining control over what is saved.",
    "Choose what to remember",
    "Memory can retain useful notes across conversations when enabled in Settings. Review, edit, or delete saved notes as your preferences change.",
    [
      "Save stable preferences",
      "Remove outdated details",
      "Review sensitive information before saving",
    ],
    "Keep temporary work temporary",
    "Temporary chats do not use or update memory. Turning memory off and deleting a saved memory are different actions; check the relevant Settings controls for each.",
    "/memory",
  ],
  [
    "library",
    "Library",
    "Find and organize saved work from your account.",
    "Find an item",
    "Open Library to browse supported saved chats, images, files, and text. Use the available grid or list view and categories to narrow the collection.",
    [
      "Use descriptive names",
      "Open the item before sharing",
      "Keep a copy of important original files",
    ],
    "Understand what is included",
    "Library availability depends on the saved item type and your account. Archived chats do not appear in the normal Library collection. An extracted file representation is different from its original document.",
    "/library",
  ],
  [
    "voice",
    "Voice",
    "Review speech input availability before using a microphone.",
    "Use available speech controls",
    "Voice controls depend on account eligibility, browser permissions, provider configuration, and the current deployment. Only begin recording when a supported microphone control is available.",
    [
      "Check the browser permission prompt",
      "Review a transcript before sending",
      "Stop recording when you finish",
    ],
    "Separate dictation from conversation",
    "Turning speech into text and holding a spoken conversation are different capabilities. An information page does not confirm that both are active. If a voice control is unavailable, continue with text.",
    "/help/troubleshooting",
  ],
  [
    "agents",
    "Agents",
    "Give a task clear boundaries before handing over execution.",
    "Scope the work",
    "Describe the goal, permitted sources, and the result you expect. Agent execution requires supported runtime access and account permission; a plan description alone does not enable it.",
    [
      "Define what the agent may access",
      "Review requested permissions",
      "Inspect results and external changes",
    ],
    "Review consequential actions",
    "Connections and external actions have their own authorization boundaries. A public progress row records an observed step; it does not prove that the entire task completed.",
    "/help/connections",
  ],
  [
    "cloud-browser",
    "Cloud Browser",
    "Understand the difference between web search and an active browser session.",
    "Review the session",
    "A cloud browser is available only when KovaGPT has an authorized browser runtime for your account. Its session view should correspond to a real running session.",
    [
      "Confirm the site and account",
      "Keep credentials out of prompts",
      "Review external submissions",
    ],
    "Search is a separate tool",
    "Searching the web or citing a page does not mean a cloud browser opened or operated that page. If browser access is unavailable, KovaGPT should report that limit rather than imply a visit.",
    "/help/troubleshooting",
  ],
  [
    "scheduled-tasks",
    "Scheduled Tasks",
    "Prepare recurring work and check its execution history.",
    "Define the schedule",
    "Choose a prompt, schedule, and time zone in Scheduled Tasks. Review the selected context and permissions. Free allows 2 active tasks, Plus 5, and Pro has no active-task count cap; execution budgets still apply.",
    ["State a specific outcome", "Check the time zone", "Pause a task you no longer need"],
    "Saved does not mean completed",
    "A saved schedule needs a healthy execution service and a configured AI provider to run. Inspect the actual run status and saved result. A service error should not be presented as a successful execution.",
    "/scheduled-tasks",
  ],
  [
    "connections",
    "Connections",
    "Connect only the services and permissions a task needs.",
    "Choose the service",
    "Open Connections to review the supported catalog and account status. Some services are coming soon, restricted to certain account types, or waiting for configuration.",
    [
      "Read requested scopes",
      "Use the intended service account",
      "Disconnect access you no longer need",
    ],
    "Keep authentication separate",
    "Signing in to KovaGPT with Google or GitHub does not automatically authorize access to Gmail, Drive, or repositories. Each connection requires its own permission flow.",
    "/connections",
  ],
  [
    "research",
    "Research",
    "Turn a broad question into a reviewable set of findings.",
    "Define the question",
    "State the decision you are trying to make, what is already known, and what evidence would change the answer. Ask for sources that directly support the claims.",
    [
      "Separate observations and assumptions",
      "Prioritize primary evidence",
      "Record uncertainty and dates",
    ],
    "Review the conclusion",
    "Check that the cited sources support the proposed conclusion. Generated synthesis can miss contradictory evidence or confuse publication time with event time.",
    "/",
  ],
  [
    "code",
    "Code",
    "Explain, draft, and review code with the surrounding constraints in view.",
    "Bring the relevant context",
    "Provide the language, error message, expected behavior, and a small relevant code example. Keep credentials, production data, and private access tokens out of the prompt.",
    [
      "Ask for an explanation of the change",
      "Review dependencies and permissions",
      "Run appropriate checks in your environment",
    ],
    "Treat code as a draft",
    "Generated code can contain mistakes or unsafe assumptions. A code block is not evidence that it ran successfully, and file analysis is not a general execution sandbox.",
    "/",
  ],
  [
    "temporary-chats",
    "Temporary chats",
    "Use a conversation without adding to memory.",
    "Start deliberately",
    "Choose the temporary-chat control before starting a conversation. Check the interface indication so you know which conversation is temporary.",
    [
      "Use it for one-off questions",
      "Keep a copy of work you need later",
      "Review before sending sensitive context",
    ],
    "Understand retention separately",
    "Temporary chats do not use or update memory. This does not imply that every operational, security, or provider record disappears immediately; consult the Privacy Policy for retention information.",
    "/privacy",
  ],
  [
    "shared-chats",
    "Share a conversation",
    "Review exactly what another person will be able to read.",
    "Share a snapshot",
    "Open Share on a saved chat and review the text snapshot before creating a public link. A link permits anyone who has it to read that snapshot; it is not private email-only delivery.",
    [
      "Remove private details first",
      "Check the included messages",
      "Copy the visible link if clipboard access fails",
    ],
    "Manage the link",
    "Public snapshots exclude files and future messages and expire after 30 days under the current sharing contract. Remove link revokes access to that snapshot. Recipient copies cannot be recalled.",
    "/help/account",
  ],
  [
    "personalization",
    "Personalization",
    "Adjust the workspace to the way you work.",
    "Set useful preferences",
    "Use Settings to review appearance, response preferences, memory, and available sidebar controls. Keep project instructions focused on a project rather than mixing them with global preferences.",
    [
      "Choose a readable appearance",
      "Review saved memories",
      "Keep instructions concise and specific",
    ],
    "Know the scope",
    "Some display preferences apply to the current browser and account. Instructions influence responses but do not override account permissions or guarantee correct answers.",
    "/settings/general",
  ],
  [
    "security",
    "Security controls",
    "Keep account access and connected data under explicit controls.",
    "Protect your account",
    "Use supported verification and account-security controls. Protected tools require verified login and server authorization, rather than trusting a plan name or account identifier supplied by the browser.",
    ["Review active sessions", "Use supported MFA or passkeys", "Report unexpected account access"],
    "Keep access narrow",
    "Connection permissions, project membership, and subscription access are distinct checks. Giving an app access to one service should not silently grant access to another.",
    "/security",
  ],
  [
    "mobile",
    "KovaGPT on mobile",
    "Use the web workspace from a smaller screen.",
    "Open the web app",
    "Visit KovaGPT in a supported mobile browser. The interface adapts to the viewport; sign in with the same account to reach your account-owned work.",
    [
      "Use portrait or landscape as needed",
      "Keep the browser updated",
      "Review upload and microphone permissions",
    ],
    "Browser and app availability",
    "A mobile website is not a native iOS or Android application. Download pages should list an application only when a real supported release exists.",
    "/downloads",
  ],
];

const featurePages = featureRows.map(
  ([slug, title, description, firstTitle, firstBody, points, secondTitle, secondBody, to]) =>
    page(
      `/features/${slug}`,
      title,
      description,
      [section(firstTitle, firstBody, points), section(secondTitle, secondBody)],
      [link("Open this workspace", to), link("Get help", "/help")],
    ),
);

const connectionRows = [
  [
    "github",
    "GitHub",
    "Requires configuration",
    "Selected repositories, issues, and pull requests",
    "Authorize the intended GitHub account and review the repositories included in the grant. Repository access is separate from using GitHub to sign in to KovaGPT.",
    "Ask about a specific repository or pull request, then check the result against the original code or discussion. Private repository access is limited by your grant.",
  ],
  [
    "google-drive",
    "Google Drive",
    "Requires configuration",
    "Files your Google account and approved scopes permit",
    "Choose the intended Google account and review Drive permissions. A file's presence in Drive does not imply that all its contents can be attached or edited by every tool.",
    "Identify the document by name or link and specify whether you want to read, summarize, or change it. Verify the exact file before authorizing changes.",
  ],
  [
    "gmail",
    "Gmail",
    "Requires configuration",
    "Mail operations within separately approved Gmail scopes",
    "Gmail authorization is separate from Google sign-in and Drive. Review the account and mail scopes before connecting; some OAuth applications can show a provider verification notice.",
    "Give a sender, subject, or date range to find relevant mail. Review recipients and message content before sending; reading a message is not permission to send one.",
  ],
  [
    "google-calendar",
    "Google Calendar",
    "Requires configuration",
    "Calendar events allowed by your Google grant",
    "Review which Google account owns the calendar and which permissions the connection requests. Time zones and calendar selection matter when preparing an event.",
    "State the date, time zone, duration, and participants. Check availability and review the proposed event before creating an invitation.",
  ],
  [
    "stripe",
    "Stripe",
    "Requires configuration",
    "The connected Stripe account and approved operations",
    "Choose the intended Stripe business account and distinguish live mode from test mode. A Stripe connection is separate from the subscription you pay for KovaGPT.",
    "Use explicit account and mode boundaries when reviewing products or payments. Never treat a test result as a live transaction or a live account as a test sandbox.",
  ],
  [
    "notion",
    "Notion",
    "Requires configuration",
    "Pages and databases granted to the Notion integration",
    "Choose the correct workspace and explicitly grant the relevant pages. A public OAuth app does not automatically gain access to every page in a workspace.",
    "Ask for a specific page or database and verify sharing if it is missing. The integration's configured read or write permissions determine which actions it can perform.",
  ],
  [
    "linear",
    "Linear",
    "Requires configuration",
    "Issues and teams permitted by the workspace grant",
    "Review the Linear workspace, team access, and requested OAuth permissions. An installed integration still requires a valid account grant.",
    "Specify an issue identifier or team and distinguish finding an issue from changing its status, assignee, or description.",
  ],
  [
    "figma",
    "Figma",
    "Coming soon",
    "Design-file access is not currently verified",
    "This directory entry does not activate a Figma connection. Do not provide Figma credentials in a prompt or assume a file URL grants private access.",
    "You can discuss an exported screenshot or supported attachment in chat while direct integration availability is being reviewed.",
  ],
  [
    "canva",
    "Canva",
    "Coming soon",
    "Direct Canva document operations are not currently verified",
    "A Canva page in this directory describes intended use; it is not an authorized editing session or a downloadable design.",
    "Bring exported content into a supported file workflow, or prepare a design brief in chat. Apply the finished changes in Canva until a supported connection is available.",
  ],
  [
    "box",
    "Box",
    "Coming soon",
    "Private Box files remain governed by Box sharing",
    "No working Box connection is claimed here. An organization administrator may need to approve future access and limit the relevant folders.",
    "Use a supported exported file when appropriate. Check confidentiality and sharing permissions before moving a document between services.",
  ],
  [
    "onedrive",
    "OneDrive",
    "Coming soon",
    "Personal and organization Microsoft accounts have different access rules",
    "OneDrive access is not the same as SharePoint or Microsoft Teams access. A future connection must identify the correct account type and files.",
    "If direct access is unavailable, download only the document you are authorized to use and attach it through the supported file workflow.",
  ],
  [
    "sharepoint",
    "SharePoint",
    "Restricted",
    "Requires a supported Microsoft work or school tenant",
    "A personal Microsoft account does not satisfy an organizational SharePoint sign-in requirement. Tenant policies and administrator consent can restrict integration access.",
    "Ask your organization to review the intended site and permissions. Do not use a different personal account as a workaround for a tenant restriction.",
  ],
  [
    "microsoft-teams",
    "Microsoft Teams",
    "Restricted",
    "Requires a supported Microsoft work or school account",
    "Teams access depends on the organization's tenant and consent policies. Membership in a team and authorization for an integration are separate requirements.",
    "Identify the intended team and channel before requesting access. A Teams listing does not imply that messages can currently be read or sent.",
  ],
  [
    "outlook",
    "Outlook",
    "Requires configuration",
    "Mail and calendar permissions are separate",
    "Review the Microsoft account type and exactly which mail or calendar scopes the connection requests. Account permission does not imply access to every shared mailbox.",
    "Specify the mailbox or calendar and the intended read or write operation. Check recipients, event times, and attachments before authorizing external changes.",
  ],
  [
    "salesforce",
    "Salesforce",
    "Requires configuration",
    "Organization and administrator policies control CRM access",
    "A Salesforce connection can require administrator sign-in and explicit app approval. Do not substitute a customer password in a chat prompt.",
    "Define the objects and fields needed for the task. Review record identity and any proposed update before it changes customer information.",
  ],
  [
    "vercel",
    "Vercel",
    "Coming soon",
    "No deployment connection is currently verified",
    "This information page does not authorize project access, change deployment settings, or publish an application.",
    "Prepare a deployment checklist in chat and review the actual Vercel project separately. Do not paste deployment tokens into a prompt.",
  ],
  [
    "wix",
    "Wix",
    "Coming soon",
    "No direct Wix site-editing connection is currently verified",
    "A Wix integration must identify the correct site and owner permissions. A directory listing is not evidence of edit or publish access.",
    "Draft copy or page structure in KovaGPT, then review and apply it in Wix until supported direct operations are available.",
  ],
  [
    "custom-mcp",
    "Custom MCP",
    "Requires configuration",
    "Only reviewed servers and explicitly allowed tools",
    "Custom MCP access needs a supported server, a valid authentication method, and reviewed tool permissions. Server-provided instructions cannot grant access to unrelated accounts.",
    "Review the server URL, transport, tool descriptions, and authorization scopes. Confirm changes with external effects and keep secrets in the supported credential flow.",
  ],
  [
    "health",
    "Health connections",
    "Restricted",
    "Provider-specific consent and platform support are required",
    "Health providers need separate supported integrations and explicit consent. Apple Health and Android Health data cannot be obtained merely by adding a connection page to a website.",
    "Do not upload a complete medical history to enable a future integration. Share only relevant information through a supported workflow and verify clinical questions with a qualified professional.",
  ],
];
const connectionPages = connectionRows.map(([slug, title, availability, scope, setup, use]) =>
  page(
    `/connections/${slug}`,
    `${title} connection`,
    scope,
    [
      section("Access and setup", setup),
      section("A useful workflow", use),
      section(
        "Check availability",
        "Review the connection inside your signed-in account before relying on it. Provider configuration and account authorization can change independently of this public guide. Disconnect access you no longer need.",
      ),
    ],
    [link("Open Connections", "/apps"), link("Connection help", "/help/connections")],
    { availability },
  ),
);

const helpRows = [
  [
    "getting-started",
    "Get started",
    "Start with one clear request and the context it needs.",
    "Your first conversation",
    "Sign in, start a new chat, and describe what you want to accomplish. Include the audience and any constraints, then ask a follow-up about the part that needs more work.",
    [
      "Use Projects for ongoing work",
      "Attach only relevant files",
      "Check factual claims before sharing",
    ],
    "/",
  ],
  [
    "account",
    "Manage your account",
    "Keep account settings, identity, and security controls in view.",
    "Review account settings",
    "Open Settings from the account menu. Confirm the email and account you are using before exporting data, changing security controls, or making a deletion request.",
    ["Review saved preferences", "Check connected services", "Sign out when using a shared device"],
    "/settings/general",
  ],
  [
    "login",
    "Sign-in help",
    "Resolve sign-in problems without mixing accounts or authentication methods.",
    "Use a supported method",
    "Enter your email to continue through the supported email flow, or choose an enabled OAuth provider. A disabled provider cannot complete sign-in until its configuration is available.",
    [
      "Check which Google or GitHub account is selected",
      "Use recovery from the password form when needed",
      "Keep verification codes and passwords out of support messages",
    ],
    "/login",
  ],
  [
    "billing",
    "Billing help",
    "Find your subscription and the supported payment-management options.",
    "Open Billing",
    "Sign in to the account that owns the subscription and open Billing in Settings. Use the real customer portal to review payment methods and invoices when those options are enabled.",
    [
      "Keep the account email available for support",
      "Review the final checkout amount",
      "Do not buy a second subscription to repair a display error",
    ],
    "/settings/billing",
  ],
  [
    "subscriptions",
    "Manage a subscription",
    "Review your plan before changing it.",
    "Check the current plan",
    "Billing shows the subscription state available to your account. Existing subscribers should use plan management instead of creating a new checkout for the same account.",
    [
      "Review effective dates",
      "Check recurring amount and taxes",
      "Confirm whether a change takes effect now or later",
    ],
    "/settings/billing",
  ],
  [
    "cancel",
    "Cancel a subscription",
    "Review cancellation timing before confirming.",
    "Use account billing",
    "Open Billing in Settings, then the supported customer portal. Review the cancellation screen and its effective date. Closing a browser tab, logging out, or deleting a chat does not cancel a subscription.",
    [
      "Confirm the account and plan",
      "Retain the confirmation",
      "Contact support if the portal is unavailable",
    ],
    "/settings/billing",
  ],
  [
    "refunds",
    "Ask about a refund",
    "Provide enough payment context without sending card details.",
    "Review the current policy",
    "Read the published Refund Policy and contact Support with the account email and a short explanation. A request is not a guarantee that a refund will be granted.",
    [
      "Include the relevant purchase date",
      "Describe the billing problem",
      "Never email a complete card number or security code",
    ],
    "/refund",
  ],
  [
    "files",
    "File help",
    "Check the file type, size, and extracted content.",
    "Prepare the attachment",
    "Use a supported type and keep document extraction within the published 10 MB limit. Scans, password protection, complex tables, and unusual formatting can prevent readable extraction.",
    [
      "Confirm the original opens correctly",
      "Use selectable text when possible",
      "Compare extracted figures with the original",
    ],
    "/features/files",
  ],
  [
    "projects",
    "Project help",
    "Keep ongoing context relevant and accessible.",
    "Organize the work",
    "Create a project for a specific outcome, add useful instructions, and attach the source material for that work. Verify project membership if an expected file or conversation is unavailable.",
    [
      "Use a descriptive project name",
      "Remove outdated instructions",
      "Check that the intended files are selected",
    ],
    "/projects",
  ],
  [
    "connections",
    "Connection help",
    "Check provider status and account permission separately.",
    "Review the grant",
    "Open Connections and check the service, selected account, and permissions. Signing in to KovaGPT does not connect Gmail, Drive, or GitHub repositories automatically.",
    [
      "Use the correct organization account",
      "Reconnect only through the supported flow",
      "Review administrator requirements for restricted services",
    ],
    "/connections",
  ],
  [
    "troubleshooting",
    "Troubleshooting",
    "Use the visible error and request context to find the next step.",
    "Narrow the problem",
    "Check whether the issue affects one conversation, one file, or the whole account. Reload once when appropriate and keep the exact error reference. Avoid repeating an action that could create duplicate work or payment.",
    [
      "Record the page and approximate time",
      "Note what you expected and what happened",
      "Remove private content from screenshots",
    ],
    "/contact-support",
  ],
  [
    "contact",
    "Contact support",
    "Send a focused request to the existing KovaGPT support channel.",
    "Prepare the request",
    "Contact support@kovagpt.com with the affected page, a short description, the approximate time, and a request reference if one is shown. Do not include passwords, API keys, session tokens, or card details.",
    [
      "For billing, identify the account email",
      "For bugs, include steps to reproduce",
      "For account deletion, state the request explicitly",
    ],
    "/contact-support",
  ],
  [
    "plans",
    "Compare plan allowances",
    "Free is $0; Plus is $16/month; Pro is $80/month.",
    "Choose around the work",
    "Free provides published basic chat and Thinking allowances. Plus provides the baseline paid allowance. Pro provides fifteen times the Plus message allowance under the current usage policy; technical, provider, and execution limits still apply.",
    [
      "Free: 2 active Scheduled Tasks",
      "Plus: 5 active Scheduled Tasks",
      "Pro: no active-task count cap; execution budgets remain",
    ],
    "/pricing",
  ],
  [
    "recovery",
    "Recover account access",
    "Use the supported recovery flow for your account.",
    "Start from sign-in",
    "Continue with the email used for the account and select password recovery where offered. Follow the most recent recovery message and check that it returns to the expected KovaGPT domain.",
    [
      "Check spam and delivery delays",
      "Do not forward recovery links",
      "Contact support if you no longer control the email",
    ],
    "/login",
  ],
  [
    "data-export",
    "Export your data",
    "Keep a copy of important account-owned work.",
    "Use data controls",
    "Open the available export controls in Settings. Review the contents of the exported file and store it somewhere appropriate; exports can contain private conversation and account information.",
    [
      "Confirm the correct account",
      "Keep exports private",
      "Check any separate file originals you need",
    ],
    "/settings/data",
  ],
];
const helpPages = helpRows.map(([slug, title, description, heading, body, points, to]) =>
  page(
    `/help/${slug}`,
    title,
    description,
    [
      section(heading, body, points),
      section(
        "If you still need help",
        "Explain the problem and the steps you already tried when contacting Support. A request reference is useful; credentials and private source material are not needed for an initial report.",
      ),
    ],
    [link("Continue", to), link("Help Center", "/help")],
  ),
);

const securityRows = [
  [
    "privacy",
    "Privacy controls",
    "Review how your choices affect the context KovaGPT uses.",
    "Manage the context",
    "Memory, temporary chats, connected services, and uploaded files are separate sources of context. Review the settings for each rather than assuming one switch controls them all.",
    "Read the policy",
    "The published Privacy Policy is the reference for retention, providers, and rights requests. This guide does not replace it or promise a retention period.",
    "/privacy",
  ],
  [
    "encryption",
    "Encryption and transport",
    "Separate secure transport from claims about end-to-end encryption.",
    "Protect the connection",
    "Use KovaGPT over HTTPS and do not bypass a browser certificate warning. Credentials should stay in supported sign-in or connection flows rather than in conversation text.",
    "Know the boundary",
    "KovaGPT needs to process submitted content to answer a request. This page does not claim end-to-end encryption or a particular storage-encryption certification.",
    "/privacy",
  ],
  [
    "authentication",
    "Account authentication",
    "Verified identity and server authorization protect account features.",
    "Use supported verification",
    "Email verification, session validity, and supported MFA checks are enforced by the account infrastructure. An account label displayed in the browser is not proof of authorization.",
    "Keep methods separate",
    "A passkey or MFA factor protects KovaGPT access. Authorizing a third-party service is a separate grant and must not silently replace account identity.",
    "/help/login",
  ],
  [
    "data-isolation",
    "Customer data isolation",
    "Access must follow the current account and its explicit memberships.",
    "Scope each operation",
    "Account-owned records, project membership, and connection grants have distinct authorization boundaries. A browser-supplied account identifier must not grant access to another customer's records.",
    "Report unexpected access",
    "If another person's data appears, stop interacting with it and contact Support with the affected route and time. Do not collect additional private records to demonstrate the issue.",
    "/contact-support",
  ],
  [
    "permissions",
    "Permissions",
    "Give each service only the access required for its task.",
    "Review the permission request",
    "Confirm the intended account, workspace, and scopes before connecting a service. Read access, write access, administrative access, and payment access have different consequences.",
    "Revoke unused access",
    "Review connections periodically and disconnect what you no longer use. Revoking future access does not recall copies already exported or changes already submitted to another service.",
    "/connections",
  ],
  [
    "incident-response",
    "Report a security incident",
    "Send a focused report without spreading private information.",
    "Describe the event",
    "Contact Support with the affected page, approximate time, and observed behavior. For suspected account compromise, use the available security controls and recovery flow.",
    "Protect the evidence",
    "Do not send credentials, session cookies, or another customer's records. This page does not promise a response-time SLA or a public incident timeline.",
    "/contact-support",
  ],
  [
    "vulnerability-reporting",
    "Report a vulnerability",
    "Help describe a security issue while limiting its impact.",
    "Prepare a minimal report",
    "Send the affected URL, a concise description, and minimal reproducible steps to Support. Use your own authorized test account and redact private data from evidence.",
    "Keep testing bounded",
    "Do not access other customers' records, interrupt service, or publish secrets. This guidance does not create a bug-bounty payment commitment or authorize testing third-party services.",
    "/contact-support",
  ],
  [
    "data-retention",
    "Data retention",
    "Different records can have different retention requirements.",
    "Distinguish the records",
    "Conversation content, uploaded originals, account information, security records, billing records, and provider records are not interchangeable. Deleting one item does not establish deletion of every related operational record.",
    "Use the current policy",
    "Consult the Privacy Policy and the relevant data controls for deletion and retention information. No universal deletion deadline or backup expiration is asserted here.",
    "/privacy",
  ],
  [
    "account-deletion",
    "Account deletion",
    "Review the account and billing implications before a deletion request.",
    "Use the account controls",
    "Open Settings and use supported account-deletion controls. If the request cannot be completed there, contact Support from the account email and clearly identify it as an account-deletion request.",
    "Check retained records",
    "Some billing, security, legal, backup, or external-provider records can remain as described in the Privacy Policy. Review subscription status separately and keep any needed exports before confirming.",
    "/contact-support",
  ],
  [
    "subprocessors",
    "Service providers",
    "Understand when a request involves a provider outside KovaGPT.",
    "Review the data path",
    "AI processing, hosting, authentication, payments, and user-authorized connections can involve external services. The providers needed for a request depend on the deployed configuration and selected tools.",
    "Request specific information",
    "Consult the Privacy Policy and contact Support for current provider and data-processing information. This page does not assert that an unreviewed list is a complete contractual subprocessor schedule.",
    "/privacy",
  ],
  [
    "compliance",
    "Compliance information",
    "Evaluate the controls your organization actually needs.",
    "Start with requirements",
    "Identify the data classification, location, retention, identity, and contractual requirements for your use case. Ask for evidence of the relevant controls before adopting a service for regulated work.",
    "Verify each assurance",
    "No SOC 2, HIPAA, ISO 27001, or other certification is claimed by this page. A technical security feature is not itself a legal or compliance determination.",
    "/contact-support",
  ],
];
const securityPages = securityRows.map(
  ([slug, title, description, first, body, second, other, to]) =>
    page(
      `/security/${slug}`,
      title,
      description,
      [section(first, body), section(second, other)],
      [link("Read more", to), link("Security overview", "/security")],
    ),
);

const legalRows = [
  [
    "terms",
    "Terms of Service",
    "Read the existing KovaGPT Terms of Service.",
    "The governing document",
    "The current Terms of Service remain at /terms. This page points to that document and does not amend it. Review the actual terms before using the service.",
    "/terms",
  ],
  [
    "privacy",
    "Privacy Policy",
    "Find the existing privacy information and account data controls.",
    "Read the policy",
    "The current Privacy Policy remains at /privacy. It describes the relevant information practices. This directory page adds no new retention, processing, or deletion commitment.",
    "/privacy",
  ],
  [
    "cookies",
    "Cookies and browser storage",
    "Understand storage used for account sessions and preferences.",
    "Review browser storage",
    "Authentication and local display preferences can use browser storage. Blocking storage can affect sign-in and saved settings. Consult the current policy for the published storage information rather than treating browser cleanup as account deletion.",
    "/cookie-policy",
  ],
  [
    "acceptable-use",
    "Acceptable use",
    "Review the current service-use rules.",
    "Use the published policy",
    "Follow KovaGPT's published acceptable-use guidance and the terms of any connected service. Permission to use a tool does not authorize access to another person's data.",
    "/acceptable-use",
  ],
  [
    "billing",
    "Billing terms",
    "Review the monthly subscription and checkout information.",
    "Review before payment",
    "Plus is listed at $16 per month and Pro at $80 per month in USD before applicable taxes. Checkout must show the actual recurring terms before payment. This page does not introduce annual billing, a new trial, or a change to an existing subscriber's price.",
    "/pricing",
  ],
  [
    "refunds",
    "Refund Policy",
    "Use the published refund policy for billing requests.",
    "Request review",
    "The existing Refund Policy remains the source for refund information. Contact Support with the account email and purchase context. A support request does not itself approve or issue a refund.",
    "/refund",
  ],
  [
    "data-processing",
    "Data-processing information",
    "Review processing requirements before sharing organizational data.",
    "Request the applicable terms",
    "If your organization requires a data-processing agreement, contact KovaGPT to determine whether an applicable agreement and the needed controls are available. No agreement is executed by viewing this page.",
    "/contact-support",
  ],
  [
    "intellectual-property",
    "Intellectual property",
    "Review rights and third-party material before sharing or publishing.",
    "Check the source material",
    "Use content you are authorized to submit. Generated material can still require factual, trademark, attribution, or copyright review. Consult the current Terms for KovaGPT's published provisions.",
    "/terms",
  ],
  [
    "third-party-services",
    "Third-party services",
    "Connected services retain their own terms and access controls.",
    "Review each service",
    "A connection can send authorized requests or context to another provider. Its terms, permissions, account requirements, and availability remain separate from your KovaGPT subscription.",
    "/connections",
  ],
];
const legalPages = legalRows.map(([slug, title, description, heading, body, to]) =>
  page(
    `/legal/${slug}`,
    title,
    description,
    [
      section(heading, body),
      section(
        "Questions about this information",
        "Contact Support if you need clarification about the current published terms. This summary is navigation and guidance, not a substitute for the linked policy or a signed agreement.",
      ),
    ],
    [link("Open the current document", to), link("Legal directory", "/legal")],
    { indexable: false, review: "Informational summary — existing policies govern" },
  ),
);

const resourcePages = [
  page(
    "/company",
    "About KovaGPT",
    "An independent AI workspace for conversations and continuing work.",
    [
      section(
        "The product",
        "KovaGPT brings supported chat, research, files, images, projects, and connections into a single account workspace. Capabilities depend on the deployed services and account eligibility.",
      ),
      section(
        "Find the right information",
        "Use product guides for workflows, Help for account questions, and the published legal policies for service terms.",
      ),
    ],
    [link("Mission", "/company/mission"), link("Contact", "/contact-support")],
  ),
  page(
    "/company/mission",
    "Make room for the next question",
    "Help people turn questions and context into useful work.",
    [
      section(
        "A useful starting point",
        "A question becomes more actionable when its goal, evidence, and constraints are clear. KovaGPT is designed to help develop that context through a conversation.",
      ),
      section(
        "Keep people in control",
        "People choose what to share, which tools to authorize, and what work to publish. Generated output still needs review, especially when the consequences matter.",
      ),
    ],
    [link("Explore features", "/features"), link("Security", "/security")],
  ),
  page(
    "/company/news",
    "KovaGPT news",
    "Find published product changes and development information.",
    [
      section(
        "Published changes",
        "The changelog is the place to review recorded product updates. A development proposal or open pull request is not a release announcement.",
      ),
      section(
        "Check availability",
        "When an update changes a tool you use, check its actual account controls and service status before relying on it.",
      ),
    ],
    [link("Changelog", "/changelog"), link("Status", "/status")],
  ),
  page(
    "/company/careers",
    "Careers",
    "No open roles are advertised on this page.",
    [
      section(
        "Current listings",
        "KovaGPT is not publishing job openings here. Do not treat an AI-generated role description or an unofficial outreach message as an offer from KovaGPT.",
      ),
      section(
        "Verify an inquiry",
        "Use the published support channel to ask whether a recruiting message is legitimate. Do not send identity documents or payment information to an unverified contact.",
      ),
    ],
    [link("Contact KovaGPT", "/contact-support")],
    { indexable: false },
  ),
  page(
    "/company/press",
    "Press information",
    "Find the correct product name and a verified contact route.",
    [
      section(
        "Product identity",
        "The product name is KovaGPT and its website is kovagpt.com. Third-party service names in connection guides identify those services and do not imply sponsorship or endorsement.",
      ),
      section(
        "Media inquiries",
        "Contact KovaGPT through the published support channel for product questions and asset requests. No customer numbers, funding, awards, or partnerships are asserted here.",
      ),
    ],
    [link("Contact", "/contact-support"), link("About KovaGPT", "/company")],
  ),
  page(
    "/resources",
    "Resources",
    "Practical guidance for making useful, reviewable AI work.",
    [
      section(
        "Find a workflow",
        "Explore the guides for preparing context, reviewing sources, and organizing a project. Start with a small example and refine it before scaling the workflow.",
      ),
      section(
        "Get product help",
        "For account, payment, file, and connection problems, the Help Center contains the relevant troubleshooting guidance.",
      ),
    ],
    [
      link("Guides", "/resources/guides"),
      link("Tutorials", "/resources/tutorials"),
      link("FAQ", "/resources/faq"),
    ],
  ),
  page(
    "/resources/guides",
    "Practical guides",
    "Choose a concrete workflow and keep the evidence close.",
    [
      section(
        "Research a question",
        "Define the decision, identify what evidence matters, and ask for primary sources. Review each citation and distinguish findings from assumptions.",
      ),
      section(
        "Work with a document",
        "Attach only the relevant file and ask a focused question. Check extracted tables or numbers against the original before using them.",
      ),
      section(
        "Organize a longer project",
        "Create a project, state the outcome in its instructions, and group related chats and supported files there.",
      ),
    ],
    [
      link("Research", "/features/research"),
      link("File guide", "/help/files"),
      link("Projects", "/help/projects"),
    ],
  ),
  page(
    "/resources/tutorials",
    "Tutorials",
    "Three small exercises to learn the workspace.",
    [
      section(
        "Revise a paragraph",
        "Paste a short draft, state the audience, and ask for a clearer opening. Compare the revision with your original and follow up on anything that changes your meaning.",
      ),
      section(
        "Learn a concept",
        "Ask for an explanation at your level, an example, and a question that tests understanding. Explain the answer in your own words before asking for the solution.",
      ),
      section(
        "Plan a task",
        "Describe the desired result, deadline, and constraints. Ask for the first few steps, then review dependencies and choose the next action yourself.",
      ),
    ],
    [link("Start a chat", "/"), link("Getting started", "/help/getting-started")],
  ),
  page(
    "/resources/faq",
    "Frequently asked questions",
    "Answers about KovaGPT plans, accounts, and context.",
    [
      section(
        "Do I need an account?",
        "Protected tools require sign-in. Public help and information pages can be read without opening an account.",
      ),
      section(
        "Does a subscription connect other services?",
        "No. A paid plan and a third-party connection are separate. Review and authorize the service account and scopes for each connection.",
      ),
      section(
        "Can I rely on every answer?",
        "AI output can be incomplete or incorrect. Check important information, citations, calculations, and consequential decisions independently.",
      ),
    ],
    [link("Plans", "/pricing"), link("Help Center", "/help")],
  ),
  page(
    "/resources/updates",
    "Product updates",
    "Review what was published before assuming a feature is live.",
    [
      section(
        "Read the changelog",
        "Use dated changelog entries to understand recorded changes. A source-code change can exist before it reaches the production website.",
      ),
      section(
        "Review the affected workflow",
        "After an update, confirm the relevant controls, permissions, and results in your account. Report an error with its page, time, and request reference.",
      ),
    ],
    [link("Changelog", "/changelog"), link("Status", "/status")],
  ),
  page(
    "/downloads",
    "Use KovaGPT on the web",
    "Open KovaGPT in your browser on desktop, tablet, or mobile.",
    [
      section(
        "Available now",
        "The website is the supported entry point. Use the same account to access account-owned work from another browser, subject to normal sign-in and security checks.",
      ),
      section(
        "Desktop application",
        "No supported desktop installer is offered by this public website. There is no download button until an actual release and supported installer are available.",
      ),
      section(
        "Avoid unofficial downloads",
        "Do not install a package merely because it uses the KovaGPT name. Use the official website for current availability and contact Support if you are unsure.",
      ),
    ],
    [link("Open KovaGPT", "/"), link("Mobile guide", "/features/mobile")],
  ),
  page(
    "/roadmap",
    "Development direction",
    "Understand planned work without confusing it with available features.",
    [
      section(
        "Availability comes first",
        "Connection pages distinguish services that need configuration, restricted account types, and coming-soon integrations. Planned status does not authorize access or promise a release date.",
      ),
      section(
        "Follow published changes",
        "The changelog records product updates. Check actual account controls and service status for the features you intend to use.",
      ),
    ],
    [link("Connections", "/connections"), link("Changelog", "/changelog")],
    { indexable: false },
  ),
  page(
    "/contact",
    "Contact KovaGPT",
    "Choose the existing support channel for account, product, or billing questions.",
    [
      section(
        "Support",
        "Email support@kovagpt.com with a brief description, affected page, and any visible error reference. Keep passwords, API keys, session tokens, and full card details out of the message.",
      ),
      section(
        "Organization inquiries",
        "Describe your workflow, expected users, and access requirements. Team and Enterprise subscriptions are not available for direct purchase from this website.",
      ),
    ],
    [link("Support details", "/contact-support"), link("Billing help", "/help/billing")],
  ),
];

const developerPages = [
  page(
    "/developers/quickstart",
    "API quickstart",
    "Build around scoped credentials, a server catalog, and an explicit quote.",
    [
      section(
        "Prepare the account",
        "Create a verified account and scoped developer key through the console. Configure project and key budgets. Execution requires approved operator pricing and funding availability; this guide does not activate it.",
      ),
      section(
        "Prepare the request",
        "GET /api/v1/models lists the public catalog for your key. POST /api/v1/quotes accepts the operation and input to produce a signed two-minute quote. Submit identical input to the operation endpoint with Authorization: Bearer, X-Kova-Quote, and a stable Idempotency-Key.",
      ),
      section(
        "Review the result",
        "Inspect the response or stream and account for any uncertain completion. Do not submit the same work with a new idempotency key simply because the client disconnected.",
      ),
    ],
    [link("Console", "/developers/console"), link("Responses", "/developers/responses")],
    { indexable: false },
  ),
  page(
    "/developers/authentication",
    "API authentication",
    "A scoped developer key and a consumer login are separate authorities.",
    [
      section(
        "Keep keys server-side",
        "Versioned API operations require a scoped developer bearer key. Console operations use a verified signed-in session. Store keys in your server's credential manager and do not include them in browser bundles or source control.",
      ),
      section(
        "Review scope and budget",
        "Use the least scope needed and configure project and key budgets. A developer key does not grant consumer Project, Library, or connected-account access.",
      ),
    ],
    [link("API keys", "/developers/api-keys"), link("Console", "/developers/console")],
    { indexable: false },
  ),
  page(
    "/developers/api-keys",
    "Developer API keys",
    "Create and manage keys without exposing them to application visitors.",
    [
      section(
        "Choose a narrow key",
        "Use the verified developer console to create credentials for the intended project. Choose supported scopes and budgets deliberately rather than reusing a broadly privileged credential.",
      ),
      section(
        "Rotate and revoke",
        "Keep the key in a server credential store. If it is disclosed, revoke it and update the authorized server configuration. Do not send a key to Support to diagnose a request.",
      ),
    ],
    [
      link("Open console", "/developers/console"),
      link("Authentication", "/developers/authentication"),
    ],
    { indexable: false },
  ),
  page(
    "/developers/models",
    "Public model catalog",
    "Use the models available to your developer key.",
    [
      section(
        "Read the catalog",
        "GET /api/v1/models is the implemented discovery endpoint. Public names map to reviewed provider deployments on the server; do not substitute an assumed upstream model identifier.",
      ),
      section(
        "Check capabilities",
        "Select a model appropriate to the documented operation and obtain a quote for the actual request. A consumer Thinking label and a public API model name are different interfaces.",
      ),
    ],
    [link("Quickstart", "/developers/quickstart"), link("Responses", "/developers/responses")],
    { indexable: false },
  ),
  page(
    "/developers/files",
    "Developer file availability",
    "Consumer attachments are outside the versioned public file-storage contract.",
    [
      section(
        "No public file-store API",
        "The documented versioned API does not provide public file storage or remote file input. Internal routes used by consumer chat or Library are not a supported substitute.",
      ),
      section(
        "Use supported text input",
        "If you are authorized to process a document, extract relevant text in your own application and use the documented text Responses input. Apply your own size, privacy, and access controls before sending it.",
      ),
    ],
    [link("Responses", "/developers/responses"), link("Consumer file guide", "/features/files")],
    { indexable: false },
  ),
  page(
    "/developers/rate-limits",
    "Rate limits and budgets",
    "Handle admission and budget failures without creating duplicate work.",
    [
      section(
        "Respond to throttling",
        "Treat 429 and Retry-After as admission signals. Use bounded concurrency and backoff in your application rather than opening additional requests in an unbounded retry loop.",
      ),
      section(
        "Respect accounting boundaries",
        "An accepted quote reserves a maximum before dispatch; authoritative usage settles the final amount and releases unused credit. Unknown completion can require reconciliation. Do not invent a numeric quota or assume that a new key bypasses account limits.",
      ),
    ],
    [link("Errors", "/developers/errors"), link("Quickstart", "/developers/quickstart")],
    { indexable: false },
  ),
  page(
    "/developers/errors",
    "API errors",
    "Keep retries deliberate and error reports free of credentials.",
    [
      section(
        "Classify the result",
        "Distinguish authentication or scope failures, invalid input, expired or mismatched quotes, rate limits, unavailable execution, and uncertain provider completion. Correct the relevant cause before retrying.",
      ),
      section(
        "Keep the request identity",
        "Reuse the intended idempotency key for a retry of identical work. Review the console when an outcome is uncertain. For support, include a request reference and redacted context instead of bearer keys or private input.",
      ),
    ],
    [link("Rate limits", "/developers/rate-limits"), link("Support", "/contact-support")],
    { indexable: false },
  ),
  page(
    "/developers/changelog",
    "Developer changelog",
    "Separate a repository contract from a verified public release.",
    [
      section(
        "Current documented boundary",
        "The source implements model discovery, signed quotes, text Responses, images, and embeddings behind developer authorization and budget checks. Operator enablement and current pricing remain release requirements.",
      ),
      section(
        "Before upgrading",
        "Review the documented inputs, streaming behavior, idempotency, and accounting semantics. No version change, release date, SDK, or newly activated provider is asserted by this guide.",
      ),
    ],
    [link("API documentation", "/developers/docs"), link("Product changelog", "/changelog")],
    { indexable: false },
  ),
  page(
    "/developers/docs",
    "Developer documentation",
    "Review the implemented versioned API boundary before building an integration.",
    [
      section(
        "Implemented contract",
        "Versioned model discovery, quotes, Responses, images, and embeddings have repository implementations. Execution still depends on operator-enabled pricing, scoped credentials, and account budgets.",
      ),
      section(
        "Excluded surfaces",
        "Consumer files, connected accounts, and internal application endpoints are not a public API merely because the web application uses them. No official SDK is claimed.",
      ),
    ],
    [
      link("Quickstart", "/developers/quickstart"),
      link("API authentication", "/developers/authentication"),
    ],
    { indexable: false },
  ),
  page(
    "/developers/responses",
    "Responses API",
    "Use the implemented text Responses contract with a scoped key and quote.",
    [
      section(
        "Request boundary",
        "POST /api/v1/responses accepts a public model name, text input, optional instructions, required max_output_tokens, and optional stream. Obtain a signed quote for the identical operation and input before dispatch.",
      ),
      section(
        "Retries and accounting",
        "Submit X-Kova-Quote and a stable unique Idempotency-Key. A changed request needs a new quote. A timeout can leave a reservation awaiting reconciliation; repeating with a fresh key can start new work.",
      ),
    ],
    [link("Quickstart", "/developers/quickstart"), link("Errors", "/developers/errors")],
    { indexable: false },
  ),
  page(
    "/developers/images",
    "Images API",
    "Review the implemented image-generation request contract.",
    [
      section(
        "Generation request",
        "POST /api/v1/images accepts a supported public model, prompt, size, quality, and optional n of at most four. The operation requires a matching signed quote, scoped developer key, and idempotency key.",
      ),
      section(
        "Availability and limits",
        "The public model catalog and enabled provider determine availability. This page does not promise image editing, consumer Library access, or a public file-upload API.",
      ),
    ],
    [link("Models", "/developers/models"), link("Rate limits", "/developers/rate-limits")],
    { indexable: false },
  ),
  page(
    "/developers/search",
    "Search API availability",
    "Web search inside KovaGPT is separate from the public developer API.",
    [
      section(
        "Public endpoint status",
        "A standalone public search endpoint is not part of the documented versioned API contract. Do not call an internal consumer search route as though it were a stable developer API.",
      ),
      section(
        "Plan an integration",
        "If your integration needs external retrieval, define its own authorized source access and provide relevant text through the supported Responses contract. Review the source rights and privacy implications.",
      ),
    ],
    [link("API boundary", "/developers/docs"), link("Responses", "/developers/responses")],
    { indexable: false, availability: "Coming soon" },
  ),
  page(
    "/developers/agents",
    "Agent API availability",
    "Consumer agent execution is not a published developer agent API.",
    [
      section(
        "Separate account boundaries",
        "A developer key does not grant access to a customer's projects, browser sessions, or connected services. Those consumer features have their own identity and authorization checks.",
      ),
      section(
        "Supported integration surface",
        "Review the implemented versioned endpoints and the supported MCP contract. Do not infer a public agent endpoint or SDK from a product page.",
      ),
    ],
    [
      link("Developer documentation", "/developers/docs"),
      link("Authentication", "/developers/authentication"),
    ],
    { indexable: false, availability: "Coming soon" },
  ),
  page(
    "/developers/webhooks",
    "Developer webhooks",
    "Distinguish internal provider callbacks from outgoing customer webhooks.",
    [
      section(
        "Current boundary",
        "Repository provider-webhook handlers receive callbacks for internal operations such as payments and configured integrations. They are not a general customer webhook subscription product.",
      ),
      section(
        "Do not assume delivery",
        "No outgoing developer webhook registration endpoint, event catalog, or delivery SLA is offered here. Use the documented response and console behavior for the current API.",
      ),
    ],
    [
      link("Documentation", "/developers/docs"),
      link("Developer changelog", "/developers/changelog"),
    ],
    { indexable: false, availability: "Coming soon" },
  ),
];

const groups = [
  ["/features", "Explore KovaGPT", "Choose a tool around the work you need to do.", featurePages],
  [
    "/connections",
    "Connections",
    "Review access, account requirements, and current integration status.",
    connectionPages,
  ],
  [
    "/security",
    "Security",
    "Practical guidance for account access, permissions, and data controls.",
    securityPages,
  ],
  [
    "/legal",
    "Legal and policies",
    "Find current published policies without changing their terms.",
    legalPages,
  ],
];
const directoryPages = groups.map(([path, title, description, pages]) =>
  page(
    path,
    title,
    description,
    [
      section("Find the relevant guide", description),
      section(
        "Choose a topic",
        path === "/legal"
          ? "Existing published policies govern service use. The summaries below help locate the relevant document and do not introduce new binding terms."
          : path === "/connections"
            ? "Review each service’s account requirements and permission boundaries. Public documentation does not activate a connection or establish that an account grant is valid."
            : path === "/security"
              ? "Use these guides to review sign-in, permissions, data isolation, and reporting. Ask for the evidence your use case needs before relying on a specific assurance."
              : "Start with the tool that fits your goal, then review its account requirements and limitations. Keep related work in Projects and check important outputs against their original sources.",
      ),
    ],
    pages.map((item) => link(item.title, item.path)),
    path === "/legal" ? { indexable: false } : {},
  ),
);

export const PUBLIC_WEBSITE_PAGES = Object.freeze(
  [
    ...featurePages,
    ...connectionPages,
    ...helpPages,
    ...securityPages,
    ...legalPages,
    ...resourcePages,
    ...developerPages,
    ...directoryPages,
  ].map(Object.freeze),
);
export const PUBLIC_WEBSITE_PAGE_BY_PATH = new Map(
  PUBLIC_WEBSITE_PAGES.map((item) => [item.path, item]),
);
export const PUBLIC_WEBSITE_INDEXABLE_PATHS = Object.freeze(
  PUBLIC_WEBSITE_PAGES.filter((item) => item.indexable).map((item) => item.path),
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
