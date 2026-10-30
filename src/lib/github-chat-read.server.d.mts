import type { ToolDef } from "./google-tools.server";
export type GitHubChatContext = {
  ownerId: string;
  repositories: {
    id: number;
    accountId: string;
    installationId: number;
    name: string;
    repositoryVersion: string;
    accountVersion: string;
    installationVersion: string;
  }[];
  tools: ToolDef[];
};
export function githubChatRequest(repository: string, args: Record<string, unknown>): string;
export function readGitHubChat(
  repository: string,
  args: Record<string, unknown>,
  token: string,
  fetchImpl?: typeof fetch,
): Promise<Record<string, unknown>>;
export function createGitHubChatTools(dependencies: {
  db: unknown;
  guard: (ownerId: string) => Promise<void>;
  rate: (ownerId: string) => Promise<boolean>;
  decrypt: (value: string) => Promise<string>;
  configured: () => boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): {
  getContext: (ownerId: string) => Promise<GitHubChatContext>;
  run: (
    ownerId: string,
    name: string,
    args: Record<string, unknown>,
    context: GitHubChatContext,
  ) => Promise<Record<string, unknown>>;
};
