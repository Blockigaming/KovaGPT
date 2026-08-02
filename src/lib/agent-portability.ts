import { z } from "zod";
import type { SavedAgent } from "./agent-definitions.functions";

export const MAX_AGENT_IMPORT_BYTES = 32_000;
export const PortableAgentSchema = z.object({
  format: z.literal("kovagpt-agent"),
  schemaVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  name: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(12_000),
  allowedTools: z.array(z.string().trim().min(1).max(80)).max(20),
  memoryEnabled: z.boolean(),
  sourceVersion: z.number().int().positive(),
});
export type PortableAgent = z.infer<typeof PortableAgentSchema>;

export function exportAgent(agent: SavedAgent): PortableAgent {
  return {
    format: "kovagpt-agent",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    name: agent.name,
    instructions: agent.instructions,
    allowedTools: agent.allowed_tools,
    memoryEnabled: agent.memory_enabled,
    sourceVersion: agent.version,
  };
}

export function parseAgentImport(text: string): PortableAgent {
  if (new TextEncoder().encode(text).byteLength > MAX_AGENT_IMPORT_BYTES)
    throw new Error("Agent files must be 32 KB or smaller.");
  return PortableAgentSchema.parse(JSON.parse(text));
}

export function safeAgentFilename(name: string) {
  const base = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "agent"}.kovagpt-agent.json`;
}
