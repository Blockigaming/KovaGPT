export function readBrowserCapacity(options: {
  projectId: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<number>;
