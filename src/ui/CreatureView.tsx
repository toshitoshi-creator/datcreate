import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { hexToHsl } from '../core/color';
import type { Settings } from '../core/types';
import type { GameController } from '../engine/gameController';
import type { SettingsStore } from '../data/settings';
import { CreatureRenderer } from '../render/renderer';
import { playBlip } from './sound';

export interface CreatureViewHandle {
  zoom(factor: number): void;
  reset(): void;
}

interface Props {
  controller: GameController;
  settingsStore: SettingsStore;
  settings: Settings;
  /** Height of an overlay covering the bottom of the view (the auto view fits above it). */
  bottomInset?: number;
}

/** Canvas host: wires controller events, settings and touch/mouse gestures to the renderer. */
export const CreatureView = forwardRef<CreatureViewHandle, Props>(function CreatureView({ controller, settingsStore, settings, bottomInset = 0 }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CreatureRenderer | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useImperativeHandle(ref, () => ({
    zoom: (f) => rendererRef.current?.zoomAt(f),
    reset: () => rendererRef.current?.resetView(),
  }));

  useEffect(() => {
    const canvas = canvasRef.current!;
    const r = new CreatureRenderer(canvas);
    rendererRef.current = r;
    const s0 = settingsStore.get();
    r.animationEnabled = s0.animationEnabled;
    r.outlineEnabled = s0.outlineEnabled;
    if (s0.zoomLevel !== null && s0.viewCenterX !== null && s0.viewCenterY !== null) {
      r.setCamera({ zoom: s0.zoomLevel, cx: s0.viewCenterX, cy: s0.viewCenterY });
    }
    r.setPixels(controller.pixels, true);

    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    r.onCameraChange = (cam, auto) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        settingsStore.update(auto ? { zoomLevel: null, viewCenterX: null, viewCenterY: null } : { zoomLevel: cam.zoom, viewCenterX: cam.cx, viewCenterY: cam.cy });
      }, 400);
    };

    const offPixels = controller.onPixels((e) => {
      if (e.reason === 'initial') r.setPixels(e.pixels, false);
      else {
        r.addPixels(e.pixels, e.reason === 'growth' ? 'pop' : 'reveal');
        if (e.reason === 'growth' && settingsRef.current.soundEnabled) playBlip(hexToHsl(e.pixels[e.pixels.length - 1].color).h);
      }
    });

    const offReaction = controller.onReaction((e) => r.react(e.item.kind, e.item.icon));
    const onVisible = () => r.requestRender(); // resume breathing when the page comes back
    document.addEventListener('visibilitychange', onVisible);

    const ro = new ResizeObserver(() => r.resize());
    ro.observe(canvas);

    // ---- gestures: 1 pointer = pan, 2 pointers = pinch zoom, wheel = zoom ----
    const pts = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    const rel = (e: PointerEvent | WheelEvent) => {
      const b = canvas.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    // double-tap = two quick single-finger taps without movement
    let tapStart: { x: number; y: number; t: number } | null = null;
    let multi = false;
    let lastTap = 0;
    const onDown = (e: PointerEvent) => {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* capture is optional */
      }
      pts.set(e.pointerId, rel(e));
      if (pts.size === 1) {
        multi = false;
        tapStart = { ...rel(e), t: performance.now() };
      } else {
        multi = true;
      }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const cur = rel(e);
      if (pts.size === 1) {
        r.panBy(cur.x - prev.x, cur.y - prev.y);
      } else if (pts.size === 2) {
        const other = [...pts.entries()].find(([id]) => id !== e.pointerId)![1];
        const d = Math.hypot(cur.x - other.x, cur.y - other.y);
        const mid = { x: (cur.x + other.x) / 2, y: (cur.y + other.y) / 2 };
        const prevMid = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
        if (pinchDist > 0 && d > 0) r.zoomAt(d / pinchDist, mid.x, mid.y);
        r.panBy(mid.x - prevMid.x, mid.y - prevMid.y); // keep content under the fingers
        pinchDist = d;
      }
      pts.set(e.pointerId, cur);
    };
    const onUp = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      if (pts.size === 1 && !multi && tapStart && e.pointerType !== 'mouse') {
        const p = rel(e);
        const now = performance.now();
        if (Math.hypot(p.x - tapStart.x, p.y - tapStart.y) < 10 && now - tapStart.t < 250) {
          if (now - lastTap < 320) {
            r.resetView();
            lastTap = 0;
          } else lastTap = now;
        }
      }
      pts.delete(e.pointerId);
      pinchDist = 0;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = rel(e);
      r.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', () => r.resetView());

    return () => {
      clearTimeout(saveTimer);
      offPixels();
      offReaction();
      document.removeEventListener('visibilitychange', onVisible);
      ro.disconnect();
      r.destroy();
      rendererRef.current = null;
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [controller, settingsStore]);

  useEffect(() => {
    rendererRef.current?.setAnimationEnabled(settings.animationEnabled);
  }, [settings.animationEnabled]);

  useEffect(() => {
    rendererRef.current?.setOutlineEnabled(settings.outlineEnabled);
  }, [settings.outlineEnabled]);

  useEffect(() => {
    rendererRef.current?.setBottomInset(bottomInset);
  }, [bottomInset]);

  useEffect(() => {
    // "表示倍率のリセット" from settings clears the stored camera.
    const r = rendererRef.current;
    if (r && settings.zoomLevel === null && !r.isAuto) r.setCamera(null);
  }, [settings.zoomLevel]);

  return <canvas ref={canvasRef} className="creature-canvas" data-testid="creature-canvas" aria-label="ドット生命体" />;
});
