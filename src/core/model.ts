import { hexToHsl } from './color';
import type { Pixel } from './types';

const OFFSET = 1 << 20;
const SPAN = 1 << 21;

/** Pack integer grid coordinates into a single number key. */
export const cellKey = (x: number, y: number): number => (x + OFFSET) * SPAN + (y + OFFSET);

export interface CellInfo {
  id: string;
  index: number;
  x: number;
  y: number;
  h: number;
  s: number;
  l: number;
}

export const N8: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
];
export const N4: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/**
 * Occupancy index + frontier of an individual. It is a pure function of the
 * pixel list: it is always built by replaying pixels in growthIndex order, so
 * the in-session state and the state after a restart are identical (including
 * internal array orders that the generator samples from).
 */
export class GrowthModel {
  readonly cells = new Map<number, CellInfo>();
  readonly list: CellInfo[] = [];
  /** Empty cells 8-adjacent to at least one occupied cell. */
  readonly frontier: number[] = [];
  private readonly frontierPos = new Map<number, number>();
  sumX = 0;
  sumY = 0;
  minX = 0;
  maxX = 0;
  minY = 0;
  maxY = 0;

  static fromPixels(pixels: readonly Pixel[]): GrowthModel {
    const m = new GrowthModel();
    for (const p of pixels) m.add(p);
    return m;
  }

  get size(): number {
    return this.list.length;
  }

  has(x: number, y: number): boolean {
    return this.cells.has(cellKey(x, y));
  }

  get(x: number, y: number): CellInfo | undefined {
    return this.cells.get(cellKey(x, y));
  }

  n4(x: number, y: number): number {
    let c = 0;
    for (const [dx, dy] of N4) if (this.cells.has(cellKey(x + dx, y + dy))) c++;
    return c;
  }

  n8(x: number, y: number): number {
    let c = 0;
    for (const [dx, dy] of N8) if (this.cells.has(cellKey(x + dx, y + dy))) c++;
    return c;
  }

  centroid(): { x: number; y: number } {
    const n = this.list.length || 1;
    return { x: this.sumX / n, y: this.sumY / n };
  }

  add(p: Pixel): void {
    if (p.growthIndex !== this.list.length) {
      throw new Error(`GrowthModel: expected growthIndex ${this.list.length}, got ${p.growthIndex}`);
    }
    const k = cellKey(p.x, p.y);
    if (this.cells.has(k)) throw new Error(`GrowthModel: cell ${p.x},${p.y} already occupied`);
    const hsl = hexToHsl(p.color);
    const info: CellInfo = { id: p.id, index: p.growthIndex, x: p.x, y: p.y, h: hsl.h, s: hsl.s, l: hsl.l };
    this.cells.set(k, info);
    this.list.push(info);
    this.removeFrontier(k);
    for (const [dx, dy] of N8) {
      const nk = cellKey(p.x + dx, p.y + dy);
      if (!this.cells.has(nk)) this.addFrontier(nk);
    }
    this.sumX += p.x;
    this.sumY += p.y;
    if (this.list.length === 1) {
      this.minX = this.maxX = p.x;
      this.minY = this.maxY = p.y;
    } else {
      if (p.x < this.minX) this.minX = p.x;
      if (p.x > this.maxX) this.maxX = p.x;
      if (p.y < this.minY) this.minY = p.y;
      if (p.y > this.maxY) this.maxY = p.y;
    }
  }

  private addFrontier(k: number) {
    if (this.frontierPos.has(k)) return;
    this.frontierPos.set(k, this.frontier.length);
    this.frontier.push(k);
  }

  private removeFrontier(k: number) {
    const pos = this.frontierPos.get(k);
    if (pos === undefined) return;
    const last = this.frontier.pop()!;
    if (pos < this.frontier.length) {
      this.frontier[pos] = last;
      this.frontierPos.set(last, pos);
    }
    this.frontierPos.delete(k);
  }
}

export function keyToXY(k: number): [number, number] {
  const x = Math.floor(k / SPAN) - OFFSET;
  const y = (k % SPAN) - OFFSET;
  return [x, y];
}
