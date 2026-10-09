import type { Point, Stroke } from '../types';

export function crossing(a: Point, b: Point, c: Point, d: Point): Point | null {
  const dx = b.x - a.x, dy = b.y - a.y, ex = d.x - c.x, ey = d.y - c.y;
  const determinant = dx * ey - dy * ex;
  if (Math.abs(determinant) < 1e-8) return null;
  const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / determinant;
  const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / determinant;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + t * dx, y: a.y + t * dy } : null;
}

// Insert real intersection coordinates so a spider can transfer without jumping.
export function routePoints(stroke: Stroke, strokes: Stroke[]): Point[] {
  const result = [stroke.points[0]];
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1], b = stroke.points[i]; const hits: Point[] = [];
    for (const other of strokes) if (other.id !== stroke.id) for (let j = 1; j < other.points.length; j++) {
      const point = crossing(a, b, other.points[j - 1], other.points[j]); if (point) hits.push(point);
    }
    hits.sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
    for (const point of [...hits, b]) if (Math.hypot(point.x - result[result.length - 1].x, point.y - result[result.length - 1].y) > .01) result.push(point);
  }
  return result;
}
