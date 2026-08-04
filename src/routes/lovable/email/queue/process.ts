
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database, Json } from "@/integrations/supabase/types";
import { sendEmail } from "@/lib/email-provider.server";

const MAX_RETRIES = 5;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_SEND_DELAY_MS = 200;
const DEFAULT_AUTH_TTL_MINUTES = 15;
const DEFAULT_TRANSACTIONAL_TTL_MINUTES = 60;

type QueueMessage = {
  msg_id: number;
  read_ct?: number;
  enqueued_at?: string;
  message: EmailQueuePayload;
};

function isRateLimited(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    return (error as { status?: number }).status === 429;
  }
  return error instanceof Error && error.message.includes("429");
}

function isForbidden(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    return (error as { status?: number }).status === 403;
  }
  return error instanceof Error && error.message.includes("403");
}

function getRetryAfterSeconds(error: unknown): number {
  if (error && typeof error === "object" && "retryAfterSeconds" in error) {
    return (error as { retryAfterSeconds?: number | null }).retryAfterSeconds ?? 60;
  }
  return 60;
}

type EmailQueuePayload = {
  message_id?: string;
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
  label?: string;
  idempotency_key?: string;
  queued_at?: string;
  [key: string]: unknown;
};

async function moveToDlq(
  supabase: SupabaseClient<Database>,
  queue: string,
  msg: QueueMessage,
  reason: string,
): Promise<void> {
  const payload = msg.message;
  await supabase.from("email_send_log").insert({
    message_id: payload.message_id,
    template_name: (payload.label || queue) as string,
    recipient_email: payload.to,
    status: "dlq",
    error_message: reason,
  });
  const { error } = await supabase.rpc("move_to_dlq", {
    source_queue: queue,
    dlq_name: `${queue}_dlq`,
    message_id: msg.msg_id,
    payload: payload as unknown as Json,
  });
  if (error) {
    console.error("Failed to move message to DLQ", { queue, msg_id: msg.msg_id, reason, error });
  }
}



export const Route = createFileRoute("/lovable/email/queue/process")({
  server: {
    handlers: {
      POST: async ({ request }) => {

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !supabaseServiceKey) {
          console.error("Missing required email queue environment variables");
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }

        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.slice("Bearer ".length).trim();
        if (token !== supabaseServiceKey) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }

        const supabase: SupabaseClient<Database> = createClient(supabaseUrl, supabaseServiceKey);
        const { data: state } = await supabase
          .from("email_send_state")
          .select(
            "retry_after_until, batch_size, send_delay_ms, auth_email_ttl_minutes, transactional_email_ttl_minutes",
          )
          .single();

        if (state?.retry_after_until && new Date(state.retry_after_until) > new Date()) {
          return Response.json({ skipped: true, reason: "rate_limited" });
        }

        const batchSize = state?.batch_size ?? DEFAULT_BATCH_SIZE;
        const sendDelayMs = state?.send_delay_ms ?? DEFAULT_SEND_DELAY_MS;
        const ttlMinutes: Record<string, number> = {
          auth_emails: state?.auth_email_ttl_minutes ?? DEFAULT_AUTH_TTL_MINUTES,
          transactional_emails:
            state?.transactional_email_ttl_minutes ?? DEFAULT_TRANSACTIONAL_TTL_MINUTES,
        };
        let totalProcessed = 0;

        for (const queue of ["auth_emails", "transactional_emails"]) {
          const { data: messages, error: readError } = await supabase.rpc("read_email_batch", {
            queue_name: queue,
            batch_size: batchSize,
            vt: 30,
          });
          if (readError) {
            console.error("Failed to read email batch", { queue, error: readError });
            continue;
          }
          if (!messages?.length) continue;
          const queueMessages = messages as unknown as QueueMessage[];

          const failedAttemptsByMessageId = new Map<string, number>();
          const messageIds = Array.from(
            new Set(
              queueMessages
                .map((msg) =>
                  typeof msg?.message?.message_id === "string" ? msg.message.message_id : null,
                )
                .filter((id: string | null): id is string => Boolean(id)),
            ),
          );
          if (messageIds.length > 0) {
            const { data: failedRows } = await supabase
              .from("email_send_log")
              .select("message_id")
              .in("message_id", messageIds)
              .eq("status", "failed");
            for (const row of failedRows ?? []) {
              const messageId = row?.message_id;
              if (typeof messageId === "string" && messageId) {
                failedAttemptsByMessageId.set(
                  messageId,
                  (failedAttemptsByMessageId.get(messageId) ?? 0) + 1,
                );
              }
            }
          }

          for (let i = 0; i < queueMessages.length; i++) {
            const msg = queueMessages[i];
            const payload = msg.message;
            const failedAttempts =
              typeof payload.message_id === "string"
                ? (failedAttemptsByMessageId.get(payload.message_id) ?? 0)
                : (msg.read_ct ?? 0);
            const queuedAt = payload.queued_at ?? msg.enqueued_at;
            if (queuedAt) {
              const ageMs = Date.now() - new Date(queuedAt).getTime();
              const maxAgeMs = ttlMinutes[queue] * 60 * 1000;
              if (ageMs > maxAgeMs) {
                await moveToDlq(
                  supabase,
                  queue,
                  msg,
                  `TTL exceeded (${ttlMinutes[queue]} minutes)`,
                );
                continue;
              }
            }
            if (failedAttempts >= MAX_RETRIES) {
              await moveToDlq(
                supabase,
                queue,
                msg,
                `Max retries (${MAX_RETRIES}) exceeded (attempted ${failedAttempts} times)`,
              );
              continue;
            }

            if (payload.message_id) {
              const { data: alreadySent } = await supabase
                .from("email_send_log")
                .select("id")
                .eq("message_id", payload.message_id)
                .eq("status", "sent")
                .maybeSingle();
              if (alreadySent) {
                await supabase.rpc("delete_email", { queue_name: queue, message_id: msg.msg_id });
                continue;

        const apiKey = process.env['LOVABLE_API_KEY']
        const supabaseUrl = import.meta.env['VITE_SUPABASE_URL']
        const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']

        if (!apiKey || !supabaseUrl || !supabaseServiceKey) {
          console.error('Missing required environment variables')
          return Response.json(
            { error: 'Server configuration error' },
            { status: 500 }
          )
        }

        // Verify the caller is authorized with the service role key.
        // In the TanStack stack, the pg_cron job sends the service role key as a Bearer token.
        const authHeader = request.headers.get('Authorization')
        if (!authHeader?.startsWith('Bearer ')) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const token = authHeader.slice('Bearer '.length).trim()
        if (token !== supabaseServiceKey) {
          return Response.json({ error: 'Forbidden' }, { status: 403 })
        }

        const supabase: SupabaseClient<any, any> = createClient(supabaseUrl, supabaseServiceKey)

        // 1. Check rate-limit cooldown and read queue config
        const { data: state } = await supabase
          .from('email_send_state')
          .select('retry_after_until, batch_size, send_delay_ms, auth_email_ttl_minutes, transactional_email_ttl_minutes')
          .single()

        if (state?.retry_after_until && new Date(state.retry_after_until) > new Date()) {
          return Response.json({ skipped: true, reason: 'rate_limited' })
        }

        const batchSize = state?.batch_size ?? DEFAULT_BATCH_SIZE
        const sendDelayMs = state?.send_delay_ms ?? DEFAULT_SEND_DELAY_MS
        const ttlMinutes: Record<string, number> = {
          auth_emails: state?.auth_email_ttl_minutes ?? DEFAULT_AUTH_TTL_MINUTES,
          transactional_emails: state?.transactional_email_ttl_minutes ?? DEFAULT_TRANSACTIONAL_TTL_MINUTES,
        }

        let totalProcessed = 0

        // 2. Process auth_emails first (priority), then transactional_emails
        for (const queue of ['auth_emails', 'transactional_emails']) {
          const { data: messages, error: readError } = await supabase.rpc('read_email_batch', {
            queue_name: queue,
            batch_size: batchSize,
            vt: 30,
          })

          if (readError) {
            console.error('Failed to read email batch', { queue, error: readError })
            continue
          }

          if (!messages?.length) continue

          // Retry budget is based on real send failures, not pgmq read_ct.
          const messageIds = Array.from(
            new Set(
              messages
                .map((msg: any) =>
                  msg?.message?.message_id && typeof msg.message.message_id === 'string'
                    ? msg.message.message_id
                    : null
                )
                .filter((id: string | null): id is string => Boolean(id))
            )
          )
          const failedAttemptsByMessageId = new Map<string, number>()
          if (messageIds.length > 0) {
            const { data: failedRows, error: failedRowsError } = await supabase
              .from('email_send_log')
              .select('message_id')
              .in('message_id', messageIds)
              .eq('status', 'failed')

            if (failedRowsError) {
              console.error('Failed to load failed-attempt counters', {
                queue,
                error: failedRowsError,
              })
            } else {
              for (const row of failedRows ?? []) {
                const messageId = row?.message_id
                if (typeof messageId !== 'string' || !messageId) continue
                failedAttemptsByMessageId.set(
                  messageId,
                  (failedAttemptsByMessageId.get(messageId) ?? 0) + 1
                )
              }
            }
          }

          for (let i = 0; i < messages.length; i++) {
            const msg = messages[i]
            const payload = msg.message
            const failedAttempts =
              payload?.message_id && typeof payload.message_id === 'string'
                ? (failedAttemptsByMessageId.get(payload.message_id) ?? 0)
                : msg.read_ct ?? 0

            // Drop expired messages (TTL exceeded).
            // Prefer payload.queued_at when present; fall back to PGMQ's enqueued_at
            // which is always set by the queue.
            const queuedAt = payload.queued_at ?? msg.enqueued_at
            if (queuedAt) {
              const ageMs = Date.now() - new Date(queuedAt).getTime()
              const maxAgeMs = ttlMinutes[queue] * 60 * 1000
              if (ageMs > maxAgeMs) {
                console.warn('Email expired (TTL exceeded)', {
                  queue,
                  msg_id: msg.msg_id,
                  queued_at: queuedAt,
                  ttl_minutes: ttlMinutes[queue],
                })
                await moveToDlq(supabase, queue, msg, `TTL exceeded (${ttlMinutes[queue]} minutes)`)
                continue
              }
            }

            // Move to DLQ if max failed send attempts reached.
            if (failedAttempts >= MAX_RETRIES) {
              await moveToDlq(supabase, queue, msg, `Max retries (${MAX_RETRIES}) exceeded (attempted ${failedAttempts} times)`)
              continue
            }

            // Guard: skip if another worker already sent this message (VT expired race)
            if (payload.message_id) {
              const { data: alreadySent } = await supabase
                .from('email_send_log')
                .select('id')
                .eq('message_id', payload.message_id)
                .eq('status', 'sent')
                .maybeSingle()

              if (alreadySent) {
                console.warn('Skipping duplicate send (already sent)', {
                  queue,
                  msg_id: msg.msg_id,
                  message_id: payload.message_id,
                })
                const { error: dupDelError } = await supabase.rpc('delete_email', {
                  queue_name: queue,
                  message_id: msg.msg_id,
                })
                if (dupDelError) {
                  console.error('Failed to delete duplicate message from queue', { queue, msg_id: msg.msg_id, error: dupDelError })
                }
                continue

              }
            }

            try {

              await sendEmail({
                to: payload.to,
                from: payload.from,
                subject: payload.subject,
                html: payload.html,
                text: payload.text,
                idempotency_key: payload.idempotency_key,
              });
              await supabase.from("email_send_log").insert({
                message_id: payload.message_id,
                template_name: payload.label || queue,
                recipient_email: payload.to,
                status: "sent",
              });
              await supabase.rpc("delete_email", { queue_name: queue, message_id: msg.msg_id });
              totalProcessed++;
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              console.error("Email send failed", { queue, msg_id: msg.msg_id, error: errorMsg });
              if (isRateLimited(error)) {
                await supabase.from("email_send_log").insert({
                  message_id: payload.message_id,
                  template_name: payload.label || queue,
                  recipient_email: payload.to,
                  status: "failed",
                  error_message: errorMsg.slice(0, 1000),
                });
                await supabase
                  .from("email_send_state")
                  .update({
                    retry_after_until: new Date(
                      Date.now() + getRetryAfterSeconds(error) * 1000,
                    ).toISOString(),
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", 1);
                return Response.json({ processed: totalProcessed, stopped: "rate_limited" });
              }
              if (isForbidden(error)) {
                await moveToDlq(supabase, queue, msg, errorMsg.slice(0, 1000));
                return Response.json({ processed: totalProcessed, stopped: "forbidden" });
              }
              await supabase.from("email_send_log").insert({
                message_id: payload.message_id,
                template_name: payload.label || queue,
                recipient_email: payload.to,
                status: "failed",
                error_message: errorMsg.slice(0, 1000),
              });
              if (typeof payload.message_id === "string") {
                failedAttemptsByMessageId.set(payload.message_id, failedAttempts + 1);
              }
            }

            if (i < queueMessages.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, sendDelayMs));
            }
          }
        }

        return Response.json({ processed: totalProcessed });


      },
    },
  },
})
