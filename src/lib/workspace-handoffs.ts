import { safeBrowserStorage, writePrincipalHandoff } from "@/lib/principal-browser-storage.mjs";

export type WorkspaceHandoff = {
  type:
    | "chat"
    | "memory"
    | "file"
    | "library"
    | "project"
    | "artifact"
    | "image"
    | "research"
    | "prompt"
    | "work";
  id: string;
  title: string;
  content: string;
};

function writeHandoff(baseKey: string, userKey: string | null, payload: unknown): boolean {
  return writePrincipalHandoff(safeBrowserStorage("sessionStorage"), baseKey, userKey, payload).ok;
}

export function openInWork(item: WorkspaceHandoff, userKey: string | null) {
  const written = writeHandoff("kova-work-draft", userKey, {
    objective: `Continue working with ${item.title}`,
    context: `${item.type}: ${item.title}\n\n${item.content}`.slice(0, 24_000),
    plan: [
      "Review the source material",
      "Complete the requested work",
      "Review and record deliverables",
    ],
  });
  if (!written) return false;
  window.location.href = "/work";
  return true;
}

export function continueInResearch(item: WorkspaceHandoff, userKey: string | null) {
  const written = writeHandoff("kova-research-draft", userKey, {
    question: `Research and verify the key claims related to ${item.title}`,
    context: `${item.type}: ${item.title}\n\n${item.content}`.slice(0, 20_000),
  });
  if (!written) return false;
  window.location.href = "/research-planner";
  return true;
}

export function addToContextPack(item: WorkspaceHandoff, userKey: string | null) {
  return addManyToContextPack([item], userKey);
}

export function addManyToContextPack(items: WorkspaceHandoff[], userKey: string | null) {
  const unique = [...new Map(items.map((item) => [`${item.type}:${item.id}`, item])).values()];
  if (!writeHandoff("kova-context-candidates", userKey, unique.slice(0, 30))) return false;
  window.location.href = "/context-packs";
  return true;
}
