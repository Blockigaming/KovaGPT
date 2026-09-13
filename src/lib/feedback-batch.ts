export type ResponseFeedbackRating = "up" | "down";
export type ResponseFeedbackBatchFetcher = (
  messageIds: string[],
) => Promise<Record<string, ResponseFeedbackRating>>;

const MAX_BATCH_SIZE = 200;

type PendingRequest = {
  resolve: (rating: ResponseFeedbackRating | null) => void;
  reject: (error: unknown) => void;
};

type PendingBatch = {
  fetcher: ResponseFeedbackBatchFetcher;
  requests: Map<string, PendingRequest[]>;
  scheduled: boolean;
};

const pendingByOwner = new Map<string, PendingBatch>();

async function flush(ownerId: string, batch: PendingBatch): Promise<void> {
  if (pendingByOwner.get(ownerId) === batch) pendingByOwner.delete(ownerId);
  const entries = [...batch.requests.entries()];
  for (let offset = 0; offset < entries.length; offset += MAX_BATCH_SIZE) {
    const chunk = entries.slice(offset, offset + MAX_BATCH_SIZE);
    try {
      const ratings = await batch.fetcher(chunk.map(([messageId]) => messageId));
      for (const [messageId, requests] of chunk) {
        const candidate = ratings[messageId];
        const rating = candidate === "up" || candidate === "down" ? candidate : null;
        for (const request of requests) request.resolve(rating);
      }
    } catch (error) {
      for (const [, requests] of chunk) {
        for (const request of requests) request.reject(error);
      }
    }
  }
}

export function loadResponseFeedbackBatched(
  ownerId: string,
  messageId: string,
  fetcher: ResponseFeedbackBatchFetcher,
): Promise<ResponseFeedbackRating | null> {
  let batch = pendingByOwner.get(ownerId);
  if (!batch) {
    batch = { fetcher, requests: new Map(), scheduled: false };
    pendingByOwner.set(ownerId, batch);
  }
  return new Promise((resolve, reject) => {
    const requests = batch.requests.get(messageId) ?? [];
    requests.push({ resolve, reject });
    batch.requests.set(messageId, requests);
    if (!batch.scheduled) {
      batch.scheduled = true;
      queueMicrotask(() => void flush(ownerId, batch));
    }
  });
}
