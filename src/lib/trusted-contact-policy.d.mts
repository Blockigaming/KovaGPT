export const TRUSTED_CONTACT_POLICY_VERSION: string;
export type TrustedContactCommand =
  | { action: "invite"; id: string; recipientEmail: string; consent: true; policyVersion: string }
  | { action: "unblock"; otherId: string; blockId: string; revision: number }
  | {
      action: "review" | "decline" | "revoke" | "block" | "remove";
      id: string;
      commandId: string;
      revision: number;
    }
  | {
      action: "accept";
      id: string;
      commandId: string;
      revision: number;
      consent: true;
      token: string;
      policyVersion: string;
    };
export function parseTrustedContactCommand(value: unknown): TrustedContactCommand;
export function needsTrustedContactActivation(action: string): boolean;
export function deliverTrustedContactNotification(input: {
  enabled?: boolean;
  explicitUserAction?: boolean;
  invitation?: Record<string, unknown>;
  readCurrent?: (id: unknown) => Promise<Record<string, unknown> | null>;
  deliver?: (payload: Record<string, unknown>) => Promise<unknown>;
}): Promise<{ state: string }>;
