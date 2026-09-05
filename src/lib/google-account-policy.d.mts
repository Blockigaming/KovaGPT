export type GoogleCapability =
  "gmail.read" | "gmail.write" | "gmail.draft" | "calendar.read" | "calendar.write" | "drive.read";
export type GoogleAccountBinding = {
  connectionId?: string;
  grantId?: string;
  expectedGoogleSub?: string;
  capability?: GoogleCapability;
};
export type GoogleAccountHealth = {
  id?: string;
  connectionRevision?: number;
  email?: string | null;
  connected: boolean;
  state:
    | "connected"
    | "disconnected"
    | "reauthorization_required"
    | "permission_incomplete"
    | "temporarily_unavailable";
  scopes: string[];
  has: {
    gmail: boolean;
    gmailWrite: boolean;
    calendar: boolean;
    calendarWrite: boolean;
    drive: boolean;
  };
};
export const GOOGLE_CAPABILITY_SCOPES: Record<GoogleCapability, string[]>;
export function hasGoogleCapability(
  scopes: string | string[],
  capability: GoogleCapability,
): boolean;
export function parseGoogleBinding(value: unknown): GoogleAccountBinding;
export function googleConnectionHealth(
  connection: {
    id: string;
    credential_revision: number;
    email: string | null;
    google_sub: string | null;
    scopes: string;
    expires_at: string;
    reauthorization_required: boolean;
    has_refresh_token: boolean;
  } | null,
  now?: number,
): GoogleAccountHealth;
export function googleToolCapability(name: string): GoogleCapability;
