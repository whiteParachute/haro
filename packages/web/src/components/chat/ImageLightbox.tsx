import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Self-rolled image lightbox (FEAT-034 R12 / D4).
 *
 * Multi-image carousel: arrow keys + touch swipe + index counter + ESC. We
 * keep the implementation under ~200 LOC to honour D4's "no new dependency"
 * constraint instead of pulling in `react-photo-view` / `swiper`.
 */

export interface LightboxImage {
  src: string;
  alt?: string;
}

export interface ImageLightboxProps {
  images: ReadonlyArray<LightboxImage>;
  initialIndex: number;
  open: boolean;
  onClose: () => void;
}

const SWIPE_THRESHOLD_PX = 50;

export function ImageLightbox({ images, initialIndex, open, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(() => clamp(initialIndex, 0, images.length - 1));
  const startXRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setIndex(clamp(initialIndex, 0, images.length - 1));
  }, [open, initialIndex, images.length]);

  const goPrev = useCallback(() => {
    setIndex((current) => (current - 1 + images.length) % Math.max(images.length, 1));
  }, [images.length]);
  const goNext = useCallback(() => {
    setIndex((current) => (current + 1) % Math.max(images.length, 1));
  }, [images.length]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft' && images.length > 1) goPrev();
      else if (event.key === 'ArrowRight' && images.length > 1) goNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, goNext, goPrev, images.length]);

  // Lock background scroll while the lightbox is open so swipe gestures don't
  // also scroll the underlying page.
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || images.length === 0) return null;
  const safeIndex = clamp(index, 0, images.length - 1);
  const current = images[safeIndex]!;
  const hasMany = images.length > 1;

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    startXRef.current = event.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (startXRef.current === null) return;
    const endX = event.changedTouches[0]?.clientX ?? null;
    if (endX === null) return;
    const delta = endX - startXRef.current;
    startXRef.current = null;
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX || !hasMany) return;
    if (delta > 0) goPrev();
    else goNext();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.alt ?? '图片预览'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      data-testid="image-lightbox"
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20"
      >
        ✕
      </button>
      {hasMany ? (
        <>
          <button
            type="button"
            aria-label="上一张"
            onClick={goPrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-white hover:bg-white/20"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="下一张"
            onClick={goNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-white hover:bg-white/20"
          >
            ›
          </button>
        </>
      ) : null}
      <figure className="flex max-h-full max-w-full flex-col items-center gap-3">
        <img
          src={current.src}
          alt={current.alt ?? ''}
          className="max-h-[80vh] max-w-full select-none rounded-md object-contain"
          draggable={false}
        />
        {hasMany ? (
          <figcaption className="rounded-full bg-white/10 px-3 py-1 text-xs text-white">
            {safeIndex + 1} / {images.length}
            {current.alt ? <span className="ml-2 opacity-80">— {current.alt}</span> : null}
          </figcaption>
        ) : current.alt ? (
          <figcaption className="rounded-full bg-white/10 px-3 py-1 text-xs text-white">{current.alt}</figcaption>
        ) : null}
      </figure>
    </div>,
    document.body,
  );
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}
