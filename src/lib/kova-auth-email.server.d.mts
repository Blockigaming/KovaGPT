export type KovaAuthEmailLabel = "kova-auth-verification" | "kova-auth-recovery";
export function renderKovaAuthEmail(input: {
  label: KovaAuthEmailLabel;
  recipient: string;
  link: string;
  publicOrigin: string;
  issuedAt: string;
  expiresAt: string;
}): { subject: string; html: string; text: string };
