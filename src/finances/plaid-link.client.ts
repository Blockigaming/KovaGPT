export type PlaidHandler = { open: () => void; destroy: () => void };
export type PlaidSdk = {
  create: (options: {
    token: string;
    receivedRedirectUri?: string;
    onSuccess: (token: string) => void;
    onExit: (error: unknown) => void;
  }) => PlaidHandler;
};
declare global {
  interface Window {
    Plaid?: PlaidSdk;
  }
}
let pending: Promise<PlaidSdk> | null = null;

export function loadPlaidLink(): Promise<PlaidSdk> {
  if (window.Plaid?.create) return Promise.resolve(window.Plaid);
  if (pending) return pending;
  pending = new Promise<PlaidSdk>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    const cleanup = () => {
      window.clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
    };
    const failed = () => {
      cleanup();
      script.remove();
      reject(new Error("plaid_link_unavailable"));
    };
    const timer = window.setTimeout(failed, 15_000);
    script.onerror = failed;
    script.onload = () => {
      cleanup();
      if (window.Plaid?.create) resolve(window.Plaid);
      else failed();
    };
    document.head.appendChild(script);
  }).catch((error) => {
    pending = null;
    throw error;
  });
  return pending;
}
