export class BrowserRuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BrowserRuntimeError";
  }
}

export const runtimeError = (code: string, message: string) =>
  new BrowserRuntimeError(code, message);
