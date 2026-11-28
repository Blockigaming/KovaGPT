export function verifyTanaRead(
  token: string,
  fetchImpl?: typeof fetch,
  beforeRequest?: () => Promise<void>,
): Promise<void>;
export function tanaProposalSchema(
  token: string,
  fetchImpl?: typeof fetch,
  beforeRequest?: () => Promise<void>,
): Promise<string>;
export function runTanaProposal(
  token: string,
  argumentsJson: string,
  fetchImpl?: typeof fetch,
  beforeRequest?: () => Promise<void>,
): Promise<string | null>;
export function runReviewedMcpWrite(
  credential: string,
  operation: string,
  text: string,
  beforeRequest: () => Promise<void>,
  transport?: typeof fetch,
): Promise<boolean>;
export function readMcpConnection(
  id: string,
  query: string,
  credential: string,
  fetchImpl?: typeof fetch,
  beforeRequest?: () => Promise<void>,
  customTransport?: typeof fetch,
  parentSignal?: AbortSignal,
): Promise<{
  service: string;
  results: { id: string; title: string; snippet: string; url: string | null }[];
  limited: boolean;
}>;
