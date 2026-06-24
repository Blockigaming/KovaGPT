import type { ComponentType } from 'react'
import { template as helpContactNotification } from './help-contact-notification'
import { template as helpContactAutoreply } from './help-contact-autoreply'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient - overrides caller-provided recipientEmail when set. */
  to?: string
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  'help-contact-notification': helpContactNotification,
  'help-contact-autoreply': helpContactAutoreply,
}
