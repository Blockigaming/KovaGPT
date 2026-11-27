export type ResourceAction = {
  label: string;
  method: "GET" | "POST" | "DELETE";
  fields: Record<string, unknown>;
  operation?: string;
};
export type ResourceSection = {
  label: string;
  description: string;
  actions: Record<string, ResourceAction>;
};
export type DeveloperResourceSection =
  | "agents"
  | "skills"
  | "conversations"
  | "vector-stores"
  | "batches"
  | "automations"
  | "webhooks";
export const developerResourceSections: Readonly<Record<DeveloperResourceSection, ResourceSection>>;
export function resourceConsoleTemplate(
  section: string,
  action: string,
  randomId: () => string,
): string;
export function resourceConsoleKey(value: unknown, allowed: string[]): string | null;
export function resourceConsoleRequest(
  section: string,
  action: string,
  raw: string,
): { method: "GET" | "POST" | "DELETE"; path: string; body?: string };
export function resourceConsoleRequiresConfirmation(section: string, action: string): boolean;
