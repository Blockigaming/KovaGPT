export function developerDecisionFields(input: unknown): {
  input: string;
  questions: Record<string, unknown>[];
  prompt_cache_options: { mode: "explicit" };
};
export function validDeveloperDecisionRequest(body: unknown): boolean;
export function developerDecisionUsage(usage: unknown): { decision_input_tokens: number } | null;
export function validateDeveloperDecisionResult(
  value: unknown,
  questions: Record<string, unknown>[],
  expectedModels: string[] | undefined,
  publicModel: string,
): Record<string, unknown>;
export function readDeveloperDecisionResponse(
  response: Response,
  questions: Record<string, unknown>[],
  expectedModels: string[] | undefined,
  publicModel: string,
): Promise<Record<string, unknown>>;
