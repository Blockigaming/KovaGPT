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
