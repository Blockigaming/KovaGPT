export function developerChatCompletion(
  response: Response,
  options: { publicModel: string; expectedModels?: string[]; stream: boolean },
): Promise<Response>;
