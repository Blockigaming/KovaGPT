declare module "@/lib/github-connector.mjs" {
  export class GitHubConnectorError extends Error {
    code: string;
    status: number;
    retryAfter?: number;
  }
  export class GitHubClient {
    constructor(options: any);
    rateLimit: any;
    assertRepo(repo: string): void;
    request(path: string, options?: any): Promise<any>;
    paginate(path: string, options?: any): Promise<any[]>;
    [key: string]: any;
  }
  export function verifyGitHubWebhook(input: {
    secret: string;
    signature: string;
    body: string;
  }): Promise<boolean>;
}
