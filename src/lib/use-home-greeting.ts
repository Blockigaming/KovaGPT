import { useEffect, useState } from "react";
import { principalScopedStorageKey } from "@/lib/principal-browser-storage.mjs";

const greetings = [
  (name: string) => (name ? `Welcome back, ${name}!` : "Welcome back!"),
  (name: string) => (name ? `Ready to work, ${name}?` : "Ready when you are."),
  () => "What’s on your mind today?",
  () => "Let’s make something good.",
  (name: string) => (name ? `What’s next, ${name}?` : "What’s next?"),
  () => "A fresh start. What shall we do?",
  () => "Where should we pick up?",
  () => "Bring your next idea.",
];

export function useHomeGreeting(
  owner: string | null,
  firstName: string | null | undefined,
  chatId: string | null,
) {
  const name = (firstName ?? "")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim()
    .split(/\s/u)[0]
    .slice(0, 32);
  const [current, setCurrent] = useState({ owner: null as string | null, text: "Welcome back!" });
  useEffect(() => {
    if (!owner) return;
    let index = 0;
    const key = principalScopedStorageKey("kova-home-greeting-v1", owner);
    if (!key) return;
    try {
      const stored = Number(sessionStorage.getItem(key));
      index = Number.isSafeInteger(stored) && stored >= 0 ? stored % greetings.length : 0;
      sessionStorage.setItem(key, String(index + 1));
    } catch {
      /* Greeting rotation remains optional when browser storage is unavailable. */
    }
    setCurrent({ owner, text: greetings[index](name) });
  }, [owner, name, chatId]);
  return current.owner === owner ? current.text : "Welcome back!";
}
