export type DocumentWidget = {
  version: 1;
  type: "document";
  title: string;
  content: string;
};
export type CodeWidget = {
  version: 1;
  type: "code";
  title: string;
  language: string;
  content: string;
};
export type DateWidget = {
  version: 1;
  type: "date";
  title: string;
  value: string;
  min?: string;
  max?: string;
};
export type TimelineWidget = {
  version: 1;
  type: "timeline";
  title: string;
  items: {
    id: string;
    title: string;
    start: string;
    end: string;
    status: "planned" | "doing" | "done";
  }[];
};
export type BoardWidget = {
  version: 1;
  type: "board";
  title: string;
  columns: { id: string; title: string }[];
  cards: { id: string; title: string; columnId: string; body?: string }[];
};
export type GenerativeWidget =
  DocumentWidget | CodeWidget | DateWidget | TimelineWidget | BoardWidget;
export type GenerativeContentPart =
  { kind: "text"; text: string } | { kind: "widget"; widget: GenerativeWidget; source: string };
export function validateGenerativeWidget(value: unknown): GenerativeWidget | null;
export function splitGenerativeContent(value: string): GenerativeContentPart[];
export const GENERATIVE_UI_INSTRUCTIONS: string;
