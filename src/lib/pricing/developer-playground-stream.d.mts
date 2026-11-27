export function createDeveloperPlaygroundStream(): {
  push(chunk: string): string;
  finish(): { output: string; status: "completed" | "incomplete" };
};
