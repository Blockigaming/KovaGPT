export type NotificationPreference = {
  ownerId: string;
  inApp: boolean;
  email: boolean;
  verifiedEmail?: string;
  quietHours?: { start: string; end: string; timeZone: string };
};
export type NotificationDelivery = {
  id: string;
  ownerId: string;
  channel: "in_app" | "email";
  status: "pending" | "sent" | "failed" | "retry" | "disabled";
  preview: string;
  createdAt: string;
  deliveredAt?: string;
  failure?: string;
};

export function notificationPreview(text: string) {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/token|secret|password|credential/gi, "[redacted]")
    .slice(0, 240);
}

export function canDeliverEmail(pref: NotificationPreference) {
  return Boolean(pref.email && pref.verifiedEmail && /@/.test(pref.verifiedEmail));
}

export function createDelivery(
  pref: NotificationPreference,
  channel: "in_app" | "email",
  preview: string,
): NotificationDelivery {
  if (channel === "email" && !canDeliverEmail(pref))
    return {
      id: `notice-${crypto.randomUUID()}`,
      ownerId: pref.ownerId,
      channel,
      status: "disabled",
      preview: notificationPreview(preview),
      createdAt: new Date().toISOString(),
      failure: "Email delivery requires a verified owner email.",
    };
  return {
    id: `notice-${crypto.randomUUID()}`,
    ownerId: pref.ownerId,
    channel,
    status: "pending",
    preview: notificationPreview(preview),
    createdAt: new Date().toISOString(),
  };
}
