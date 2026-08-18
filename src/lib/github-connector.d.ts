declare module "@/lib/github-connector.mjs" {
  export type GitHubJson =
    null | boolean | number | string | GitHubJson[] | { [key: string]: GitHubJson };
  export type GitHubFetch = typeof fetch;
  export type GitHubClientOptions = {
    token: string;
    allowedRepositories: string[];
    fetchImpl?: GitHubFetch;
    apiBase?: string;
  };
  export class GitHubConnectorError extends Error {
    code: string;
    status: number;
    retryAfter?: number;
  }
  export class GitHubClient {
    constructor(options: GitHubClientOptions);
    rateLimit: { limit: number; remaining: number; reset: number } | null;
    assertRepo(repo: string): void;
    request(
      path: string,
      options?: {
        method?: string;
        body?: GitHubJson;
        confirm?: boolean;
        repo?: string;
      },
    ): Promise<GitHubJson>;
    paginate(
      path: string,
      options?: { method?: string; body?: GitHubJson; confirm?: boolean; repo?: string },
    ): Promise<GitHubJson[]>;
    file(repo: string, path: string, ref?: string): Promise<GitHubJson>;
    tree(repo: string, ref?: string, recursive?: boolean): Promise<GitHubJson>;
    branches(repo: string): Promise<GitHubJson[]>;
    commits(repo: string): Promise<GitHubJson[]>;
    issues(repo: string, state?: string): Promise<GitHubJson[]>;
    pulls(repo: string, state?: string): Promise<GitHubJson[]>;
    releases(repo: string): Promise<GitHubJson[]>;
    workflows(repo: string): Promise<GitHubJson[]>;
    workflowRuns(repo: string): Promise<GitHubJson[]>;
    checks(repo: string, ref: string): Promise<GitHubJson[]>;
    discussions(repo: string): Promise<GitHubJson>;
    searchCode(repo: string, query: string): Promise<GitHubJson[]>;
    createIssue(repo: string, input: GitHubJson, confirm: boolean): Promise<GitHubJson>;
    commentIssue(repo: string, number: number, body: string, confirm: boolean): Promise<GitHubJson>;
    createBranch(repo: string, name: string, sha: string, confirm: boolean): Promise<GitHubJson>;
    openPull(repo: string, input: GitHubJson, confirm: boolean): Promise<GitHubJson>;
    requestReview(
      repo: string,
      number: number,
      reviewers: string[],
      confirm: boolean,
    ): Promise<GitHubJson>;
    mergePull(
      repo: string,
      number: number,
      input: GitHubJson,
      confirm: boolean,
    ): Promise<GitHubJson>;
    proposePatch(repo: string, input: GitHubJson, confirm: boolean): Promise<GitHubJson>;
  }
  export function verifyGitHubWebhook(input: {
    secret: string;
    signature: string;
    body: string;
  }): Promise<boolean>;
}
