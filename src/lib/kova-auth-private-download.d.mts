export type PrivateFileKind = "project" | "deliverable" | "evidence" | "export";
export type PrivateFileDescriptor = {
  kind: PrivateFileKind;
  id: string;
  owner: string;
  status: string | null;
  bucket: string;
  path: string;
  name: string;
  mime: string | null;
  size: number | null;
  sha256: string | null;
  maxBytes: number;
  image: boolean;
  scope: string;
  revision: number | null;
  expiresAt: string | null;
};
export const PRIVATE_PROJECT_COLUMNS: "id,project_id,name,storage_path,mime_type,size_bytes,kind,status,content_sha256";
export const PRIVATE_DELIVERABLE_COLUMNS: "id,owner_id,title,storage_reference,mime_type,status,revision,integrity_hash";
export const PRIVATE_EXPORT_COLUMNS: "id,user_id,status,expires_at,size_bytes,storage_path";
export const PRIVATE_EVIDENCE_COLUMNS: "id,job_id,event_type,payload";
export function validPrivateResourceId(kind: string, id: unknown): boolean;
export function privateFileDescriptor(
  kind: PrivateFileKind,
  owner: string,
  row: unknown,
  now?: number,
): PrivateFileDescriptor;
export function privateFileVersion(descriptor: PrivateFileDescriptor): Promise<string>;
export function ownedPrivateFileLink(
  kind: PrivateFileKind,
  owner: string,
  row: unknown,
): Promise<string>;
