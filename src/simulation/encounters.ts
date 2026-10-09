import type { Critter, Point } from '../types';
import type { WebStructure } from './webGraph';

export type Encounter = { id: 'spider-butterfly' | 'web-cell-discovery'; at: Point; participants: string[] };

/** Small deterministic rules make web geometry and nearby creatures cause a visible event. */
export function findEncounter(critters: Critter[], web: WebStructure, alreadySeen: Set<string>): Encounter | null {
  if (web.cells.length && !alreadySeen.has('web-cell-discovery')) {
    const cell = web.cells.reduce((largest, current) => current.area > largest.area ? current : largest);
    const at = cell.points.reduce((sum, point) => ({ x: sum.x + point.x / cell.points.length, y: sum.y + point.y / cell.points.length }), { x: 0, y: 0 });
    return { id: 'web-cell-discovery', at, participants: ['web'] };
  }
  const spider = critters.find((critter) => critter.kind === 'spider');
  const butterfly = critters.find((critter) => critter.kind === 'butterfly');
  if (spider && butterfly && Math.hypot(spider.x - butterfly.x, spider.y - butterfly.y) < 72 && !alreadySeen.has('spider-butterfly')) {
    return { id: 'spider-butterfly', at: { x: (spider.x + butterfly.x) / 2, y: (spider.y + butterfly.y) / 2 }, participants: [spider.kind, butterfly.kind] };
  }
  return null;
}
