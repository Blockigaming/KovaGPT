import type { DeveloperReferenceEntry } from "./developer-reference.mjs";

export function filterDeveloperReference(
  entries: DeveloperReferenceEntry[],
  query: string,
): DeveloperReferenceEntry[];
