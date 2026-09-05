import type { BrowserCommand } from "./work-browser-transport.mjs";
export type BrowserOwnerInput = Omit<
  BrowserCommand,
  "actor" | "ownerId" | "sequence" | "expiresAt"
> & { expectedUserId: string; expectedRevision: number; expectedSequence: number };
export function parseBrowserOwnerInput(value: unknown): BrowserOwnerInput;
