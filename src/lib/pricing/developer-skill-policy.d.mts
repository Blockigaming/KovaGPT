export type DeveloperSkillReference = { id: string; version: number };
export function parseDeveloperSkillRequest(
  method: string,
  params: URLSearchParams,
  body?: unknown,
): { operation: string; input: Record<string, unknown> };
export function parseDeveloperSkillReferences(value: unknown): DeveloperSkillReference[];
export function expandDeveloperSkills(
  instructions: string,
  refs: DeveloperSkillReference[],
  saved: unknown[],
): {
  instructions: string;
  bindings: { id: string; version: number; createdAt: string }[];
};
