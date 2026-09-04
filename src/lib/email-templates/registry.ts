import type { ComponentType } from "react";
import { template as helpContactNotification } from "./help-contact-notification";
import { template as helpContactAutoreply } from "./help-contact-autoreply";
import { template as projectInvite } from "./project-invite";
import { template as sharedChat } from "./shared-chat";

export type TemplateData = Record<string, unknown>;

export interface TemplateEntry {
  component: ComponentType<TemplateData>;
  subject: string | ((data: TemplateData) => string);
  displayName?: string;
  previewData?: TemplateData;
  /** Fixed recipient - overrides caller-provided recipientEmail when set. */
  to?: string;
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  "help-contact-notification": helpContactNotification,
  "help-contact-autoreply": helpContactAutoreply,
  "project-invite": projectInvite,
  "shared-chat": sharedChat,
};
