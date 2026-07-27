import type { PipelineDefinition } from "@/platform/omega";

export type AgentDefinition = {
  id: string;
  name: string;
  prompt: string;
  tools: string[];
  memory: boolean;
  fileIds: string[];
  contextPackIds: string[];
  projectId?: string;
  version: number;
  updatedAt: string;
};
export type EnterpriseDraft = {
  organizationName: string;
  defaultRole: "viewer" | "editor" | "admin";
  retentionDays: number;
  ssoDomain: string;
  scimEndpoint: string;
  policies: { externalSharing: boolean; connectorWrites: boolean };
};
export type McpDraft = {
  id: string;
  name: string;
  endpoint: string;
  version: string;
  capabilities: string[];
  permissions: string[];
  status: "unverified";
};

const scopedKey = (scope: string, name: string) => `kova-omega:${scope}:${name}`;
export function loadOmega<T>(scope: string, name: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(scopedKey(scope, name)) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function saveOmega<T>(scope: string, name: string, value: T) {
  localStorage.setItem(scopedKey(scope, name), JSON.stringify(value));
}
export const emptyPipeline = (): PipelineDefinition => ({
  id: crypto.randomUUID(),
  name: "Untitled pipeline",
  nodes: [
    { id: "input", type: "input", label: "Input" },
    { id: "output", type: "output", label: "Output" },
  ],
  edges: [{ from: "input", to: "output" }],
});
