import { useEffect, useRef } from 'react';
import type { Pixel } from '../core/types';
import { drawThumbnail } from '../render/renderer';

/** Static pixel-art snapshot of a creature (with outline). */
export function PixelThumb({ pixels, size, className }: { pixels: readonly Pixel[] | null; size: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && pixels?.length) drawThumbnail(ref.current, pixels, pixels.length, { outline: true, maxScale: size > 200 ? 24 : 12 });
  }, [pixels, size]);
  const px = Math.round(size * Math.min(3, globalThis.devicePixelRatio || 1));
  return <canvas ref={ref} width={px} height={px} className={className ?? 'collection-thumb'} style={{ width: size, height: size }} aria-hidden />;
}
