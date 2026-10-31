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
  if (!messages.length || messages.length > 500 || messages.some((m) => m.content.length > 50000))
    throw new Error("Choose a chat with 1–500 text messages, each under 50,000 characters.");
  const payload = { title, snapshot: { messages } };
  if (new TextEncoder().encode(JSON.stringify(payload)).length > 500000)
    throw new Error("This chat is too long to share. Choose a shorter conversation.");
  return payload;
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
