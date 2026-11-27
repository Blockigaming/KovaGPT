type Row = Record<string, string | number>;
export function numbersOf(rows: Row[], key: string): number[];
export function quantile(sorted: number[], p: number): number;
export type BoxStats = {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers: number[];
  count: number;
};
export function boxStats(values: number[]): BoxStats | null;
export function kernelDensity(
  values: number[],
  points?: number,
  domain?: [number, number],
): { x: number; density: number }[];
export function dayNumber(value: unknown): number | null;
export function calendarCells(
  rows: Row[],
  dateKey: string,
  valueKey: string,
): { day: number; value: number; date: string; week: number; weekday: number }[] | null;
export type HierarchyNode = {
  name: string;
  path: string;
  value: number;
  leafValue?: number;
  children: HierarchyNode[];
};
export function pathHierarchy(
  rows: Row[],
  pathKey: string,
  valueKey: string,
  separator?: string,
): HierarchyNode | null;
export function partition(root: HierarchyNode): {
  nodes: { name: string; path: string; value: number; x0: number; x1: number; depth: number }[];
  depth: number;
};
export function chordLayout(
  rows: Row[],
  sourceKey?: string,
  targetKey?: string,
  valueKey?: string,
): {
  groups: { name: string; start: number; end: number; value: number }[];
  ribbons: {
    source: string;
    target: string;
    value: number;
    from: [number, number];
    to: [number, number];
    group: number;
  }[];
} | null;
export type Grid = { xs: number[]; ys: number[]; z: number[][] };
export function gridFromRows(rows: Row[], xKey?: string, yKey?: string, zKey?: string): Grid | null;
export function contourLevels(grid: Grid, count?: number): number[];
export function contourSegments(grid: Grid, level: number): [[number, number], [number, number]][];
export function project3d(
  point: [number, number, number],
  yaw: number,
  pitch: number,
): { x: number; y: number; depth: number };
export function normaliser(values: number[]): (value: number) => number;
export function jitter(index: number): number;
export function rankRows(rows: Row[], xKey: string, keys: string[]): Row[];
