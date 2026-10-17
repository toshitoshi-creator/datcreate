import type { Pixel } from '../core/types';

export interface Camera {
  /** CSS px per grid cell. */
  zoom: number;
  /** World coordinate shown at the centre of the canvas. */
  cx: number;
  cy: number;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 64;
const BG = '#07080d';
const POP_MS = 520;
const REVEAL_MS = 260;
const INTRO_MS = 900;
const REVEAL_FRAMES = 150; // offline growth is revealed over ~2.5 s at most

interface Anim {
  p: Pixel;
  start: number;
  dur: number;
  pop: boolean;
}

export interface RendererStats {
  lastFrameMs: number;
  avgFrameMs: number;
  frames: number;
  pixels: number;
}

/**
 * Canvas 2D renderer. Dots are baked into an offscreen bitmap at 1 px per
 * cell and drawn scaled with smoothing disabled, so cost per frame is
 * independent of the number of dots. Rendering only happens on demand.
 * The renderer never mutates pixel data.
 */
export class CreatureRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  private bake: HTMLCanvasElement;
  private bakeCtx: CanvasRenderingContext2D;
  private bakeOX = 0;
  private bakeOY = 0;
  private baked: Pixel[] = [];
  private bounds: Bounds | null = null;
  private pending: Pixel[] = [];
  private revealPerFrame = 1;
  private anims: Anim[] = [];
  private introStart: number | null = null;
  private raf = 0;
  private cam: Camera = { zoom: 24, cx: 0.5, cy: 0.5 };
  private auto = true;
  animationEnabled = true;
  readonly stats: RendererStats = { lastFrameMs: 0, avgFrameMs: 0, frames: 0, pixels: 0 };
  onCameraChange: ((cam: Camera, auto: boolean) => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
    this.bake = document.createElement('canvas');
    this.bakeCtx = this.bake.getContext('2d')!;
    this.allocBake(-16, -16, 32, 32);
    this.resize();
  }

  // ---- data -----------------------------------------------------------------

  /** Replace all dots (initial load). */
  setPixels(pixels: readonly Pixel[], intro: boolean) {
    this.baked = [];
    this.pending = [];
    this.anims = [];
    this.bounds = null;
    for (const p of pixels) this.extendBounds(p);
    const b = this.bounds as Bounds | null; // assigned inside extendBounds
    if (b) {
      this.allocBake(b.minX - 16, b.minY - 16, b.maxX - b.minX + 33, b.maxY - b.minY + 33);
    }
    for (const p of pixels) this.bakePixel(p);
    this.stats.pixels = pixels.length;
    if (this.auto) this.cam = this.fitCamera();
    this.introStart = intro && this.animationEnabled ? performance.now() : null;
    this.requestRender();
  }

  /** New dots: `pop` for live growth, `reveal` for offline catch-up batches. */
  addPixels(pixels: readonly Pixel[], mode: 'pop' | 'reveal') {
    for (const p of pixels) this.extendBounds(p);
    this.stats.pixels += pixels.length;
    if (!this.animationEnabled) {
      for (const p of pixels) this.bakePixel(p);
    } else if (mode === 'pop') {
      const now = performance.now();
      for (const p of pixels) this.anims.push({ p, start: now, dur: POP_MS, pop: true });
    } else {
      this.pending.push(...pixels);
      this.revealPerFrame = Math.max(1, Math.ceil(this.pending.length / REVEAL_FRAMES));
    }
    this.requestRender();
  }

  setAnimationEnabled(on: boolean) {
    this.animationEnabled = on;
    if (!on) this.flushAnimations();
  }

  private flushAnimations() {
    for (const a of this.anims) this.bakePixel(a.p);
    for (const p of this.pending) this.bakePixel(p);
    this.anims = [];
    this.pending = [];
    this.introStart = null;
    this.requestRender();
  }

  private extendBounds(p: Pixel) {
    const b = this.bounds;
    if (!b) this.bounds = { minX: p.x, maxX: p.x, minY: p.y, maxY: p.y };
    else {
      if (p.x < b.minX) b.minX = p.x;
      if (p.x > b.maxX) b.maxX = p.x;
      if (p.y < b.minY) b.minY = p.y;
      if (p.y > b.maxY) b.maxY = p.y;
    }
  }

  private allocBake(ox: number, oy: number, w: number, h: number) {
    this.bakeOX = ox;
    this.bakeOY = oy;
    this.bake.width = w;
    this.bake.height = h;
    this.bakeCtx.clearRect(0, 0, w, h);
    for (const p of this.baked) {
      this.bakeCtx.fillStyle = p.color;
      this.bakeCtx.fillRect(p.x - ox, p.y - oy, 1, 1);
    }
  }

  private bakePixel(p: Pixel) {
    const lx = p.x - this.bakeOX, ly = p.y - this.bakeOY;
    if (lx < 0 || ly < 0 || lx >= this.bake.width || ly >= this.bake.height) {
      const b = this.bounds!;
      const w = b.maxX - b.minX + 1, h = b.maxY - b.minY + 1;
      const mx = Math.max(16, Math.ceil(w * 0.5)), my = Math.max(16, Math.ceil(h * 0.5));
      this.allocBake(b.minX - mx, b.minY - my, w + 2 * mx, h + 2 * my);
    }
    this.baked.push(p);
    this.bakeCtx.fillStyle = p.color;
    this.bakeCtx.fillRect(p.x - this.bakeOX, p.y - this.bakeOY, 1, 1);
  }

  // ---- camera ---------------------------------------------------------------

  get camera(): Camera {
    return { ...this.cam };
  }

  get isAuto() {
    return this.auto;
  }

  fitCamera(): Camera {
    const b = this.bounds;
    if (!b) return { zoom: 24, cx: 0.5, cy: 0.5 };
    const w = b.maxX - b.minX + 1, h = b.maxY - b.minY + 1;
    const zoom = clamp(Math.min((this.cssW * 0.7) / w, (this.cssH * 0.52) / h, 40), MIN_ZOOM, MAX_ZOOM);
    return { zoom, cx: (b.minX + b.maxX + 1) / 2, cy: (b.minY + b.maxY + 1) / 2 };
  }

  setCamera(cam: Camera | null) {
    if (!cam) {
      this.auto = true;
      this.cam = this.fitCamera();
    } else {
      this.auto = false;
      this.cam = { zoom: clamp(cam.zoom, MIN_ZOOM, MAX_ZOOM), cx: cam.cx, cy: cam.cy };
    }
    this.requestRender();
  }

  resetView() {
    this.setCamera(null);
    this.onCameraChange?.(this.cam, true);
  }

  zoomAt(factor: number, sx = this.cssW / 2, sy = this.cssH / 2) {
    const z = this.cam.zoom;
    const nz = clamp(z * factor, MIN_ZOOM, MAX_ZOOM);
    const wx = this.cam.cx + (sx - this.cssW / 2) / z;
    const wy = this.cam.cy + (sy - this.cssH / 2) / z;
    this.cam = { zoom: nz, cx: wx - (sx - this.cssW / 2) / nz, cy: wy - (sy - this.cssH / 2) / nz };
    this.auto = false;
    this.onCameraChange?.(this.cam, false);
    this.requestRender();
  }

  panBy(dx: number, dy: number) {
    this.cam = { ...this.cam, cx: this.cam.cx - dx / this.cam.zoom, cy: this.cam.cy - dy / this.cam.zoom };
    this.auto = false;
    this.onCameraChange?.(this.cam, false);
    this.requestRender();
  }

  // ---- drawing --------------------------------------------------------------

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width || this.canvas.clientWidth || 1);
    this.cssH = Math.max(1, rect.height || this.canvas.clientHeight || 1);
    this.dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    const w = Math.round(this.cssW * this.dpr), h = Math.round(this.cssH * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (this.auto) this.cam = this.fitCamera();
    this.requestRender();
  }

  requestRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.onCameraChange = null;
  }

  private frame = (now: number) => {
    this.raf = 0;
    const t0 = performance.now();
    let more = false;

    // progressive reveal of offline growth
    if (this.pending.length) {
      const batch = this.pending.splice(0, this.revealPerFrame);
      for (const p of batch) this.anims.push({ p, start: now, dur: REVEAL_MS, pop: false });
      more = true;
    }
    // smoothly follow the growing body while in auto view
    if (this.auto) {
      const target = this.fitCamera();
      const k = this.animationEnabled ? 0.18 : 1;
      const next = {
        zoom: this.cam.zoom + (target.zoom - this.cam.zoom) * k,
        cx: this.cam.cx + (target.cx - this.cam.cx) * k,
        cy: this.cam.cy + (target.cy - this.cam.cy) * k,
      };
      const settled = Math.abs(next.zoom - target.zoom) < 0.01 * target.zoom && Math.abs(next.cx - target.cx) < 0.02 && Math.abs(next.cy - target.cy) < 0.02;
      this.cam = settled ? target : next;
      if (!settled) more = true;
    }

    this.draw(now);

    // finish animations -> bake
    if (this.anims.length) {
      const still: Anim[] = [];
      for (const a of this.anims) {
        if (now - a.start >= a.dur) this.bakePixel(a.p);
        else still.push(a);
      }
      this.anims = still;
      more = true;
    }
    if (this.introStart !== null) {
      if (now - this.introStart >= INTRO_MS) this.introStart = null;
      more = true;
    }

    const dt = performance.now() - t0;
    this.stats.lastFrameMs = dt;
    this.stats.frames++;
    this.stats.avgFrameMs = this.stats.avgFrameMs ? this.stats.avgFrameMs * 0.9 + dt * 0.1 : dt;
    this.canvas.dataset.frameMs = dt.toFixed(2);
    this.canvas.dataset.pixels = String(this.stats.pixels);
    this.canvas.dataset.zoom = this.cam.zoom.toFixed(3);
    this.canvas.dataset.camX = this.cam.cx.toFixed(2);
    this.canvas.dataset.camY = this.cam.cy.toFixed(2);
    if (more) this.requestRender();
  };

  private draw(now: number) {
    const ctx = this.ctx;
    const { cssW, cssH } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cssW, cssH);

    let intro = 1;
    if (this.introStart !== null) {
      const t = Math.min(1, (now - this.introStart) / INTRO_MS);
      intro = 1 - Math.pow(1 - t, 3);
      const s = 0.88 + 0.12 * intro;
      ctx.translate(cssW / 2, cssH / 2);
      ctx.scale(s, s);
      ctx.translate(-cssW / 2, -cssH / 2);
    }

    const z = this.cam.zoom;
    const toSX = (wx: number) => (wx - this.cam.cx) * z + cssW / 2;
    const toSY = (wy: number) => (wy - this.cam.cy) * z + cssH / 2;

    // soft aura behind the body
    const b = this.bounds;
    if (b) {
      const cx = toSX((b.minX + b.maxX + 1) / 2), cy = toSY((b.minY + b.maxY + 1) / 2);
      const r = Math.max(30, Math.max(b.maxX - b.minX + 1, b.maxY - b.minY + 1) * z * 0.9);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(120,140,255,0.10)');
      g.addColorStop(1, 'rgba(120,140,255,0)');
      ctx.globalAlpha = intro;
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    }

    ctx.globalAlpha = intro;
    const wx0 = this.cam.cx - cssW / 2 / z, wy0 = this.cam.cy - cssH / 2 / z;
    const wx1 = this.cam.cx + cssW / 2 / z, wy1 = this.cam.cy + cssH / 2 / z;
    if (z >= 7) {
      // Zoomed in: few cells are visible, so draw them individually with a
      // small gap so each dot reads as a square.
      const gap = Math.max(1, z * 0.08);
      for (const p of this.baked) {
        if (p.x + 1 < wx0 || p.x > wx1 || p.y + 1 < wy0 || p.y > wy1) continue;
        ctx.fillStyle = p.color;
        ctx.fillRect(toSX(p.x) + gap / 2, toSY(p.y) + gap / 2, z - gap, z - gap);
      }
    } else {
      // Zoomed out: draw only the visible part of the baked bitmap.
      ctx.imageSmoothingEnabled = false;
      const sx0 = Math.max(0, Math.floor(wx0 - this.bakeOX)), sy0 = Math.max(0, Math.floor(wy0 - this.bakeOY));
      const sx1 = Math.min(this.bake.width, Math.ceil(wx1 - this.bakeOX)), sy1 = Math.min(this.bake.height, Math.ceil(wy1 - this.bakeOY));
      if (sx1 > sx0 && sy1 > sy0) {
        ctx.drawImage(this.bake, sx0, sy0, sx1 - sx0, sy1 - sy0,
          toSX(this.bakeOX + sx0), toSY(this.bakeOY + sy0), (sx1 - sx0) * z, (sy1 - sy0) * z);
      }
    }

    // animating dots on top
    for (const a of this.anims) {
      const t = Math.min(1, (now - a.start) / a.dur);
      const ease = a.pop ? easeOutBack(t) : 1 - Math.pow(1 - t, 2);
      const size = Math.max(0.5, z * ease * (z >= 7 ? 0.92 : 1));
      const px = toSX(a.p.x + 0.5), py = toSY(a.p.y + 0.5);
      ctx.globalAlpha = Math.min(1, t * 2) * intro;
      ctx.fillStyle = a.p.color;
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
      if (a.pop) {
        const ring = z * (1 + t * 3);
        ctx.globalAlpha = (1 - t) * 0.6;
        ctx.strokeStyle = a.p.color;
        ctx.lineWidth = Math.max(1, z * 0.12);
        ctx.strokeRect(px - ring / 2, py - ring / 2, ring, ring);
      }
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function easeOutBack(t: number) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Draw a small static snapshot of the first `count` dots (history view). */
export function drawThumbnail(canvas: HTMLCanvasElement, pixels: readonly Pixel[], count: number) {
  const n = Math.min(count, pixels.length);
  const ctx = canvas.getContext('2d');
  if (!ctx || !n) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = pixels[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext('2d')!;
  for (let i = 0; i < n; i++) {
    tctx.fillStyle = pixels[i].color;
    tctx.fillRect(pixels[i].x - minX, pixels[i].y - minY, 1, 1);
  }
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min((canvas.width * 0.86) / w, (canvas.height * 0.86) / h, 12);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, (canvas.width - w * scale) / 2, (canvas.height - h * scale) / 2, w * scale, h * scale);
}
