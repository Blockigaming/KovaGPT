import { replaceControlCharacters } from "@/lib/sanitize-text";
export type ArtifactType =
  "document" | "report" | "table" | "chart" | "analysis_summary" | "code" | "image_collection";
export type ArtifactStatus = "draft" | "saving" | "saved" | "failed" | "archived";
export type ArtifactVersion = {
  version: number;
  content: string;
  createdAt: string;
  note?: string;
};
export type KovaArtifact = {
  id: string;
  ownerId: string;
  type: ArtifactType;
  title: string;
  content?: string;
  storagePath?: string;
  sourceChatId?: string;
  sourceProjectId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  status: ArtifactStatus;
  versions: ArtifactVersion[];
};
export function createArtifact(input: {
  ownerId: string;
  type: ArtifactType;
  title: string;
  content?: string;
  sourceChatId?: string;
  sourceProjectId?: string;
}): KovaArtifact {
  const now = new Date().toISOString();
  const content = input.content ?? "";
  return {
    id: `artifact-${crypto.randomUUID()}`,
    ownerId: input.ownerId,
    type: input.type,
    title: sanitizeArtifactTitle(input.title),
    content,
    sourceChatId: input.sourceChatId,
    sourceProjectId: input.sourceProjectId,
    createdAt: now,
    updatedAt: now,
    version: 1,
    status: "draft",
    versions: [{ version: 1, content, createdAt: now, note: "Initial version" }],
  };
}
export function sanitizeArtifactTitle(title: string): string {
  return (
    replaceControlCharacters(title)
      .replace(/[/\\?%*:|"<>]/g, "")
      .trim()
      .slice(0, 160) || "Untitled artifact"
  );
}
export function saveArtifactVersion(
  artifact: KovaArtifact,
  content: string,
  note?: string,
): KovaArtifact {
  const now = new Date().toISOString();
  const nextVersion = artifact.version + 1;
  return {
    ...artifact,
    content,
    updatedAt: now,
    version: nextVersion,
    status: "saved",
    versions: [...artifact.versions, { version: nextVersion, content, createdAt: now, note }],
  };
}
export function restoreArtifactVersion(artifact: KovaArtifact, version: number): KovaArtifact {
  const found = artifact.versions.find((entry) => entry.version === version);
  if (!found) return { ...artifact, status: "failed" };
  return saveArtifactVersion(artifact, found.content, `Restored version ${version}`);
}
export function artifactDownload(artifact: KovaArtifact) {
  const ext =
    artifact.type === "chart" || artifact.type === "table"
      ? "json"
      : artifact.type === "code"
        ? "txt"
        : "md";
  const mimeType =
    ext === "json" ? "application/json" : ext === "md" ? "text/markdown" : "text/plain";
  return {
    filename: `${sanitizeArtifactTitle(artifact.title).toLowerCase().replace(/\s+/g, "-")}.${ext}`,
    mimeType,
    content: artifact.content ?? "",
  };
}
