export type MemoryCategory =
  | "preference"
  | "personal_context"
  | "project_fact"
  | "communication_preference"
  | "long_term_goal"
  | "other";

export type KovaMemory = {
  id: string;
  userId: string;
  content: string;
  category: MemoryCategory;
  projectId?: string | null;
  updatedAt?: string;
};

export type MemoryPolicy = {
  enabled: boolean;
  temporary: boolean;
  projectId?: string;
  maxItems?: number;
};

export function normalizeMemoryText(text: string): string {
  return text
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function shouldReadMemory(policy: MemoryPolicy): boolean {
  return policy.enabled && !policy.temporary;
}

export function shouldWriteMemory(policy: MemoryPolicy): boolean {
  return policy.enabled && !policy.temporary;
}

export function dedupeMemories(memories: KovaMemory[]): KovaMemory[] {
  const seen = new Set<string>();
  const output: KovaMemory[] = [];
  for (const memory of memories) {
    const key = `${memory.projectId ?? "global"}:${normalizeMemoryText(memory.content).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(memory);
  }
  return output;
}

export function selectRelevantMemories(
  memories: KovaMemory[],
  query: string,
  policy: MemoryPolicy,
): KovaMemory[] {
  if (!shouldReadMemory(policy)) return [];
  const normalizedQuery = normalizeMemoryText(query).toLowerCase();
  const tokens = new Set(normalizedQuery.split(/\W+/).filter((token) => token.length > 3));
  const scoped = memories.filter(
    (memory) => !memory.projectId || memory.projectId === policy.projectId,
  );
  return dedupeMemories(scoped)
    .map((memory) => {
      const content = normalizeMemoryText(memory.content).toLowerCase();
      const score = [...tokens].reduce((n, token) => n + (content.includes(token) ? 1 : 0), 0);
      return { memory, score };
    })
    .filter((item) => item.score > 0 || item.memory.category === "communication_preference")
    .sort((a, b) => b.score - a.score)
    .slice(0, policy.maxItems ?? 8)
    .map((item) => item.memory);
}

export function formatMemoryBlock(memories: KovaMemory[]): string {
  if (!memories.length) return "";
  const lines = memories.map(
    (memory, index) => `${index + 1}. (${memory.category}) ${normalizeMemoryText(memory.content)}`,
  );
  return `\n\n--- MEMORY USED ---\n${lines.join("\n")}\n--- END MEMORY. Use only when relevant and never quote private memory verbatim. ---`;
}
