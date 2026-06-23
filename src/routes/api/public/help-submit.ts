import * as React from 'react'
import { render } from '@react-email/components'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { TEMPLATES } from '@/lib/email-templates/registry'
import type { Database } from '@/integrations/supabase/types'

const SITE_NAME = 'KovaGPT'
const SENDER_DOMAIN = 'notify.kovagpt.com'
const FROM_DOMAIN = 'kovagpt.com'
const SUPPORT_INBOX = 'help@kovagpt.com'

const BodySchema = z.object({
  name: z.string().trim().max(120).optional().default(''),
  email: z.string().trim().email().max(254),
  topic: z.string().trim().max(200).optional().default(''),
  message: z.string().trim().min(1).max(4000),
  variant: z.enum(['help', 'bug']).optional().default('help'),
  url: z.string().trim().max(500).optional().default(''),
  userAgent: z.string().trim().max(500).optional().default(''),
  // Honeypot — bots fill hidden fields; humans don't.
  website: z.string().max(0).optional().default(''),
})

function randomToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function enqueue(args: {
  supabase: SupabaseClient<Database>
  templateName: string
  to: string
  data: Record<string, unknown>
  idempotencyKey: string
}) {
  const entry = TEMPLATES[args.templateName]
  if (!entry) throw new Error(`Unknown template ${args.templateName}`)
  const element = React.createElement(entry.component, args.data)
  const html = await render(element)
  const plainText = await render(element, { plainText: true })
  const subject =
    typeof entry.subject === 'function' ? entry.subject(args.data) : entry.subject
  const recipient = (entry.to ?? args.to).toLowerCase()
  const messageId = randomToken()
  await args.supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: args.templateName,
    recipient_email: recipient,
    status: 'pending',
  })
  const { error } = await args.supabase.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      to: recipient,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject,
      html,
      text: plainText,
      purpose: 'transactional',
      label: args.templateName,
      idempotency_key: args.idempotencyKey,
      queued_at: new Date().toISOString(),
    },
  })
  if (error) throw new Error(error.message)
}

export const Route = createFileRoute('/api/public/help-submit')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !supabaseServiceKey) {
          return Response.json({ error: 'Server not configured' }, { status: 500 })
        }

        let raw: unknown
        try {
          raw = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON' }, { status: 400 })
        }
        const parsed = BodySchema.safeParse(raw)
        if (!parsed.success) {
          return Response.json({ error: 'Please fill in all required fields.' }, { status: 400 })
        }
        const body = parsed.data
        if (body.website) {
          // Honeypot tripped — pretend success so bots don't probe.
          return Response.json({ success: true })
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        const idem = randomToken()

        try {
          // 1) Notify support inbox
          await enqueue({
            supabase,
            templateName: 'help-contact-notification',
            to: SUPPORT_INBOX,
            data: body,
            idempotencyKey: `help-notify-${idem}`,
          })
          // 2) Auto-reply to the user
          await enqueue({
            supabase,
            templateName: 'help-contact-autoreply',
            to: body.email,
            data: { name: body.name, topic: body.topic, variant: body.variant },
            idempotencyKey: `help-autoreply-${idem}`,
          })
        } catch (err) {
          console.error('help-submit enqueue failed', err)
          return Response.json(
            { error: "We couldn't send your message. Please try again in a moment." },
            { status: 500 },
          )
        }

        return Response.json({ success: true })
      },
    },
  },
})
