export type LaunchAccountMetadata = {
  id: string;
  label: string;
  identity: string;
  status: string;
  scopes: string[];
  expiresAt: string | null;
  lastSuccessAt: string | null;
};
export type LaunchManagement = {
  connector: string;
  certified: boolean;
  accounts: LaunchAccountMetadata[];
  nextCursor: string | null;
};
export function readLaunchManagement(input: {
  db: unknown;
  ownerId: string;
  connector: string;
  cursor?: string | null;
  signal?: AbortSignal;
}): Promise<LaunchManagement>;
