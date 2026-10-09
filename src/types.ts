export type Weather = 'sunny' | 'rain' | 'wind';

export type Point = { x: number; y: number };

export type Stroke = {
  id: string;
  points: Point[];
  color: string;
  width: number;
  createdAt: number;
};

export type Discovery = 'spider' | 'butterfly' | 'ladybug' | 'raindrop' | 'leaf';

export type Artwork = {
  id: string;
  createdAt: number;
  strokes: Stroke[];
  weather: Weather;
  discoveries: Discovery[];
};

export type Critter = {
  kind: Discovery;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  phase: number;
  life: number;
  path?: Point[];
  pathIndex?: number;
};
