import type { Message } from "@/lib/chat-store";

export type OutlineSection = { id: string; label: string; role: Message["role"] };

export function deriveConversationOutline(messages: Message[]): OutlineSection[] {
  return messages.reduce<OutlineSection[]>((sections, message) => {
    if (message.role === "user") {
      const label = message.content.trim().replace(/\s+/g, " ").slice(0, 72);
      if (label) sections.push({ id: message.id, label, role: message.role });
      return sections;
    }
    const heading = message.content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
    if (heading) sections.push({ id: message.id, label: heading.slice(0, 72), role: message.role });
    return sections;
  }, []);
}
