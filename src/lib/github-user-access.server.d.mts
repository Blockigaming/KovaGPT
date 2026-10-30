export type GitHubUserRepository = {
  id: number;
  full_name: string;
  visibility: "public" | "private" | "internal";
  default_branch: string;
  archived: boolean;
  permissions: Record<string, boolean>;
  owner?: { login?: string };
};
export type GitHubUserInstallation = {
  id: number;
  account: { id: number; login: string; type: "User" | "Organization" };
  repository_selection: "all" | "selected";
  permissions: Record<string, string>;
  events: string[];
  suspended_at: string | null;
};
export function discoverGitHubUserRepositories(
  token: string,
  githubUserId: number,
  fetchImpl?: typeof fetch,
  operationSignal?: AbortSignal,
): Promise<Array<{ installation: GitHubUserInstallation; repositories: GitHubUserRepository[] }>>;
