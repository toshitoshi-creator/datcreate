import { useEffect, useRef } from 'react';
import { STICKER_BY_ID } from '../core/stickers';
import type { Pixel } from '../core/types';
import { drawThumbnail } from '../render/renderer';

/** Static pixel-art snapshot of a creature (with outline). */
export function PixelThumb({ pixels, size, className, sticker }: { pixels: readonly Pixel[] | null; size: number; className?: string; sticker?: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && pixels?.length) drawThumbnail(ref.current, pixels, pixels.length, { outline: true, maxScale: size > 200 ? 24 : 12, sticker: STICKER_BY_ID.get(sticker ?? '')?.icon });
  }, [pixels, size, sticker]);
  const px = Math.round(size * Math.min(3, globalThis.devicePixelRatio || 1));
  return <canvas ref={ref} width={px} height={px} className={className ?? 'collection-thumb'} style={{ width: size, height: size }} aria-hidden />;
}
