/** Explicit synthetic state: these fixtures never represent an actual account. */
export type ReviewAccount = "guest" | "free" | "plus" | "pro";
export let account: ReviewAccount = "guest";
export let populated = true;
export let reviewTheme = "dark";
const listeners = new Set<() => void>();
export const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const snapshot = () => `${account}:${populated}:${reviewTheme}`;
const notify = () => listeners.forEach((fn) => fn());
export const setReviewAccount = (value: ReviewAccount) => {
  account = value;
  notify();
};
export const setPopulated = (value: boolean) => {
  populated = value;
  notify();
};
export const setReviewTheme = (value: string) => {
  reviewTheme = value;
  notify();
};
export const fixtureId = "22222222-2222-4222-8222-222222222222";
export const fixtureUser = {
  id: fixtureId,
  email: "review@example.invalid",
  fullName: "Review account",
  firstName: "Review",
  lastName: "Account",
  username: "review",
  imageUrl: "",
  primaryEmailAddress: { emailAddress: "review@example.invalid" },
  emailAddresses: [{ emailAddress: "review@example.invalid" }],
  publicMetadata: {},
  unsafeMetadata: {},
  externalAccounts: [],
  createdAt: new Date("2026-01-01"),
  update: async () => {
    throw new Error("Account changes are unavailable in this offline review.");
  },
};
export const reviewProject = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Product launch · fixture",
  description: "Sample project for reviewing the actual interface.",
  system_prompt: "Keep product notes clear and concise.",
  color: "blue",
  owner_id: fixtureId,
  created_at: "2026-01-01T12:00:00Z",
  updated_at: "2026-01-02T12:00:00Z",
  pinned_at: null,
  archived_at: null,
  deletion_requested_at: null,
  member_count: 1,
  chat_count: 0,
  file_count: 0,
  role: "owner",
};
export const reviewLibrary = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Welcome notes · fixture",
    item_type: "document",
    source: "manual",
    content_text:
      "This is sample saved text. It is not account data.\n\nThe review renders the real Library component.",
    file_url: null,
    file_name: "welcome-notes.txt",
    file_type: "text/plain",
    file_size: 168,
    created_at: "2026-01-02T12:00:00Z",
    updated_at: "2026-01-02T12:00:00Z",
  },
];
export function subscriptionSummary() {
  const tier = account === "guest" ? "free" : account;
  return {
    tier,
    effectiveTier: tier,
    inherited: false,
    activeSubscriptionCount: 0,
    billingConflict: false,
    status: null,
    priceId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialing: false,
    hasBillingAccount: false,
    billingPortalAvailable: false,
  };
}
export async function fixtureFunction(name: string, ..._args: unknown[]) {
  if (name === "getSubscriptionSummary") return subscriptionSummary();
  if (name === "getGitHubManagement")
    return {
      configured: false,
      accounts: [],
      installations: [],
      repositories: [],
      health: "credentials_not_configured",
    };
  if (name === "isScheduledTasksEligible")
    return {
      eligible: account === "plus" || account === "pro",
      executionAvailable: false,
      reason: "Offline review: no task worker is connected.",
    };
  if (name === "listScheduledTaskOffers") return { sent: [], received: [] };
  if (name === "listProjects") return populated ? [reviewProject] : [];
  if (name === "getProject") return reviewProject;
  if (name === "listMembers")
    return [
      {
        user_id: fixtureId,
        role: "owner",
        profile: { full_name: "Review account", email: "review@example.invalid" },
      },
    ];
  if (name === "getProjectNote")
    return {
      content: "Sample project notes. Offline fixture only.",
      updated_at: "2026-01-02T12:00:00Z",
      project_id: reviewProject.id,
    };
  if (name === "listLibraryPage") return { items: populated ? reviewLibrary : [], cursor: null };
  if (name === "listMyLibrary") return populated ? reviewLibrary : [];
  if (/getOnboarding/.test(name)) return { completed: true };
  if (/^list|^search|^fetch/.test(name)) return [];
  if (/^get|^read/.test(name)) return null;
  throw new Error("Unavailable in this offline review. No change was sent.");
}
export function installReviewNetwork() {
  globalThis.fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (raw.startsWith("data:")) {
      const [header, data] = raw.split(",");
      const bytes = header.includes(";base64")
        ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(data));
      return new Response(bytes, { headers: { "Content-Type": header.slice(5).split(";")[0] } });
    }
    const url = new URL(raw, "https://review.invalid");
    const method = (
      init?.method || (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.pathname === "/api/chat/history" && method === "GET")
      return json({ conversations: [], cursor: null });
    if (url.pathname === "/api/library/folders" && method === "GET") return json({ folders: [] });
    if (url.pathname === "/api/library/items") {
      let operation = "";
      try {
        operation = typeof init?.body === "string" ? JSON.parse(init.body).operation : "";
      } catch {
        /* Invalid bodies remain unavailable. */
      }
      if (method === "GET" || (method === "POST" && operation === "list"))
        return json({ items: populated ? reviewLibrary : [], cursor: null });
    }
    if (url.pathname === "/auth/v1/settings")
      return json({ external: { google: false, email: true }, disable_signup: false });
    if (url.pathname === "/api/google/status" && method === "GET")
      return json({
        connected: false,
        state: "disconnected",
        accounts: [],
        configured: false,
        selectionRevision: 0,
        selectedConnectionId: null,
      });
    if (url.pathname === "/api/github/tool" && method === "GET")
      return json({
        connected: false,
        configured: false,
        ok: true,
        access_mode: "none",
        actions: [],
      });
    if (["/api/auth/session", "/api/session"].includes(url.pathname))
      return json({
        authenticated: account !== "guest",
        user: account === "guest" ? null : { id: fixtureId, email: fixtureUser.email },
      });
    if (url.pathname.startsWith("/api/integrations/"))
      return json({ accounts: [], connections: [], providers: [], configured: false });
    if (url.pathname === "/api/auth/config")
      return json({ emailPasswordEnabled: false, googleEnabled: false, passkeysEnabled: false });
    if (url.pathname === "/api/billing/status")
      return json({
        tier: account === "guest" ? "free" : account,
        subscription: null,
        configured: false,
      });
    if (url.pathname === "/api/chat")
      return json(
        {
          error:
            "Offline review: AI generation is not connected. Your draft can be edited and retried in the live app.",
        },
        503,
      );
    return json(
      {
        error:
          method === "GET" || method === "HEAD"
            ? "This service is unavailable in the offline review."
            : "Unavailable in this offline review. No change was sent.",
      },
      503,
    );
  };
}
