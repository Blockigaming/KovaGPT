export function parseWorkflowSkillMutationResult(value: unknown): { ok: true };
export function parseWorkflowSkillDetailResult(value: unknown): {
  id: string;
  revision: number;
  headVersionId: string;
  version: number;
  name: string;
  description: string;
  instructions: string;
  resources: Array<{ title: string; content: string }>;
  versions: Array<{
    id: string;
    version: number;
    name: string;
    digest: string;
    created_at: string;
  }>;
  digest: string;
  installationId: string | null;
  installedVersionId: string | null;
  installedVersion: number | null;
  installedName: string | null;
  created_at: string;
  updated_at: string;
};
