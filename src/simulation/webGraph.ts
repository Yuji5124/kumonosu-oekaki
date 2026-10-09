import type { Point, Stroke } from '../types';
import { crossing } from './routes';

export type WebEdge = { a: number; b: number; strokeId: string };
export type WebCell = { points: Point[]; area: number };
export type WebStructure = { nodes: Point[]; edges: WebEdge[]; cells: WebCell[]; junctions: Point[] };

const key = (p: Point) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
const areaOf = (points: Point[]) => Math.abs(points.reduce((sum, p, i) => { const next = points[(i + 1) % points.length]; return sum + p.x * next.y - next.x * p.y; }, 0) / 2);

/** Split drawn segments at intersections, then trace bounded faces in the planar graph. */
export function buildWebStructure(strokes: Stroke[]): WebStructure {
  const nodes: Point[] = []; const nodeIds = new Map<string, number>(); const edges: WebEdge[] = [];
  const node = (point: Point): number => { const k = key(point); let id = nodeIds.get(k); if (id === undefined) { id = nodes.length; nodes.push(point); nodeIds.set(k, id); } return id; };
  for (const stroke of strokes) for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1], b = stroke.points[i]; const splits = [a, b];
    for (const other of strokes) for (let j = 1; j < other.points.length; j++) {
      const hit = crossing(a, b, other.points[j - 1], other.points[j]); if (hit && !splits.some(p => key(p) === key(hit))) splits.push(hit);
    }
    splits.sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
    for (let j = 1; j < splits.length; j++) { const from = node(splits[j - 1]), to = node(splits[j]); if (from !== to) edges.push({ a: from, b: to, strokeId: stroke.id }); }
  }
  const adjacency: number[][] = nodes.map(() => []);
  edges.forEach(({ a, b }) => { adjacency[a].push(b); adjacency[b].push(a); });
  adjacency.forEach((neighbors, id) => neighbors.sort((a, b) => Math.atan2(nodes[a].y - nodes[id].y, nodes[a].x - nodes[id].x) - Math.atan2(nodes[b].y - nodes[id].y, nodes[b].x - nodes[id].x)));
  const visited = new Set<string>(); const cells: WebCell[] = [];
  for (const edge of edges) for (const directed of [[edge.a, edge.b], [edge.b, edge.a]]) {
    const start = directed as [number, number]; let from = start[0], to = start[1]; const polygon: Point[] = []; let closed = false;
    for (let limit = 0; limit < edges.length * 2 + 4; limit++) {
      const id = `${from}:${to}`; if (visited.has(id)) { closed = from === start[0] && to === start[1]; break; }
      visited.add(id); polygon.push(nodes[from]); const neighbors = adjacency[to]; const reverseIndex = neighbors.indexOf(from);
      if (reverseIndex < 0 || neighbors.length < 2) break;
      const next = neighbors[(reverseIndex - 1 + neighbors.length) % neighbors.length]; from = to; to = next;
      if (from === start[0] && to === start[1]) { closed = true; break; }
    }
    if (!closed || polygon.length < 3) continue;
    const signed = polygon.reduce((sum, p, i) => { const n = polygon[(i + 1) % polygon.length]; return sum + p.x * n.y - n.x * p.y; }, 0) / 2;
    if (signed > 1) cells.push({ points: polygon, area: areaOf(polygon) });
  }
  return { nodes, edges, cells, junctions: nodes.filter((_, index) => adjacency[index].length >= 3) };
}
