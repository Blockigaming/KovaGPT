export type ResponseFile = {
  name: string;
  title: string;
  language: string;
  languageLabel: string;
  category: "Code" | "Document";
  preview: boolean;
  mime: string;
  content: string;
  complete: boolean;
  lines: number;
};
export function safeResponseFilename(value: string): string;
export function fenceFilename(infoLine: string): string | null;
export function extractResponseFiles(markdown: string): ResponseFile[];
export function describeFile(
  name: string,
  fenceLanguage: string,
  content: string,
  complete?: boolean,
): ResponseFile;
export function summarizeCreatedFiles(files: ResponseFile[]): string | null;
export function buildFilePreviewDocument(file: Pick<ResponseFile, "language" | "content">): string;
