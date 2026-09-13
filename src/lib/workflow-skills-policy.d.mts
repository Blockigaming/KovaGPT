export const WORKFLOW_SKILL_LIMITS: Readonly<{
  nameChars: number;
  descriptionChars: number;
  instructionChars: number;
  resourceCount: number;
  resourceTitleChars: number;
  resourceContentChars: number;
  totalBytes: number;
}>;

export type WorkflowSkillResource = { title: string; content: string };
export type WorkflowSkillDraft = {
  name: string;
  description: string;
  instructions: string;
  resources: WorkflowSkillResource[];
};
export type NormalizedWorkflowSkillDraft = WorkflowSkillDraft & {
  sizeBytes: number;
};
export type WorkflowSkillSelection = { installationId: string; versionId: string };
export type StoredWorkflowSkillSelection = WorkflowSkillSelection & { name: string };

export function normalizeWorkflowSkillDraft(value: unknown): NormalizedWorkflowSkillDraft;
export function normalizeWorkflowSkillSelection(
  value: unknown,
  options?: { includeName?: false },
): WorkflowSkillSelection;
export function normalizeWorkflowSkillSelection(
  value: unknown,
  options: { includeName: true },
): StoredWorkflowSkillSelection;
