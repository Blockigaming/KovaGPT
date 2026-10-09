import {
  account,
  fixtureId,
  fixtureUser,
  populated,
  reviewLibrary,
  reviewProject,
  subscriptionSummary,
} from "./state";
const user = () =>
  account === "guest"
    ? null
    : {
        id: fixtureId,
        email: fixtureUser.email,
        user_metadata: { full_name: fixtureUser.fullName },
      };
const unavailable = () =>
  Promise.resolve({
    data: null,
    error: { message: "Unavailable in this offline review. No change was sent." },
  });
export function getSupabaseClientConfigStatus() {
  return { configured: true, missing: [] };
}
export async function signOutLegacySupabaseSession() {
  return { error: null };
}
export async function resolveLegacyAuthContext() {
  return { supabase, assertCurrent() {} };
}
function query(table: string) {
  let single = false;
  const rows = () =>
    table === "library_items"
      ? populated
        ? reviewLibrary
        : []
      : table === "projects"
        ? populated
          ? [reviewProject]
          : []
        : table === "profiles"
          ? [{ id: fixtureId, full_name: fixtureUser.fullName, email: fixtureUser.email }]
          : [];
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "then")
          return (resolve: (result: unknown) => void) =>
            resolve({
              data: single ? (rows()[0] ?? null) : rows(),
              error: null,
              count: rows().length,
            });
        if (["insert", "upsert", "update", "delete"].includes(String(key)))
          return () => ({
            then: (resolve: (result: unknown) => void) => unavailable().then(resolve),
            select: unavailable,
          });
        if (["single", "maybeSingle"].includes(String(key)))
          return () => {
            single = true;
            return proxy;
          };
        return () => proxy;
      },
    },
  );
  return proxy;
}
const channel = {
  on() {
    return channel;
  },
  subscribe() {
    return channel;
  },
  unsubscribe() {},
};
export const supabase = {
  from: query,
  rpc: async (name: string) => ({
    data: name === "current_subscription_summary" ? subscriptionSummary() : null,
    error: null,
  }),
  auth: {
    getSession: async () => ({
      data: { session: user() ? { access_token: "offline-review-token", user: user() } : null },
      error: null,
    }),
    getUser: async () => ({ data: { user: user() }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: unavailable,
    signInWithPassword: unavailable,
    signUp: unavailable,
    signInWithOAuth: unavailable,
    resetPasswordForEmail: unavailable,
    updateUser: unavailable,
    signInWithOtp: unavailable,
    verifyOtp: unavailable,
    resend: unavailable,
    mfa: {
      listFactors: async () => ({ data: { all: [], totp: [], phone: [] }, error: null }),
      getAuthenticatorAssuranceLevel: async () => ({
        data: { currentLevel: "aal1", nextLevel: "aal1" },
        error: null,
      }),
    },
  },
  channel: () => channel,
  removeChannel() {},
  storage: {
    from: () => ({ createSignedUrl: unavailable, upload: unavailable, remove: unavailable }),
  },
};
