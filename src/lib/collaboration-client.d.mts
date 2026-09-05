export class CollaborationError extends Error {
  code: string;
  constructor(code: string);
}
export function createCollaborationClient(input: {
  config: { url: string; publishableKey: string };
  getSession: () => Promise<{
    data: { session: { user: { id: string }; access_token: string } | null };
  }>;
  fetchImpl?: typeof fetch;
}): (
  actorId: string,
  operation: string,
  data: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<unknown>;
export function createCollaborationLifecycle(input: {
  refresh: (signal: AbortSignal) => Promise<void>;
  heartbeat: (sequence: number, signal: AbortSignal) => Promise<{ peers: number }>;
  leave: (sequence: number) => Promise<unknown>;
  subscribe: (invalidate: () => void, status: (state: string) => void) => () => void;
  onStatus: (state: "connected" | "reconnecting") => void;
  onPeers: (peers: number) => void;
  onDenied: () => void;
  schedule?: typeof setTimeout;
  unschedule?: typeof clearTimeout;
}): () => void;
export type CommentAnchor = {
  revision: number;
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
};
export function resolveCommentAnchor(
  content: string,
  anchor: CommentAnchor | null,
): { state: "document" | "removed" | "attached" | "moved"; start?: number; end?: number };

export function mergeCanvasComments<T extends { id: string; created_at: string }>(
  previous: T[],
  incoming: T[],
  deletedIds: string[],
): T[];

export function mergeCanvasSnapshot<
  T extends {
    document: { revision: number; comment_epoch?: number };
    comments: Array<{ id: string; created_at: string }>;
    deletedCommentIds: string[];
  },
>(previous: T | null, incoming: T): T;
