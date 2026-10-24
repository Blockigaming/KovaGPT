export type TwilioSmsConfiguration = Readonly<{
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  messagingServiceSid: string;
}>;

export type TwilioSmsConfigurationSummary = Readonly<{
  provider: "twilio";
  sendEnabled: boolean;
  configurationValid: boolean;
  authentication: "api_key";
  transport: "programmable_messaging";
  singleSegmentBody: true;
}>;

export type TwilioSmsResult =
  | {
      outcome: "disabled";
      reason: "sending_disabled";
      deliveryVerified: false;
    }
  | {
      outcome: "rejected";
      reason:
        | "invalid_input"
        | "invalid_recipient"
        | "invalid_body"
        | "rate_limited"
        | "provider_rejected";
      deliveryVerified: false;
    }
  | {
      outcome: "uncertain";
      reason: "redirect_rejected" | "unexpected_response" | "timeout" | "transport_uncertain";
      deliveryVerified: false;
    }
  | {
      outcome: "accepted";
      messageId: string;
      status: "accepted" | "queued" | "sending" | "sent" | "delivered";
      deliveryVerified: false;
    };

export function loadTwilioSmsConfiguration(
  env?: Record<string, string | undefined>,
): TwilioSmsConfiguration | null;

export function summarizeTwilioSmsConfiguration(
  config: TwilioSmsConfiguration | null,
): TwilioSmsConfigurationSummary;

export function createTwilioSmsSender(
  config: TwilioSmsConfiguration | null,
  options?: { fetcher?: typeof fetch; timeoutMs?: number },
): (input: { to: string; body: string }) => Promise<TwilioSmsResult>;
