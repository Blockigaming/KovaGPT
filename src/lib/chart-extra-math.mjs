/**
 * Pure layout and statistics helpers for the extended chart families. No DOM, no React:
 * every function takes plain rows and returns plain numbers, so it is unit-testable.
 */

export const numbersOf = (rows, key) =>
  rows
    .map((row) => row[key])
    .filter((value) => typeof value === "number" && Number.isFinite(value));

/** Linear-interpolated quantile of a sorted array (type 7, as in R and NumPy). */
export function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

/** Five-number summary with 1.5×IQR whiskers and the outliers beyond them. */
export function boxStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const fence = 1.5 * (q3 - q1);
  const inside = sorted.filter((value) => value >= q1 - fence && value <= q3 + fence);
  return {
    min: inside[0] ?? sorted[0],
    q1,
    median,
    q3,
    max: inside.at(-1) ?? sorted.at(-1),
    outliers: sorted.filter((value) => value < q1 - fence || value > q3 + fence),
    count: sorted.length,
  };
}

/** Gaussian kernel density with Silverman's bandwidth, sampled at `points` positions. */
export function kernelDensity(values, points = 48, domain) {
  if (values.length < 2) return [];
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1));
  const sorted = [...values].sort((a, b) => a - b);
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const spread = Math.min(sd, iqr / 1.34) || sd || Math.abs(mean) || 1;
  const bandwidth = 0.9 * spread * n ** -0.2;
  const [low, high] = domain ?? [sorted[0] - 3 * bandwidth, sorted.at(-1) + 3 * bandwidth];
  const step = (high - low) / (points - 1 || 1);
  const norm = 1 / (n * bandwidth * Math.sqrt(2 * Math.PI));
  return Array.from({ length: points }, (_, index) => {
    const x = low + step * index;
    let density = 0;
    for (const value of values) density += Math.exp(-0.5 * ((x - value) / bandwidth) ** 2);
    return { x, density: density * norm };
  });
}

/** Parse YYYY-MM-DD (or a full ISO time) to a UTC day number; null when invalid. */
export function dayNumber(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const time = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isFinite(time) ? Math.floor(time / 864e5) : null;
}

/** Week-column / weekday-row layout for a calendar heatmap. */
export function calendarCells(rows, dateKey, valueKey) {
  const cells = [];
  for (const row of rows) {
    const day = dayNumber(row[dateKey]);
    const value = row[valueKey];
    if (day === null || typeof value !== "number") continue;
    cells.push({ day, value, date: String(row[dateKey]).slice(0, 10) });
  }
  if (!cells.length) return null;
  const first = Math.min(...cells.map((cell) => cell.day));
  const firstWeekday = (first + 4) % 7; // 1970-01-01 was a Thursday
  return cells.map((cell) => {
    const offset = cell.day - first + firstWeekday;
    return { ...cell, week: Math.floor(offset / 7), weekday: (cell.day + 4) % 7 };
  });
}

/** Build a hierarchy from "A/B/C" paths and leaf values; parents total their children. */
export function pathHierarchy(rows, pathKey, valueKey, separator = "/") {
  const root = { name: "", path: "", value: 0, children: [] };
  for (const row of rows) {
    const value = row[valueKey];
    const path = row[pathKey];
    if (typeof value !== "number" || value <= 0 || typeof path !== "string") continue;
    let node = root;
    const parts = path
      .split(separator)
      .map((part) => part.trim())
      .filter(Boolean);
    parts.forEach((part, depth) => {
      let child = node.children.find((candidate) => candidate.name === part);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, depth + 1).join(separator),
          value: 0,
          children: [],
        };
        node.children.push(child);
      }
      node = child;
    });
    node.leafValue = (node.leafValue ?? 0) + value;
  }
  const total = (node) =>
    (node.value =
      (node.leafValue ?? 0) + node.children.reduce((sum, child) => sum + total(child), 0));
  total(root);
  return root.value > 0 ? root : null;
}

/** Partition layout: each node gets [x0,x1] share of its parent and a depth. */
export function partition(root) {
  const nodes = [];
  const visit = (node, x0, x1, depth) => {
    if (depth > 0)
      nodes.push({ name: node.name, path: node.path, value: node.value, x0, x1, depth });
    let cursor = x0;
    for (const child of node.children) {
      const width = ((x1 - x0) * child.value) / (node.value || 1);
      visit(child, cursor, cursor + width, depth + 1);
      cursor += width;
    }
  };
  visit(root, 0, 1, 0);
  return { nodes, depth: Math.max(0, ...nodes.map((node) => node.depth)) };
}

/** Chord layout: outer arcs per group and ribbons per flow, angles in radians. */
export function chordLayout(rows, sourceKey = "source", targetKey = "target", valueKey = "value") {
  const names = [];
  const index = (name) => {
    const at = names.indexOf(name);
    if (at >= 0) return at;
    names.push(name);
    return names.length - 1;
  };
  const flows = [];
  for (const row of rows) {
    const value = row[valueKey];
    if (typeof value !== "number" || value <= 0) continue;
    flows.push({ s: index(String(row[sourceKey])), t: index(String(row[targetKey])), value });
  }
  if (!flows.length || names.length < 2) return null;
  const totals = names.map((_, i) =>
    flows.reduce(
      (sum, flow) => sum + (flow.s === i ? flow.value : 0) + (flow.t === i ? flow.value : 0),
      0,
    ),
  );
  const grand = totals.reduce((a, b) => a + b, 0);
  const pad = Math.min(0.04, Math.PI / names.length / 4);
  const usable = 2 * Math.PI - pad * names.length;
  let angle = 0;
  const groups = names.map((name, i) => {
    const start = angle;
    angle += (totals[i] / grand) * usable;
    const group = { name, start, end: angle, cursor: start, value: totals[i] };
    angle += pad;
    return group;
  });
  const take = (group, value) => {
    const width = (value / grand) * usable;
    const span = [group.cursor, group.cursor + width];
    group.cursor += width;
    return span;
  };
  const ribbons = flows.map((flow) => ({
    source: groups[flow.s].name,
    target: groups[flow.t].name,
    value: flow.value,
    from: take(groups[flow.s], flow.value),
    to: take(groups[flow.t], flow.value),
    group: flow.s,
  }));
  return { groups: groups.map(({ cursor: _cursor, ...group }) => group), ribbons };
}

/** Regular grid from {x,y,z} rows; null unless every (x,y) pair is present once. */
export function gridFromRows(rows, xKey = "x", yKey = "y", zKey = "z") {
  const xs = [...new Set(numbersOf(rows, xKey))].sort((a, b) => a - b);
  const ys = [...new Set(numbersOf(rows, yKey))].sort((a, b) => a - b);
  if (xs.length < 2 || ys.length < 2 || xs.length * ys.length > 2_500) return null;
  const z = ys.map(() => xs.map(() => NaN));
  for (const row of rows) {
    const xi = xs.indexOf(row[xKey]);
    const yi = ys.indexOf(row[yKey]);
    if (xi < 0 || yi < 0 || typeof row[zKey] !== "number") continue;
    z[yi][xi] = row[zKey];
  }
  return z.every((line) => line.every(Number.isFinite)) ? { xs, ys, z } : null;
}

/** Evenly spaced contour levels strictly inside the data range. */
export function contourLevels(grid, count = 6) {
  const values = grid.z.flat();
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [];
  return Array.from(
    { length: count },
    (_, index) => min + ((max - min) * (index + 1)) / (count + 1),
  );
}

/**
 * Marching squares: line segments (in grid index space) where the field crosses `level`.
 * Saddle cells are resolved by the cell-centre average.
 */
export function contourSegments(grid, level) {
  const { z } = grid;
  const segments = [];
  const lerp = (a, b) => (level - a) / (b - a || 1e-12);
  for (let j = 0; j < z.length - 1; j++) {
    for (let i = 0; i < z[0].length - 1; i++) {
      const a = z[j][i];
      const b = z[j][i + 1];
      const c = z[j + 1][i + 1];
      const d = z[j + 1][i];
      const code =
        (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = [i + lerp(a, b), j];
      const right = [i + 1, j + lerp(b, c)];
      const bottom = [i + lerp(d, c), j + 1];
      const left = [i, j + lerp(a, d)];
      const centre = (a + b + c + d) / 4 > level;
      const table = {
        1: [[left, bottom]],
        2: [[bottom, right]],
        3: [[left, right]],
        4: [[top, right]],
        5: centre
          ? [
              [left, top],
              [bottom, right],
            ]
          : [
              [left, bottom],
              [top, right],
            ],
        6: [[top, bottom]],
        7: [[left, top]],
        8: [[left, top]],
        9: [[top, bottom]],
        10: centre
          ? [
              [top, right],
              [left, bottom],
            ]
          : [
              [top, left],
              [bottom, right],
            ],
        11: [[top, right]],
        12: [[left, right]],
        13: [[bottom, right]],
        14: [[left, bottom]],
      };
      segments.push(...table[code]);
    }
  }
  return segments;
}

/** Rotate (yaw about z, then pitch) and project a unit-cube point to 2-D screen space. */
export function project3d([x, y, z], yaw, pitch) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const rx = x * cy - y * sy;
  const ry = x * sy + y * cy;
  return { x: rx, y: -(z * cp - ry * sp), depth: ry * cp + z * sp };
}

/** Scale values into [-0.5, 0.5] for the 3-D cube. */
export function normaliser(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return (value) => (value - min) / span - 0.5;
}

/** Deterministic jitter in [-0.5, 0.5] for strip plots (stable across renders). */
export function jitter(index) {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value) - 0.5;
}

/** Ranks per x position (1 = highest) for bump charts. */
export function rankRows(rows, xKey, keys) {
  return rows.map((row) => {
    const ranked = keys
      .filter((key) => typeof row[key] === "number")
      .sort((a, b) => row[b] - row[a]);
    return Object.fromEntries([[xKey, row[xKey]], ...ranked.map((key, rank) => [key, rank + 1])]);
  });
}
