import type { Activity } from "@/lib/chat-store";
export type ReplySegment =
  { kind: "text"; text: string } | { kind: "group"; activities: Activity[]; at: number };
export function segmentReply(content: string, activities?: Activity[]): ReplySegment[] | null;
export function snapToParagraph(text: string, offset: number): number;
export function summarizeActivityGroup(activities?: Activity[]): string;
export function groupFailed(activities?: Activity[]): boolean;
