export function developerAnalysisFields(input: unknown): Record<string, unknown>;
export function validDeveloperAnalysisRequest(body: unknown): boolean;
export function analysisContainerReceipt(output: unknown): string | null;
export function validateDeveloperAnalysisResult(
  value: unknown,
  expectedModels: string[] | undefined,
  publicModel: string,
): Record<string, unknown>;
export function readDeveloperAnalysisResponse(
  response: Response,
  expectedModels: string[] | undefined,
  publicModel: string,
  dispose: (id: string) => Promise<void>,
): Promise<Record<string, unknown>>;
