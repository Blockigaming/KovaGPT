import type { ModeId } from "./modes";
export type KovaKnowledge =
  { kind: "library"; id: string } | { kind: "text"; title: string; content: string };
export type KovaConfig = {
  name: string;
  icon: string;
  description: string;
  instructions: string;
  starters: string[];
  mode: ModeId;
  tools: string[];
  apps: string[];
  knowledge: KovaKnowledge[];
  allowFork: boolean;
};
export type KovaReference = { id: string; versionId?: string };
export type KovaContext = {
  id: string;
  versionId: string;
  publicationEpoch: string;
  config: KovaConfig;
  knowledge: { title: string; content: string }[];
};
export const KOVA_LIMITS: {
  bodyBytes: number;
  versionBytes: number;
  knowledgeItems: number;
  knowledgeChars: number;
  versionCount: number;
  definitions: number;
};
export const KOVA_MODES: readonly ModeId[];
export const KOVA_TOOLS: readonly string[];
export const KOVA_APPS: readonly string[];
export function kovaId(value: unknown): string;
export function normalizeKovaConfig(value: unknown): KovaConfig;
export function normalizeKovaReference(value: unknown): KovaReference;
export function filterKovaTools<T>(tools: T[], context: KovaContext | null): T[];
export function kovaToolAllowed(context: KovaContext | null, tool: string): boolean;
export function formatKovaContext(context: KovaContext | null): string;

export function kovaAttachmentsAllowed(
  context: KovaContext | null,
  messages: { attachments?: unknown[] }[],
): boolean;
