import type { WorkflowSkillDraft, WorkflowSkillSelection } from "./workflow-skills-policy.mjs";

export function workflowSkillDigest(value: WorkflowSkillDraft): string;
export function buildWorkflowSkillBlock(value: unknown): WorkflowSkillSelection & {
  skillId: string;
  version: number;
  name: string;
  digest: string;
  block: string;
};
