import { createHookHarness, loadUiModule, deferred } from "./ui-state-harness.mjs";
export function planTierFixture({ configured = true } = {}) {
  const h = createHookHarness();
  const requests = [];
  let user = { id: "owner-a" },
    callback;
  const read = ({ data }) => {
    const request = deferred();
    requests.push({ ...request, owner: data.ownerId });
    return request.promise;
  };
  const window = new EventTarget(),
    document = new EventTarget();
  document.visibilityState = "visible";
  const { useTier } = loadUiModule(
    "src/hooks/useTier.ts",
    {
      react: h.react,
      "@tanstack/react-start": { useServerFn: () => read },
      "@/utils/plan.functions": { getMyPlanTier: read },
      "@/components/auth/ClerkSafe": {
        useUser: () => ({ user, isLoaded: true, isSignedIn: !!user }),
      },
      "@/integrations/supabase/client": {
        supabase: {
          auth: {
            onAuthStateChange(fn) {
              callback = fn;
              return { data: { subscription: { unsubscribe() {} } } };
            },
          },
        },
        getSupabaseClientConfigStatus: () => ({ configured }),
      },
    },
    { window, document, queueMicrotask },
  );
  const render = () => h.render(useTier);
  render();
  return {
    h,
    render,
    requests,
    change(next) {
      user = next;
      render();
      callback?.(next ? "SIGNED_IN" : "SIGNED_OUT");
    },
  };
}
