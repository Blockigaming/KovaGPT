export function publicShareSnapshot(conversation) {
  if (!conversation || conversation.temporary) throw new Error("Temporary chats cannot be shared.");
  const title =
    typeof conversation.title === "string"
      ? conversation.title.trim().slice(0, 200) || "Shared chat"
      : "Shared chat";
  const messages = Array.isArray(conversation.messages)
    ? conversation.messages
        .filter(
          (m) =>
            m &&
            ["user", "assistant"].includes(m.role) &&
            typeof m.content === "string" &&
            m.content.trim(),
        )
        .map(({ role, content }) => ({ role, content }))
    : [];
  if (!Array.isArray(conversation.messages)) throw new Error("Invalid share content.");
  return { title, snapshot: { messages } };
}
export const validShareToken = (value) =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
export async function shareTokenHash(value) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function createShareToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
