import { useCallback, useRef, useState, type PointerEvent, type WheelEvent } from 'react';

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Wheel to zoom around the cursor, drag to pan. Returns SVG props. */
export function usePanZoom(initial: ViewBox) {
  const [vb, setVb] = useState(initial);
  const drag = useRef<{ px: number; py: number; vb: ViewBox; moved: boolean } | null>(null);

  const toSvg = (el: SVGSVGElement, clientX: number, clientY: number, box: ViewBox) => toSvgAt(el.getBoundingClientRect(), clientX, clientY, box);
  const toSvgAt = (r: DOMRect, clientX: number, clientY: number, box: ViewBox) => {
    const scale = Math.max(box.w / r.width, box.h / r.height);
    const offX = (r.width * scale - box.w) / 2;
    const offY = (r.height * scale - box.h) / 2;
    return { x: box.x - offX + (clientX - r.left) * scale, y: box.y - offY + (clientY - r.top) * scale, scale };
  };

  const onWheel = useCallback(
    (e: WheelEvent<SVGSVGElement>) => {
      if (e.deltaY === 0) return;
      const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      // Read everything off the event now: React clears currentTarget once the
      // handler returns, and the state updater below runs later.
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const { clientX, clientY } = e;
      if (rect.width <= 0 || rect.height <= 0) return;
      setVb((box) => {
        const w = Math.min(initial.w * 1.5, Math.max(initial.w / 6, box.w * f));
        const k = w / box.w;
        const p = toSvgAt(rect, clientX, clientY, box);
        const next = { x: p.x - (p.x - box.x) * k, y: p.y - (p.y - box.y) * k, w, h: box.h * k };
        return [next.x, next.y, next.w, next.h].every(Number.isFinite) ? next : box;
      });
    },
    [initial.w],
  );

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    drag.current = { px: e.clientX, py: e.clientY, vb, moved: false };
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    const { scale } = toSvg(e.currentTarget, 0, 0, d.vb);
    setVb({ ...d.vb, x: d.vb.x - dx * scale, y: d.vb.y - dy * scale });
  };
  const onPointerUp = () => {
    // Swallow the click that ends a drag.
    if (drag.current?.moved) {
      const stop = (ev: MouseEvent) => {
        ev.stopPropagation();
        window.removeEventListener('click', stop, true);
      };
      window.addEventListener('click', stop, true);
      setTimeout(() => window.removeEventListener('click', stop, true), 0);
    }
    drag.current = null;
  };

  return {
    viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`,
    zoom: initial.w / vb.w,
    handlers: { onWheel, onPointerDown, onPointerMove, onPointerUp, onPointerLeave: onPointerUp },
    reset: () => setVb(initial),
  };
}
