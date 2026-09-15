import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";

export const HELP_CATEGORIES = [
  "Getting started",
  "Account & sign-in",
  "Chat & modes",
  "Search & research",
  "Files & images",
  "Projects",
  "Library & sharing",
  "Apps & integrations",
  "Local places",
  "Settings & memory",
  "Billing & plans",
  "Privacy & security",
  "Scheduled tasks",
  "Troubleshooting",
  "Contact & support",
] as const;

export type HelpCategory = (typeof HELP_CATEGORIES)[number];
export type HelpFaq = {
  id: string;
  category: HelpCategory;
  question: string;
  answer: string;
  keywords: string[];
};
type Row = readonly [HelpCategory, string, string, string?];

const modes = CAPABILITY_REGISTRY.modesByTier;
const plan = CAPABILITY_REGISTRY.plans;
const features = CAPABILITY_REGISTRY.features;

const rows: Row[] = [
  [
    "Getting started",
    "What is KovaGPT?",
    "KovaGPT is an AI workspace for conversations, web research, supported files, images, projects, and connected apps. Availability can depend on your plan and the providers configured for this deployment.",
  ],
  [
    "Getting started",
    "What should I try first?",
    "Start a new chat and ask a specific question or describe an outcome you want. For ongoing work, select Projects from the sidebar so related chats, instructions, and supported files stay together.",
  ],
  [
    "Getting started",
    "How do I start a new chat?",
    "Select New chat in the sidebar. Choose a mode or tool in the composer, enter your message, and send it.",
  ],
  ["Getting started", "Where are my previous chats?", features.cloudHistory.summary],
  [
    "Getting started",
    "Can I use KovaGPT without an account?",
    "You can view public pages while signed out, but creating chats and using account features requires sign-in.",
  ],
  [
    "Getting started",
    "Does KovaGPT work on mobile?",
    "Yes. KovaGPT has a responsive web experience and can be installed as a web app where the browser supports installation.",
  ],
  [
    "Getting started",
    "Which browsers are supported?",
    "Use a current version of a modern browser. If a device feature such as passkeys, installation, or push notifications is missing, update the browser or try another current browser.",
  ],
  [
    "Account & sign-in",
    "How do I create an account?",
    "Choose Sign in, then continue with an available provider or email. The sign-in screen shows only the methods enabled for the current deployment.",
  ],
  [
    "Account & sign-in",
    "How do I change my display name or profile image?",
    "Open your profile menu → Settings → Account. Update the fields available for your account; provider-managed profile details may need to be changed with that provider.",
  ],
  [
    "Account & sign-in",
    "How do I change my password?",
    "Choose Forgot password on the email sign-in screen. Accounts created with Google or another external provider manage their password with that provider.",
  ],
  [
    "Account & sign-in",
    "How does Google sign-in work?",
    "Choose Continue with Google and approve the Google sign-in request. KovaGPT does not receive your Google password.",
  ],
  [
    "Account & sign-in",
    "Why did Google sign-in fail?",
    "Retry, refresh the page, allow the sign-in window, and confirm cookies are not blocked. Then try another current browser; contact support if the problem continues.",
    "google login oauth popup",
  ],
  [
    "Account & sign-in",
    "I cannot sign in. What should I try?",
    "Retry once, refresh, verify your connection, and request a fresh sign-in or password-reset email. Check browser privacy blockers, then try another current browser or device before contacting support.",
    "can't login cant login locked out",
  ],
  [
    "Account & sign-in",
    "Why did my sign-in email not arrive?",
    "Check spam, junk, and Promotions, confirm the address, and request a fresh email. Use only the newest link because older or expired links may not work.",
  ],
  [
    "Account & sign-in",
    "Does KovaGPT support passkeys?",
    "Passkey sign-in is available when enabled for the deployment and supported by your browser and device. Manage registered passkeys in Settings.",
  ],
  [
    "Chat & modes",
    "How do I send a message?",
    "Type in the composer and select Send, or use the keyboard shortcut shown by your device. Attach supported context before sending if needed.",
  ],
  [
    "Chat & modes",
    "How do I stop a response?",
    "Use the stop control that replaces Send while a response is being generated. Stopping keeps the content already received.",
  ],
  [
    "Chat & modes",
    "Can I regenerate an answer?",
    "Use the retry action on a completed or failed response when it is shown. A new result may differ, so verify important details.",
  ],
  [
    "Chat & modes",
    "Can I edit a previous message?",
    "Use the edit action when it appears on your message. Editing creates a new path from that point, so later context can change.",
  ],
  [
    "Chat & modes",
    "How do I copy an answer?",
    "Use the copy action on the response. For generated artifacts, use the editor or export controls offered for that item.",
  ],
  [
    "Chat & modes",
    "How do I rename or delete a conversation?",
    "Open the conversation menu in history and choose Rename or Delete. Confirm deletion carefully because deleted conversations may not be recoverable.",
  ],
  [
    "Chat & modes",
    "Why can KovaGPT make mistakes?",
    "AI responses can be incomplete or incorrect. Check important claims, calculations, and cited sources, especially for medical, legal, financial, or safety-sensitive decisions.",
  ],
  [
    "Chat & modes",
    "Does a new chat remember an earlier chat?",
    `Only Adaptive Memory can carry selected context across ordinary chats, and it is available to signed-in Plus and Pro users when enabled. A new chat otherwise starts with its own context.`,
  ],
  [
    "Chat & modes",
    "Why did a long conversation lose context?",
    "Very long conversations can exceed the context available to the selected model. Restate the important details, attach a concise source, or start a new chat with a summary.",
  ],
  [
    "Chat & modes",
    "What is Instant mode?",
    "Instant is optimized for the shortest, fastest replies and is included on Free, Plus, and Pro.",
  ],
  [
    "Chat & modes",
    "What is Medium mode?",
    "Medium balances speed and detail for everyday work and is included on Free, Plus, and Pro.",
  ],
  [
    "Chat & modes",
    "What is Thinking mode?",
    "Thinking uses more careful, structured reasoning for harder requests and is included on Free, Plus, and Pro.",
  ],
  [
    "Chat & modes",
    "What is High mode?",
    "High emphasizes deeper verification and completeness. It is available on Plus and Pro.",
  ],
  [
    "Chat & modes",
    "What is Extra high mode?",
    "Extra high emphasizes alternatives and detail before Pro mode. It is available on Pro.",
  ],
  [
    "Chat & modes",
    "What is Pro mode?",
    "Pro uses the maximum available context and reasoning for polished, comprehensive answers. It is available on Pro.",
  ],
  [
    "Chat & modes",
    "Which modes are on each plan?",
    `Free includes ${modes.free.map((m) => m.label).join(", ")}. Plus includes ${modes.plus.map((m) => m.label).join(", ")}. Pro includes ${modes.pro.map((m) => m.label).join(", ")}. Previous Kova generations also remain available for consistency with older work.`,
  ],
  [
    "Chat & modes",
    "Why do I not see every mode?",
    "Mode availability follows your current plan and can also depend on deployment readiness. Refresh after a plan change; if Billing shows the new plan but the mode is still absent, sign out and in, then contact support.",
  ],
  [
    "Chat & modes",
    "Do more capable modes take longer?",
    "They can. Modes that perform deeper reasoning may take longer than Instant or Medium, especially for complex requests.",
  ],
  [
    "Search & research",
    "What does Search do?",
    `${features.webSearch.summary} ${features.webSearch.limitation}`,
  ],
  [
    "Search & research",
    "When should I use Search?",
    "Use Search for current events, recent product details, live public information, or whenever you want web sources. You usually do not need it for rewriting or questions based only on text you supplied.",
  ],
  [
    "Search & research",
    "Does Search browse the live web?",
    "Search can retrieve current web sources when its configured search and AI providers are available. The linked pages remain the source of truth.",
  ],
  [
    "Search & research",
    "Can KovaGPT cite sources?",
    "Search and Deep Research can return linked sources. Open each citation and confirm it supports the nearby claim.",
  ],
  [
    "Search & research",
    "Why might two searches differ?",
    "Web pages and rankings change, and different wording can retrieve different evidence. Compare the citations rather than relying only on the generated summary.",
  ],
  [
    "Search & research",
    "Why is Search unavailable?",
    "Search depends on configured providers and your remaining allowance. Refresh, confirm the tool is selected, and try again; if it remains unavailable, contact support.",
  ],
  [
    "Search & research",
    "What is Deep Research?",
    `${features.deepResearch.summary} ${features.deepResearch.limitation}`,
  ],
  [
    "Search & research",
    "Who can use Deep Research?",
    "Signed-in Plus and Pro users can use Deep Research when its providers are configured and available.",
  ],
  [
    "Files & images",
    "What files can I upload to chat?",
    `${features.attachments.summary} ${features.attachments.limitation}`,
  ],
  [
    "Files & images",
    "How do I upload a file?",
    "Use the attachment control in the chat composer and choose a supported file. Wait for the attachment to finish preparing before sending.",
  ],
  [
    "Files & images",
    "Why did my upload fail?",
    "Retry, confirm the type and size are supported, and check your connection and remaining upload allowance. Refresh and try one file at a time; if it still fails, contact support with the file type and error.",
  ],
  [
    "Files & images",
    "Can KovaGPT analyze spreadsheets?",
    `${features.dataAnalysis.summary} ${features.dataAnalysis.limitation}`,
  ],
  [
    "Files & images",
    "Can KovaGPT understand uploaded images?",
    "Chat accepts supported image attachments and can reason about their visible content. Results may miss small text or ambiguous details, so verify against the original.",
  ],
  [
    "Files & images",
    "Are file limits different by plan?",
    "Yes. Published upload and storage allowances increase by plan. Check Pricing and the usage information shown in the product for the current allowance.",
  ],
  [
    "Files & images",
    "Can I remove a file before sending?",
    "Yes. Use the remove control on the attachment preview before sending the message.",
  ],
  [
    "Files & images",
    "How do I generate an image?",
    "Open Images, describe the subject, composition, and style, choose available settings, and generate. You must be signed in and have image allowance remaining.",
  ],
  [
    "Files & images",
    "How should I describe the image I want?",
    "State the subject, setting, composition, lighting, medium, and important exclusions. Clear constraints usually work better than a long list of vague adjectives.",
  ],
  ["Files & images", "Can I edit an existing image?", features.imageEditing.summary],
  [
    "Files & images",
    "Why was an image request rejected?",
    "A request can be rejected by safety rules, invalid settings, an unsupported source image, or provider availability. Revise the request without prohibited content and use supported settings.",
  ],
  [
    "Files & images",
    "Why is image generation slow?",
    "Generation time varies with provider load and selected settings. Keep the page open, retry only after an error, and avoid starting duplicate requests.",
  ],
  [
    "Files & images",
    "Are image limits plan dependent?",
    "Yes. Every plan has a finite daily image allowance, with higher published allowances on paid plans.",
  ],
  ["Files & images", "What is Canvas?", `${features.canvas.summary} ${features.canvas.limitation}`],
  ["Projects", "What are Projects?", features.projects.summary],
  [
    "Projects",
    "How do I create a project?",
    "Select Projects from the sidebar, choose New project, enter the requested details, and create it.",
  ],
  [
    "Projects",
    "How do I rename a project?",
    "Open the project and use its settings or project menu to update the name.",
  ],
  [
    "Projects",
    "How do I delete a project?",
    "Open the project settings, choose Delete project, and confirm. Deletion also cleans up project-owned records and stored project files, so review the confirmation carefully.",
  ],
  [
    "Projects",
    "How do I add chats to a project?",
    "Start a chat from inside the project. Where a move control is offered, you can also assign an existing eligible chat to a project.",
  ],
  [
    "Projects",
    "Can I upload files to a project?",
    "Yes. Project knowledge accepts supported files, subject to your upload and storage allowances.",
  ],
  [
    "Projects",
    "Does project context carry across chats?",
    "Project instructions, supported knowledge, notes, and project memory can provide context to chats in that project. Keep critical instructions explicit and verify important outputs.",
  ],
  [
    "Projects",
    "Can I share a project?",
    "Project owners can open the Members area and invite collaborators. Sharing requires the collaboration service to be available.",
  ],
  [
    "Projects",
    "How do project invitations work?",
    "The owner sends an invitation to an email address. The recipient signs in with the invited identity and accepts the invitation before accessing the project.",
  ],
  [
    "Projects",
    "Can someone without an account accept a project invitation?",
    "They need a KovaGPT account associated with the invited identity before they can participate.",
  ],
  [
    "Projects",
    "What happens when a collaborator is removed?",
    "Their project access is revoked. Content they previously copied or exported outside the project is not recalled.",
  ],
  [
    "Projects",
    "Can I leave a shared project?",
    "Use the membership control available in the shared project. The owner retains the project and its content.",
  ],
  [
    "Projects",
    "Who owns a shared project?",
    "The account that created the project remains its owner unless the product explicitly confirms an ownership change.",
  ],
  ["Library & sharing", "What is Library?", features.library.summary],
  [
    "Library & sharing",
    "How do I save something to Library?",
    "Use Save to Library on an eligible response, image, or file. Only items you explicitly save or upload appear there.",
  ],
  [
    "Library & sharing",
    "Can I reopen or remove a Library item?",
    "Open Library from the sidebar, select the item to reopen it, or use its delete control to remove it. Confirm deletion carefully.",
  ],
  [
    "Library & sharing",
    "Can I organize Library items?",
    "Yes. Library folders and bulk move controls are available for organizing eligible saved items.",
  ],
  [
    "Library & sharing",
    "How do I share a chat?",
    "Use the Share action in an eligible conversation. Review the preview and access settings before creating or sending a link.",
  ],
  [
    "Library & sharing",
    "Does a shared chat update automatically?",
    "Treat the share preview as the authority for what recipients can see. Review it again after changing the original conversation.",
  ],
  [
    "Apps & integrations",
    "Which apps can I connect?",
    `The working Apps page lists ${CAPABILITY_REGISTRY.workingApps.join(", ")}. ${features.apps.limitation}`,
  ],
  [
    "Apps & integrations",
    "How do I connect an app?",
    "Open Apps from the sidebar, select a provider, and review its consent screen. Approve only the permissions you understand.",
  ],
  [
    "Apps & integrations",
    "How do I disconnect or reconnect an app?",
    "Open Apps, select the connected service, and choose Disconnect. To reconnect, start its connection flow again and approve the required scopes.",
  ],
  [
    "Apps & integrations",
    "Why does an integration ask for permission?",
    "The provider consent screen lists the scopes needed for requested actions. KovaGPT can use only the access granted and supported by the connection.",
  ],
  [
    "Apps & integrations",
    "What happens when I revoke access?",
    "New integration actions stop working. Data already brought into a chat, project, or output is not automatically removed; delete that content separately if needed.",
  ],
  [
    "Apps & integrations",
    "Why did a connected app stop working?",
    "Retry, open Apps to check connection status and scopes, then disconnect and reconnect if appropriate. Provider outages or deployment configuration can also make an action unavailable.",
  ],
  [
    "Apps & integrations",
    "How does Gmail integration work?",
    "Connect Gmail from Apps. Available read or write actions depend on granted scopes, configured credentials, and service availability.",
  ],
  [
    "Apps & integrations",
    "Can KovaGPT search my email or read attachments?",
    "It can perform only Gmail actions supported by the current connection and scopes. Review the requested action and resulting source before relying on it.",
  ],
  [
    "Apps & integrations",
    "Can KovaGPT draft or send email?",
    "Supported Gmail write actions require an explicit confirmation step before execution. KovaGPT does not send mail silently.",
  ],
  [
    "Apps & integrations",
    "Can KovaGPT check or change my calendar?",
    "Connected Google Calendar actions can read or write only when supported by the granted scopes. Write actions such as creating or changing an event require confirmation before execution.",
  ],
  [
    "Apps & integrations",
    "Can KovaGPT search Google Drive?",
    "Google Drive can be connected from Apps. Search and reading depend on granted scopes, supported file handling, and provider availability.",
  ],
  [
    "Apps & integrations",
    "Can KovaGPT modify Drive files?",
    "Do not assume general Drive editing. Only actions shown for confirmation and supported by the current connection can run.",
  ],
  [
    "Apps & integrations",
    "How does GitHub integration work?",
    "Connect GitHub from Apps and review its scopes. Available repository actions depend on the granted access and current integration support.",
  ],
  [
    "Local places",
    "What is Local places?",
    "Local places is the Maps experience in KovaGPT. It finds sourced local web results for a place you enter and can hand off to external map services.",
  ],
  [
    "Local places",
    "Can it search real places?",
    "Yes, when its search provider is available. Check the linked source and external map before traveling because listings can change.",
  ],
  [
    "Local places",
    "Can it provide directions?",
    "KovaGPT can open an external map handoff for directions. It does not provide its own turn-by-turn navigation.",
  ],
  [
    "Local places",
    "Does KovaGPT use my device location?",
    "No. KovaGPT does not request or store device coordinates in Settings. Enter a city, region, address, or place in your request.",
  ],
  [
    "Local places",
    "Why is Local places unavailable?",
    "You must be signed in, and its web search provider must be configured. Refresh, check your connection, and try again before contacting support.",
  ],
  [
    "Settings & memory",
    "Where are Settings?",
    "Open your profile menu and choose Settings. Available sections include account, personalization, memory, apps, subscription, privacy, and appearance controls where applicable.",
  ],
  [
    "Settings & memory",
    "How do I change appearance?",
    "Open your profile menu → Settings → Appearance and choose an available theme.",
  ],
  [
    "Settings & memory",
    "Can I change how KovaGPT responds?",
    "Use personalization controls and explicit instructions in chat or a project. KovaGPT applies supported preferences to future responses in the relevant context.",
  ],
  ["Settings & memory", "What is Adaptive Memory?", features.memory.summary],
  [
    "Settings & memory",
    "How do I turn Memory off or delete it?",
    "Open Settings → Memory. Turn Memory off to block new cross-chat memory use and writes, or choose Delete saved memory to remove stored cross-chat memory.",
  ],
  [
    "Settings & memory",
    "Is Memory the same as chat history?",
    "No. History stores eligible conversations; Adaptive Memory stores selected cross-chat context. Turning off or deleting memory does not delete chat history or local drafts.",
  ],
  [
    "Settings & memory",
    "Does Temporary Chat use Memory?",
    "No. Temporary Chat does not use or update Adaptive Memory and stays out of conversation history.",
  ],
  [
    "Settings & memory",
    "How do notifications work?",
    "Open Notifications to review in-product notifications. Web push requires a supported browser, permission, and deployment configuration.",
  ],
  [
    "Billing & plans",
    "What plans does KovaGPT offer?",
    `KovaGPT offers ${plan.free.name}, ${plan.plus.name}, and ${plan.pro.name}. Enterprise requirements can be discussed separately; scope and terms are confirmed before purchase.`,
  ],
  [
    "Billing & plans",
    "What is included in Free?",
    `${plan.free.description} ${plan.free.features.join(". ")}.`,
  ],
  [
    "Billing & plans",
    "What is included in Plus?",
    `${plan.plus.description} ${plan.plus.features.join(". ")}.`,
  ],
  [
    "Billing & plans",
    "What is included in Pro?",
    `${plan.pro.description} ${plan.pro.features.join(". ")}.`,
  ],
  [
    "Billing & plans",
    "How much do Plus and Pro cost?",
    `Published monthly prices are $${plan.plus.monthlyPriceUsd} USD for Plus and $${plan.pro.monthlyPriceUsd} USD for Pro before any tax shown at checkout. Confirm the final amount in Stripe before purchase.`,
  ],
  [
    "Billing & plans",
    "How does the Plus trial work?",
    `Eligible first-time Plus subscribers may receive a ${plan.plus.trialPeriodDays}-day trial. Checkout confirms eligibility, renewal timing, and the amount before you subscribe.`,
  ],
  [
    "Billing & plans",
    "How do I upgrade or downgrade?",
    "Open Settings → Subscription. Choose an available plan change and review its price and effective date in checkout or the billing portal before confirming.",
  ],
  [
    "Billing & plans",
    "Where do I manage my subscription?",
    "Open Settings → Subscription and choose Manage subscription. If the Stripe portal is not configured, use the displayed support option.",
  ],
  [
    "Billing & plans",
    "What payment methods are accepted?",
    "Stripe Checkout shows the payment methods available for your account, device, and region. KovaGPT does not promise that every method is available everywhere.",
  ],
  [
    "Billing & plans",
    "Why did my payment fail?",
    "Confirm the billing details, available funds, and any bank authentication request, then retry once. Contact your bank or support if Stripe continues to reject the payment.",
  ],
  [
    "Billing & plans",
    "Where are invoices and receipts?",
    "Open Settings → Subscription → Manage subscription to view billing records available in Stripe. If the portal is unavailable, contact support from your account email.",
  ],
  [
    "Billing & plans",
    "Why was tax added?",
    "Stripe calculates applicable tax from the billing information and rules presented at checkout. The published plan prices are before any tax shown there.",
  ],
  [
    "Billing & plans",
    "How do I update my payment method?",
    "Open Settings → Subscription → Manage subscription and use the Stripe portal. If that control is unavailable, contact support.",
  ],
  [
    "Billing & plans",
    "Does my subscription renew automatically?",
    "Review the checkout and Stripe portal for the renewal date and terms that apply to your subscription.",
  ],
  [
    "Billing & plans",
    "How do I cancel?",
    "Open Settings → Subscription → Manage subscription and cancel in the Stripe portal. If self-service cancellation is unavailable, contact support from your account email.",
    "cancel stop charged subscription",
  ],
  [
    "Billing & plans",
    "What happens after cancellation?",
    "The Stripe portal confirms the effective date. Your chats are not deleted merely because a paid subscription ends, but paid features and higher allowances stop when the plan changes.",
  ],
  [
    "Billing & plans",
    "Are refunds available?",
    "Review the current Refund Policy for eligibility, then contact support with your account email and purchase details. Do not include a full card number.",
  ],
  [
    "Billing & plans",
    "Why is my upgraded plan not showing?",
    "Refresh Billing, confirm the purchase completed for the same account, then sign out and in. Do not buy again while a payment is reconciling; contact support if the mismatch remains.",
  ],
  [
    "Billing & plans",
    "How do usage limits work?",
    "Every published plan has finite chat, image, upload, and storage allowances. The app reports applicable limits; paid plans have higher published allowances but are not unlimited.",
  ],
  [
    "Privacy & security",
    "How does KovaGPT use my data?",
    "Review the current Privacy Policy for the authoritative description of collection, processing, providers, retention, and your choices.",
  ],
  [
    "Privacy & security",
    "Are my conversations private?",
    "Chats are tied to your account or device according to the active mode and sync state. Do not put secrets into a chat, and review the Privacy Policy and sharing preview before sending content.",
  ],
  [
    "Privacy & security",
    "What happens to uploaded files?",
    "Files are processed and stored as needed for the chat, project, or Library feature you use. Delete them with the relevant product controls and review the Privacy Policy for retention details.",
  ],
  [
    "Privacy & security",
    "What data do integrations share?",
    "The provider consent screen lists granted scopes. Requested content and action details may be sent to the connected provider; revoke access in Apps or with the provider.",
  ],
  [
    "Privacy & security",
    "How do I export my data?",
    "Open Settings and use the available data export control. Wait for the export to complete; contact support if the control is unavailable or the export fails.",
  ],
  [
    "Privacy & security",
    "How do I delete my account?",
    "Open Settings → Account and use Delete account. Complete the confirmation and wait for success before assuming deletion finished.",
  ],
  [
    "Privacy & security",
    "What happens when I delete my account?",
    "Account-owned product data is scheduled for deletion through the account deletion flow. Some billing, security, legal, backup, or external-provider records may remain as described in the Privacy Policy.",
  ],
  ["Privacy & security", "Does KovaGPT support MFA?", features.mfa.summary],
  [
    "Privacy & security",
    "What should I do if someone accessed my account?",
    "Secure your email or identity-provider account first, change applicable credentials, revoke unfamiliar sessions or integrations, enable MFA where supported, and contact support.",
  ],
  [
    "Privacy & security",
    "Can support see my password?",
    "No. Never send a password, one-time code, passkey, recovery code, or full payment-card number to support.",
  ],
  [
    "Privacy & security",
    "How do I contact KovaGPT about privacy?",
    "Use the support form below, choose Privacy & security, and send it from the email associated with your account. You can also email support@kovagpt.com.",
  ],
  [
    "Scheduled tasks",
    "What are Scheduled Tasks?",
    "Scheduled Tasks are records for recurring or event-driven workflows. Background scheduled execution is unavailable in this deployment; previously saved task records can still be managed.",
  ],
  ["Scheduled tasks", "Why can I not create a Scheduled Task?", features.scheduledTasks.summary],
  [
    "Scheduled tasks",
    "Can I edit, pause, or delete a saved task?",
    "Open Scheduled Tasks from the sidebar and use the controls shown for an existing record. Managing a record does not make unavailable background execution active.",
  ],
  [
    "Troubleshooting",
    "KovaGPT is slow or not responding.",
    "Retry the action once, refresh, check your connection, and close unusually heavy tabs. Sign out and in if appropriate, disable interfering extensions, then try another current browser or device.",
  ],
  [
    "Troubleshooting",
    "A message is stuck on Thinking.",
    "Stop the response, retry once, then refresh and check your connection. Try a shorter request or faster mode; if it repeats, contact support with the time and mode.",
  ],
  [
    "Troubleshooting",
    "My message failed to send.",
    "Retry once, check your connection and remaining allowance, then refresh. Remove unsupported attachments, sign out and in, and try another current browser before contacting support.",
  ],
  [
    "Troubleshooting",
    "Search is not working.",
    "Retry, confirm Search is selected, and open a normal public query. Refresh, check your connection and allowance, disable blockers that prevent requests, then contact support.",
  ],
  [
    "Troubleshooting",
    "An image will not generate.",
    "Retry with supported settings and a policy-compliant prompt. Check your image allowance and connection, refresh, and try another current browser before contacting support.",
  ],
  [
    "Troubleshooting",
    "Uploads keep failing.",
    "Confirm the type, size, and allowance, then retry one file at a time. Refresh, check the connection, remove privacy extensions that block uploads, and try another current browser.",
  ],
  [
    "Troubleshooting",
    "My subscription is not showing.",
    "Refresh Settings → Subscription, verify you are in the purchasing account, then sign out and in. Do not purchase twice; contact support with the receipt if it remains missing.",
  ],
  [
    "Troubleshooting",
    "The page looks broken or my sidebar disappeared.",
    "Refresh and reset browser zoom, then widen the window or use the mobile navigation control. Disable extensions that alter pages and try another current browser.",
  ],
  [
    "Troubleshooting",
    "Why is a feature missing on another device?",
    "Confirm both devices use the same account, plan, app version, and relevant settings. Some browser capabilities and unsynced local data are device-specific.",
  ],
  [
    "Troubleshooting",
    "I see an error message. What should I send support?",
    "Include the exact message, page, time, what you clicked, expected result, browser and device, and any visible correlation ID. Remove secrets and payment details from screenshots.",
  ],
  [
    "Contact & support",
    "How do I contact support?",
    "Use the form below or email support@kovagpt.com. Include the account email, relevant page, what happened, and what you expected.",
  ],
  [
    "Contact & support",
    "How do I report a bug?",
    "Choose Bug report below and describe reproducible steps, the result, the expected result, browser and device, and any error or correlation ID.",
  ],
  [
    "Contact & support",
    "Can I request a feature?",
    "Yes. Choose Feature request in the support form and explain the problem you want to solve rather than sending sensitive data.",
  ],
  [
    "Contact & support",
    "What should I never send support?",
    "Never send passwords, one-time codes, passkeys, recovery codes, API secrets, or full payment-card numbers.",
  ],
];

export const HELP_FAQS: HelpFaq[] = rows.map(([category, question, answer, aliases], index) => ({
  id: `help-${index + 1}`,
  category,
  question,
  answer,
  keywords: aliases?.split(" ") ?? [],
}));
