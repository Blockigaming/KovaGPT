export type RevisionChunk = { kind: "unchanged" | "change"; before: string; after: string };
export function resultRevisionDiff(before: string, after: string): RevisionChunk[];
export function applyReviewedDiff(chunks: RevisionChunk[], rejected?: number[]): string;
