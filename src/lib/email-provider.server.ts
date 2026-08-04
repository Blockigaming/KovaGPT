export type EmailPayload = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
  idempotency_key?: string;
};

export class EmailProviderError extends Error {
  status?: number;
  retryAfterSeconds?: number | null;

  constructor(
    message: string,
    options: { status?: number; retryAfterSeconds?: number | null } = {},
  ) {
    super(message);
    this.name = "EmailProviderError";
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

function retryAfterSeconds(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
  return null;
}

async function sendWithResend(payload: EmailPayload, apiKey: string): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(payload.idempotency_key ? { "Idempotency-Key": payload.idempotency_key } : {}),
    },
    body: JSON.stringify({
      from: payload.from,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    }),
  });

  if (!response.ok) {
    throw new EmailProviderError(`Resend email send failed with HTTP ${response.status}`, {
      status: response.status,
      retryAfterSeconds: retryAfterSeconds(response.headers.get("retry-after")),
    });
  }
}

async function sendWithWebhook(payload: EmailPayload, url: string): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.KOVA_EMAIL_SEND_TOKEN
        ? { Authorization: `Bearer ${process.env.KOVA_EMAIL_SEND_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new EmailProviderError(`Email webhook send failed with HTTP ${response.status}`, {
      status: response.status,
      retryAfterSeconds: retryAfterSeconds(response.headers.get("retry-after")),
    });
  }
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (process.env.RESEND_API_KEY) {
    await sendWithResend(payload, process.env.RESEND_API_KEY);
    return;
  }

  if (process.env.KOVA_EMAIL_SEND_URL) {
    await sendWithWebhook(payload, process.env.KOVA_EMAIL_SEND_URL);
    return;
  }

  throw new EmailProviderError("No email provider is configured", { status: 503 });
}
