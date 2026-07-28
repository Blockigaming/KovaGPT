declare module "@/lib/deliverable-content.mjs" {
  export const PREVIEW_LIMITS: any;
  export function sanitizeMarkup(value: string): string;
  export function parseCsv(text: string, limits?: any): any;
  export function textDiff(before: string, after: string, ignoreWhitespace?: boolean): any;
  export function jsonDiff(before: any, after: any, path?: string): any;
  export function csvDiff(before: string, after: string, keyColumn?: string): any;
}
