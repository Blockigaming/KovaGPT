export function approvedMcpServers(source?: string): ReadonlyMap<
  string,
  {
    url: string;
    tool: string;
    queryField: string;
    fingerprint: string;
    write: { tool: string; field: string; fingerprint: string } | null;
  }
>;
