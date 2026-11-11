export declare const NOTIFICATION_GROUPS: Readonly<Record<string, readonly string[]>>;
export declare const NOTIFICATION_IDS: readonly string[];
export type NotificationSurface = "modal" | "sheet" | "inline" | "status" | "toast" | "card" | "popover" | "banner";
export type NotificationDefinition = Readonly<{
  id: string;
  group: string;
  surface: NotificationSurface;
  priority: number;
  requiresEvidence: boolean;
  dismissible: boolean;
  exclusive: boolean;
  liveRegion: "assertive" | "polite";
}>;
export declare function notificationDefinition(id: string): NotificationDefinition | null;
export type NotificationQueueItem = {
  id: string;
  key?: string;
  confirmed?: boolean;
};
export declare function selectNotificationQueue<T extends NotificationQueueItem>(
  events: readonly T[] | null | undefined,
  opts?: { activeExclusive?: boolean; isComposing?: boolean },
): T[];
