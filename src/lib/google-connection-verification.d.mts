export type GoogleReadProbeApi = {
  gmailSearch: (
    query: string,
    maxResults: number,
    connectionId: string,
  ) => Promise<{ messages: unknown[] }>;
  calendarList: (options: {
    maxResults: number;
    connectionId: string;
  }) => Promise<{ events: unknown[] }>;
  driveSearch: (
    query: string,
    maxResults: number,
    connectionId: string,
  ) => Promise<{ files: unknown[] }>;
};

export function verifyGoogleServiceRead(
  id: string,
  connectionId: string,
  api: GoogleReadProbeApi,
): Promise<{ service: string; verified: true }>;
