export function developerComputerFields(input: unknown): Record<string, unknown>;
export function validDeveloperComputerRequest(body: unknown): boolean;
export function validateDeveloperComputerResult(
  value: unknown,
  body: unknown,
  expectedModels: string[] | undefined,
  publicModel: string,
): Record<string, unknown>;
export function readDeveloperComputerResponse(
  response: Response,
  body: unknown,
  expectedModels: string[] | undefined,
  publicModel: string,
): Promise<Record<string, unknown>>;
