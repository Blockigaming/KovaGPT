export const PROJECT_TEMPLATE_MAX_BODY_BYTES: number;
export const PROJECT_TEMPLATE_MAX_SNAPSHOT_BYTES: number;
export const PROJECT_TEMPLATE_MAX_RESULTS: number;

export class ProjectTemplateInputError extends Error {
  code: string;
}

export type ProjectTemplateSnapshot = {
  projectName: string;
  projectDescription: string | null;
  systemPrompt: string | null;
  color: string;
};

export type ProjectTemplateMutation =
  | {
      action: "create";
      mutationId: string;
      name: string;
      description: string | null;
      snapshot: ProjectTemplateSnapshot;
    }
  | {
      action: "publishVersion";
      mutationId: string;
      templateId: string;
      expectedRevision: number;
      snapshot: ProjectTemplateSnapshot;
    }
  | {
      action: "share";
      mutationId: string;
      templateId: string;
      expectedRevision: number;
      granteeUserId: string;
      canCopy: boolean;
    }
  | {
      action: "revoke";
      mutationId: string;
      templateId: string;
      expectedRevision: number;
      granteeUserId: string;
    }
  | {
      action: "archive";
      mutationId: string;
      templateId: string;
      expectedRevision: number;
    }
  | {
      action: "copy";
      mutationId: string;
      templateId: string;
      version: number | null;
    };

export function parseProjectTemplateMutation(value: unknown): ProjectTemplateMutation;
export function parseProjectTemplateQuery(urlValue: URL | string): {
  templateId: string | null;
  after: string | null;
  version: number | null;
  limit: number;
};
export function projectTemplateErrorStatus(code?: string | null): number;
