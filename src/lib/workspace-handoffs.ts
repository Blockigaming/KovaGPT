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

export function openInWork(item: WorkspaceHandoff) {
  localStorage.setItem(
    "kova-work-draft",
    JSON.stringify({
      objective: `Continue working with ${item.title}`,
      context: `${item.type}: ${item.title}\n\n${item.content}`.slice(0, 24_000),
      plan: [
        "Review the source material",
        "Complete the requested work",
        "Review and record deliverables",
      ],
    }),
  );
  window.location.href = "/work";
}

export function continueInResearch(item: WorkspaceHandoff) {
  localStorage.setItem(
    "kova-research-draft",
    JSON.stringify({
      question: `Research and verify the key claims related to ${item.title}`,
      context: `${item.type}: ${item.title}\n\n${item.content}`.slice(0, 20_000),
    }),
  );
  window.location.href = "/research-planner";
}

export function addToContextPack(item: WorkspaceHandoff) {
  addManyToContextPack([item]);
}

export function addManyToContextPack(items: WorkspaceHandoff[]) {
  const unique = [...new Map(items.map((item) => [`${item.type}:${item.id}`, item])).values()];
  sessionStorage.setItem("kova-context-candidates", JSON.stringify(unique.slice(0, 30)));
  window.location.href = "/context-packs";
}
