import { GEMS } from '../core/gems';
import type { Pixel } from '../core/types';

/** Colour a dot is drawn with: precious dots show their metal / gem colour. */
export function shownColor(p: Pixel): string {
  return p.gem ? GEMS[p.gem].color : p.color;
}

/** 0..1 twinkle of a precious dot at time `now` (each dot has its own phase). */
function twinkle(p: Pixel, now: number): number {
  const phase = ((p.growthIndex * 0.618034) % 1) + now / (p.gem === 'diamond' ? 1300 : 2100);
  return Math.pow(Math.max(0, Math.sin(phase * Math.PI * 2)), 4);
}

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
/** Pixel-art outline colour (display only; never stored). */
const OUTLINE = '#1c1528';
const POP_MS = 520;
const REVEAL_MS = 260;
const INTRO_MS = 900;
const REVEAL_FRAMES = 150;
const BREATH_MS = 3200;
const REACT_MS = 1100; // offline growth is revealed over ~2.5 s at most

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
  /** Same layout as `bake` but every dot in the outline colour. */
  private sil: HTMLCanvasElement;
  private silCtx: CanvasRenderingContext2D;
  private bakeOX = 0;
  private bakeOY = 0;
  private baked: Pixel[] = [];
  /** Precious dots among the baked ones (drawn with a sparkle on top). */
  private gems: Pixel[] = [];
  private bounds: Bounds | null = null;
  private pending: Pixel[] = [];
  private revealPerFrame = 1;
  private anims: Anim[] = [];
  private introStart: number | null = null;
  private raf = 0;
  private cam: Camera = { zoom: 24, cx: 0.5, cy: 0.5 };
  private auto = true;
  private reaction: { kind: 'food' | 'toy'; icon: string; start: number } | null = null;
  private idleTimer = 0;
  private bottomInset = 0;
  animationEnabled = true;
  outlineEnabled = true;
  readonly stats: RendererStats = { lastFrameMs: 0, avgFrameMs: 0, frames: 0, pixels: 0 };
  onCameraChange: ((cam: Camera, auto: boolean) => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
    this.bake = document.createElement('canvas');
    this.bakeCtx = this.bake.getContext('2d')!;
    this.sil = document.createElement('canvas');
    this.silCtx = this.sil.getContext('2d')!;
    this.allocBake(-16, -16, 32, 32);
    this.resize();
  }

  // ---- data -----------------------------------------------------------------

  /** Replace all dots (initial load). */
  setPixels(pixels: readonly Pixel[], intro: boolean) {
    this.baked = [];
    this.gems = [];
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

  setOutlineEnabled(on: boolean) {
    this.outlineEnabled = on;
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
    this.sil.width = w;
    this.sil.height = h;
    this.silCtx.fillStyle = OUTLINE;
    for (const p of this.baked) {
      this.silCtx.fillRect(p.x - ox, p.y - oy, 1, 1);
      this.bakeCtx.fillStyle = shownColor(p);
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
    if (p.gem) this.gems.push(p);
    this.bakeCtx.fillStyle = shownColor(p);
    this.bakeCtx.fillRect(p.x - this.bakeOX, p.y - this.bakeOY, 1, 1);
    this.silCtx.fillStyle = OUTLINE;
    this.silCtx.fillRect(p.x - this.bakeOX, p.y - this.bakeOY, 1, 1);
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
    const availH = Math.max(80, this.cssH - this.bottomInset);
    const zoom = clamp(Math.min((this.cssW * 0.7) / w, (availH * (this.bottomInset ? 0.62 : 0.52)) / h, 40), MIN_ZOOM, MAX_ZOOM);
    // keep the body centred in the area above any bottom overlay
    const cy = (b.minY + b.maxY + 1) / 2 + this.bottomInset / 2 / zoom;
    return { zoom, cx: (b.minX + b.maxX + 1) / 2, cy };
  }

  /** Space covered by an overlay at the bottom (CSS px); the auto view fits above it. */
  setBottomInset(px: number) {
    this.bottomInset = Math.max(0, px);
    if (this.auto) this.requestRender();
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
    if (this.idleTimer) clearTimeout(this.idleTimer);
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
    if (this.reaction) more = true;
    if (this.animationEnabled && this.bounds && !more && !this.idleTimer && typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
      // idle breathing keeps going, at a gentle frame rate
      this.idleTimer = setTimeout(() => {
        this.idleTimer = 0;
        this.requestRender();
      }, 33) as unknown as number;
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

    // breathing + item reactions: squash and stretch anchored at the feet (display only)
    let reactP = -1;
    let anchorX = cssW / 2, anchorY = cssH / 2, topY = cssH / 2;
    if (b) {
      anchorX = toSX((b.minX + b.maxX + 1) / 2);
      anchorY = toSY(b.maxY + 1);
      topY = toSY(b.minY);
      let sx = 1, sy = 1, lift = 0;
      if (this.animationEnabled) {
        const breath = Math.sin((now / BREATH_MS) * Math.PI * 2);
        sx -= 0.018 * breath;
        sy += 0.03 * breath;
      }
      if (this.reaction) {
        reactP = (now - this.reaction.start) / REACT_MS;
        if (reactP >= 1) {
          this.reaction = null;
          reactP = -1;
        } else if (this.reaction.kind === 'toy') {
          const hop = Math.sin(Math.PI * Math.min(1, reactP * 2)) * (reactP < 0.5 ? 1 : 0);
          lift = hop * Math.min(28, (anchorY - topY) * 0.18);
          const land = reactP > 0.5 ? Math.sin(Math.PI * (reactP - 0.5) * 2) * (1 - reactP) : 0;
          sx += 0.12 * land;
          sy -= 0.12 * land;
        } else {
          const munch = Math.sin(reactP * Math.PI * 8) * (1 - reactP);
          sx += 0.06 * munch;
          sy -= 0.06 * munch;
        }
      }
      if (sx !== 1 || sy !== 1 || lift) {
        ctx.translate(anchorX, anchorY - lift);
        ctx.scale(sx, sy);
        ctx.translate(-anchorX, -anchorY);
      }
    }

    ctx.globalAlpha = intro;
    // a small margin so squash / stretch never clips cells at the edges
    const wx0 = this.cam.cx - cssW / 2 / z - 2, wy0 = this.cam.cy - cssH / 2 / z - 2;
    const wx1 = this.cam.cx + cssW / 2 / z + 2, wy1 = this.cam.cy + cssH / 2 / z + 2;
    if (z >= 7) {
      // Zoomed in: few cells are visible, so draw them individually with a
      // small gap so each dot reads as a square.
      const gap = Math.max(1, z * 0.08);
      if (this.outlineEnabled) {
        ctx.fillStyle = OUTLINE;
        for (const p of this.baked) {
          if (p.x + 2 < wx0 || p.x - 1 > wx1 || p.y + 2 < wy0 || p.y - 1 > wy1) continue;
          ctx.fillRect(toSX(p.x - 1), toSY(p.y - 1), 3 * z, 3 * z);
        }
      }
      for (const p of this.baked) {
        if (p.x + 1 < wx0 || p.x > wx1 || p.y + 1 < wy0 || p.y > wy1) continue;
        ctx.fillStyle = shownColor(p);
        ctx.fillRect(toSX(p.x) + gap / 2, toSY(p.y) + gap / 2, z - gap, z - gap);
      }
    } else {
      // Zoomed out: draw only the visible part of the baked bitmap.
      ctx.imageSmoothingEnabled = false;
      const sx0 = Math.max(0, Math.floor(wx0 - this.bakeOX)), sy0 = Math.max(0, Math.floor(wy0 - this.bakeOY));
      const sx1 = Math.min(this.bake.width, Math.ceil(wx1 - this.bakeOX)), sy1 = Math.min(this.bake.height, Math.ceil(wy1 - this.bakeOY));
      if (sx1 > sx0 && sy1 > sy0 && this.outlineEnabled) {
        // one-cell outline: the silhouette stamped at the 8 neighbouring offsets
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            ctx.drawImage(this.sil, sx0, sy0, sx1 - sx0, sy1 - sy0,
              toSX(this.bakeOX + sx0 + ox), toSY(this.bakeOY + sy0 + oy), (sx1 - sx0) * z, (sy1 - sy0) * z);
          }
        }
      }
      if (sx1 > sx0 && sy1 > sy0) {
        ctx.drawImage(this.bake, sx0, sy0, sx1 - sx0, sy1 - sy0,
          toSX(this.bakeOX + sx0), toSY(this.bakeOY + sy0), (sx1 - sx0) * z, (sy1 - sy0) * z);
      }
    }

    // precious dots sparkle (display only)
    if (this.gems.length) {
      for (const p of this.gems) {
        if (p.x + 1 < wx0 || p.x > wx1 || p.y + 1 < wy0 || p.y > wy1) continue;
        const tw = this.animationEnabled ? twinkle(p, now) : 0.35;
        const x = toSX(p.x), y = toSY(p.y);
        // a faint glow so it stands out on any body colour
        ctx.globalAlpha = intro * (0.18 + 0.22 * tw);
        ctx.fillStyle = GEMS[p.gem!].color;
        ctx.fillRect(x - z * 0.3, y - z * 0.3, z * 1.6, z * 1.6);
        if (z >= 5) {
          // metallic bevel: dark lower-right edge, bright upper-left corner
          ctx.globalAlpha = intro * 0.45;
          ctx.fillStyle = '#2a2140';
          ctx.fillRect(x + z * 0.78, y + z * 0.12, z * 0.14, z * 0.8);
          ctx.fillRect(x + z * 0.12, y + z * 0.78, z * 0.8, z * 0.14);
        }
        ctx.globalAlpha = intro * (0.45 + 0.5 * tw);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + z * 0.18, y + z * 0.18, z * 0.28, z * 0.28);
        if (tw > 0.05 && z >= 3) {
          // a small four-point star over the dot
          const cx = x + z / 2, cy = y + z / 2;
          const r = z * (p.gem === 'diamond' ? 1.1 : 0.75) * (0.6 + 0.4 * tw);
          const w = Math.max(1, z * 0.12);
          ctx.globalAlpha = intro * tw;
          ctx.fillRect(cx - w / 2, cy - r, w, 2 * r);
          ctx.fillRect(cx - r, cy - w / 2, 2 * r, w);
        }
      }
      ctx.globalAlpha = intro;
    }

    // animating dots on top
    for (const a of this.anims) {
      const t = Math.min(1, (now - a.start) / a.dur);
      const ease = a.pop ? easeOutBack(t) : 1 - Math.pow(1 - t, 2);
      const size = Math.max(0.5, z * ease * (z >= 7 ? 0.92 : 1));
      const px = toSX(a.p.x + 0.5), py = toSY(a.p.y + 0.5);
      ctx.globalAlpha = Math.min(1, t * 2) * intro;
      ctx.fillStyle = shownColor(a.p);
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
      if (a.pop) {
        const ring = z * (1 + t * 3);
        ctx.globalAlpha = (1 - t) * 0.6;
        ctx.strokeStyle = shownColor(a.p);
        ctx.lineWidth = Math.max(1, z * 0.12);
        ctx.strokeRect(px - ring / 2, py - ring / 2, ring, ring);
      }
    }
    // the item floats up from the creature's head, with a little heart
    if (this.reaction && reactP >= 0) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const rise = reactP * 46;
      ctx.globalAlpha = Math.max(0, 1 - reactP * 1.1);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '30px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      ctx.fillText(this.reaction.icon, anchorX, Math.max(30, topY - 22 - rise));
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillStyle = '#ff8fb1';
      ctx.fillText('♥', anchorX + 26 + Math.sin(reactP * 9) * 4, Math.max(20, topY - 10 - rise * 1.3));
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Play the creature's reaction to an item (display only). */
  react(kind: 'food' | 'toy', icon: string) {
    this.reaction = { kind, icon, start: performance.now() };
    this.requestRender();
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
export function drawThumbnail(canvas: HTMLCanvasElement, pixels: readonly Pixel[], count: number, opts: { outline?: boolean; maxScale?: number } = {}) {
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
    tctx.fillStyle = shownColor(pixels[i]);
    tctx.fillRect(pixels[i].x - minX, pixels[i].y - minY, 1, 1);
  }
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min((canvas.width * 0.86) / (w + 2), (canvas.height * 0.86) / (h + 2), opts.maxScale ?? 12);
  ctx.imageSmoothingEnabled = false;
  const dx = (canvas.width - w * scale) / 2, dy = (canvas.height - h * scale) / 2;
  if (opts.outline) {
    const sil = document.createElement('canvas');
    sil.width = w;
    sil.height = h;
    const sctx = sil.getContext('2d')!;
    sctx.drawImage(tmp, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = OUTLINE;
    sctx.fillRect(0, 0, w, h);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (ox || oy) ctx.drawImage(sil, dx + ox * scale, dy + oy * scale, w * scale, h * scale);
  }
  ctx.drawImage(tmp, dx, dy, w * scale, h * scale);
}
