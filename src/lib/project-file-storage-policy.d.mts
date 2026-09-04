export const AGENT_EVIDENCE_BUCKET: "agent-evidence";
export const PROJECT_FILE_BUCKET: "project-files";

export type StorageReferenceRow = {
  id: string;
  project_id: string;
  uploaded_by: string;
  storage_path: string;
  kind?: string | null;
};

export type StorageReferenceAssociation = {
  promotion: {
    id: string;
    destination_id: string;
    destination_type: string;
    status: string;
    project_id: string;
    owner_id: string;
    deliverable_id: string;
  };
  deliverable: { id: string; owner_id: string; storage_reference: string };
};

export function validateStorageObjectPath(value: unknown): {
  path: string;
  parts: string[];
};
export function parseAgentStorageReference(value: unknown): {
  bucket: "agent-evidence" | "project-files";
  path: string;
  parts: string[];
};
export function resolveProjectFileStorage(
  row: StorageReferenceRow,
  association?: StorageReferenceAssociation | null,
): {
  id: string;
  bucket: "agent-evidence" | "project-files";
  path: string;
  source: "canonical" | "promoted";
  sourceProjectId: string | null;
  sourceOwnerId: string | null;
};
