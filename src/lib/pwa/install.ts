type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
let pending: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
export function watchInstallPrompt() {
  const beforeInstall = (event: Event) => {
    event.preventDefault();
    pending = event as InstallPrompt;
    emit();
  };
  const installed = () => {
    pending = null;
    emit();
  };
  window.addEventListener("beforeinstallprompt", beforeInstall);
  window.addEventListener("appinstalled", installed);
  return () => {
    window.removeEventListener("beforeinstallprompt", beforeInstall);
    window.removeEventListener("appinstalled", installed);
  };
}
export const canPromptInstall = () => pending !== null;
export const noServerPrompt = () => false;
export function subscribeInstallPrompt(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export async function promptPwaInstall() {
  const event = pending;
  if (!event) return;
  pending = null;
  emit();
  await event.prompt();
  await event.userChoice;
}
