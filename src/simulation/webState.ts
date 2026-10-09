import type { Discovery, Point, Stroke, Weather } from '../types';

export const weatherLabel: Record<Weather, string> = { sunny: '☀️ はれ', rain: '🌧️ あめ', wind: '🍃 かぜ' };

export function simplify(points: Point[], minDistance = 3): Point[] {
  if (points.length < 3) return points;
  const result = [points[0]];
  for (const point of points.slice(1)) {
    const last = result[result.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) >= minDistance) result.push(point);
  }
  return result;
}

export function lineLength(stroke: Stroke): number {
  return stroke.points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - stroke.points[index].x, point.y - stroke.points[index].y), 0);
}

export function orientation(a: Point, b: Point, c: Point): number { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }

export function hasIntersection(a: Stroke, b: Stroke): boolean {
  for (let i = 1; i < a.points.length; i++) for (let j = 1; j < b.points.length; j++) {
    const p = a.points[i - 1], q = a.points[i], r = b.points[j - 1], s = b.points[j];
    if (orientation(p, q, r) * orientation(p, q, s) <= 0 && orientation(r, s, p) * orientation(r, s, q) <= 0) return true;
  }
  return false;
}

export function findNearestStroke(point: Point, strokes: Stroke[]): Stroke | undefined {
  let nearest: Stroke | undefined; let distance = Infinity;
  for (const stroke of strokes) for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1], b = stroke.points[i];
    const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
    if (d < distance) { distance = d; nearest = stroke; }
  }
  return nearest;
}

export function getDiscoveries(strokes: Stroke[]): Discovery[] {
  const discoveries: Discovery[] = strokes.length ? ['spider'] : [];
  if (strokes.some((s) => lineLength(s) > 90)) discoveries.push('butterfly');
  if (strokes.length >= 2 && strokes.some((s, i) => strokes.slice(i + 1).some((other) => hasIntersection(s, other)))) discoveries.push('ladybug');
  return discoveries;
}
