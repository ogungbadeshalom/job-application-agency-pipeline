'use client';

import { useEffect, useRef, useState } from 'react';
import { Close, Download, ZoomOut, ZoomIn } from './Icon';

// A proof-of-submission (or any) image that expands into a full-viewport
// lightbox on click, with zoom/pan controls. Used anywhere a stored image is
// previewed (client proof view, worker submission panel) so a small thumbnail
// never forces the user to strain — one click opens it large, scroll/buttons
// zoom, and Escape / backdrop click closes.
export default function ZoomableImage({
  src,
  alt,
  className,
  maxBox = 'max-w-md', // Tailwind sizing classes for the inline thumbnail
}: {
  src: string;
  alt?: string;
  className?: string;
  maxBox?: string;
}) {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const dragRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setScale(1); setPos({ x: 0, y: 0 }); }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open]);

  const reset = () => { setScale(1); setPos({ x: 0, y: 0 }); };

  function onWheel(e: React.WheelEvent) {
    if (!open) return;
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    setScale((s) => Math.min(4, Math.max(0.5, +(s + delta).toFixed(2))));
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, ox: pos.x, oy: pos.y };
    dragRef.current = true;
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    setPos({ x: drag.current.ox + (e.clientX - drag.current.startX), y: drag.current.oy + (e.clientY - drag.current.startY) });
  }
  function onPointerUp() { drag.current = null; dragRef.current = false; }

  const inlineSrc = src.startsWith('/') ? src : `/${src.split('/').filter(Boolean).join('/')}`;

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setScale(1); setPos({ x: 0, y: 0 }); }}
        className={`group relative block cursor-zoom-in overflow-hidden rounded-md border border-navy-700 ${maxBox} ${className ?? ''}`}
        aria-label="Expand image"
        title="Click to enlarge"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={inlineSrc} alt={alt ?? 'Preview'} className="w-full h-auto transition-transform duration-200 group-hover:scale-[1.02]" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4 select-none"
          onWheel={onWheel}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => { drag.current = null; }}
        >
          {/* backdrop click closes */}
          <div className="absolute inset-0" onClick={() => { setOpen(false); reset(); }} aria-hidden />

          <div
            className="relative max-w-[94vw] max-h-[92vh] flex flex-col"
            onPointerDown={onPointerDown}
            style={{ touchAction: 'none' }}
          >
            {/* buttons */}
            <div className="absolute -top-11 right-0 flex items-center gap-2 z-10">
              <button onClick={() => setScale((s) => Math.min(4, +(s + 0.25).toFixed(2)))} className="p-2 rounded-md bg-white/10 text-white hover:bg-white/20" aria-label="Zoom in"><ZoomIn size={16} /></button>
              <button onClick={() => setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)))} className="p-2 rounded-md bg-white/10 text-white hover:bg-white/20" aria-label="Zoom out"><ZoomOut size={16} /></button>
              <button onClick={reset} className="px-2.5 py-1.5 rounded-md bg-white/10 text-white text-xs hover:bg-white/20">Reset</button>
              <a href={inlineSrc} target="_blank" rel="noreferrer" className="p-2 rounded-md bg-white/10 text-white hover:bg-white/20" aria-label="Open in new tab"><Download size={16} /></a>
              <button onClick={() => { setOpen(false); reset(); }} className="p-2 rounded-md bg-white/10 text-white hover:bg-white/20" aria-label="Close"><Close size={16} /></button>
            </div>

            <div className="overflow-hidden rounded-lg border border-white/15 flex items-center justify-center"
                 style={{ maxWidth: '94vw', maxHeight: '82vh' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={inlineSrc}
                alt={alt ?? 'Expanded'}
                draggable={false}
                className="max-w-[94vw] max-h-[82vh] object-contain"
                style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, cursor: scale > 1 ? 'grab' : 'default' }}
              />
            </div>

            <div className="text-center text-white/60 text-xs mt-3 select-none pointer-events-none">
              Scroll or use buttons to zoom · drag to pan when zoomed · Esc to close
            </div>
          </div>
        </div>
      )}
    </>
  );
}