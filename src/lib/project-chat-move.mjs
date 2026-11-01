/** A project copy is already durable before this runs. Preserve a recoverable
 * original, and never remove a chat edited during that copy or after an account switch. */
export async function completeProjectChatMove({ source, isCurrent, readActive, archive, remove }) {
  const unchanged = (chat) =>
    chat &&
    chat.id === source.id &&
    chat.updatedAt === source.updatedAt &&
    JSON.stringify(chat.messages) === JSON.stringify(source.messages);
  if (!isCurrent()) return false;
  const current = readActive().find((chat) => chat.id === source.id);
  if (!unchanged(current)) return false;
  if (!(await archive(current)) || !isCurrent()) return false;
  const latest = readActive();
  const active = latest.find((chat) => chat.id === source.id);
  if (active && !unchanged(active)) return false;
  if (!isCurrent()) return false;
  return Boolean(await remove(latest.filter((chat) => chat.id !== source.id)));
}
