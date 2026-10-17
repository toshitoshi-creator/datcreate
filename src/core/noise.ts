import { hash2i } from './rng';

/** Smooth 2-octave value noise in roughly [-1, 1]; gives each individual its own lobes. */
export function noise2(seed: number, x: number, y: number, scale: number): number {
  const octave = (s: number, sc: number) => {
    const fx = x / sc, fy = y / sc;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const v = (a: number, b: number) => hash2i(s, a, b) / 2147483648 - 1;
    const a = v(ix, iy) + (v(ix + 1, iy) - v(ix, iy)) * tx;
    const b = v(ix, iy + 1) + (v(ix + 1, iy + 1) - v(ix, iy + 1)) * tx;
    return a + (b - a) * ty;
  };
  return (octave(seed, scale) + 0.5 * octave(seed ^ 0x9e3779b9, scale / 2.3)) / 1.5;
}
