import { GripHorizontal } from 'lucide-react';
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

type Placement =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'left-stack'
  | 'right-stack'
  | 'bottom-left'
  | 'bottom-center';

interface FloatingIslandProps {
  id: string;
  placement: Placement;
  children: ReactNode;
  className?: string;
  handleLabel?: string;
  offset?: { x?: number; y?: number };
}

interface Pos {
  x: number;
  y: number;
}

const MARGIN = 16;
const GAP = 10;

function storageKey(id: string): string {
  return `pvc:floating-island:${id}`;
}

function clamp(pos: Pos, width: number, height: number): Pos {
  const maxX = Math.max(MARGIN, window.innerWidth - width - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - height - MARGIN);
  return {
    x: Math.min(maxX, Math.max(MARGIN, pos.x)),
    y: Math.min(maxY, Math.max(MARGIN, pos.y)),
  };
}

function defaultPos(
  placement: Placement,
  width: number,
  height: number,
  offset?: { x?: number; y?: number },
): Pos {
  const ox = offset?.x ?? 0;
  const oy = offset?.y ?? 0;
  const centerX = (window.innerWidth - width) / 2;
  const rightX = window.innerWidth - width - MARGIN;
  const bottomY = window.innerHeight - height - MARGIN;
  switch (placement) {
    case 'top-left':
      return { x: MARGIN + ox, y: MARGIN + oy };
    case 'top-center':
      return { x: centerX + ox, y: MARGIN + oy };
    case 'top-right':
      return { x: rightX + ox, y: MARGIN + oy };
    case 'left-stack':
      return { x: MARGIN + ox, y: MARGIN + 64 + oy };
    case 'right-stack':
      return { x: rightX + ox, y: MARGIN + 64 + oy };
    case 'bottom-left':
      return { x: MARGIN + ox, y: bottomY + oy };
    case 'bottom-center':
      return { x: centerX + ox, y: bottomY + oy };
  }
}

function parseSaved(id: string): Pos | null {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Pos>;
    return typeof parsed.x === 'number' && typeof parsed.y === 'number'
      ? { x: parsed.x, y: parsed.y }
      : null;
  } catch {
    return null;
  }
}

function savePos(id: string, pos: Pos) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(pos));
  } catch {
    // Non-critical; dragging still works without persistence.
  }
}

function rectFrom(pos: Pos, width: number, height: number): DOMRect {
  return new DOMRect(pos.x, pos.y, width, height);
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function resolveOverlap(el: HTMLDivElement, pos: Pos): Pos {
  const box = el.getBoundingClientRect();
  let next = clamp(pos, box.width, box.height);
  const others = Array.from(
    document.querySelectorAll<HTMLElement>('[data-floating-island]'),
  ).filter(
    (other) =>
      other !== el &&
      other.offsetParent !== null &&
      getComputedStyle(other).visibility !== 'hidden',
  );

  for (let pass = 0; pass < 12; pass++) {
    const candidate = rectFrom(next, box.width, box.height);
    const hit = others.find((other) => overlaps(candidate, other.getBoundingClientRect()));
    if (!hit) return next;

    const other = hit.getBoundingClientRect();
    const below = other.bottom + GAP;
    const above = other.top - box.height - GAP;
    if (below + box.height <= window.innerHeight - MARGIN) {
      next = { ...next, y: below };
    } else if (above >= MARGIN) {
      next = { ...next, y: above };
    } else if (other.left > window.innerWidth / 2) {
      next = { x: other.left - box.width - GAP, y: next.y };
    } else {
      next = { x: other.right + GAP, y: next.y };
    }
    next = clamp(next, box.width, box.height);
  }
  return next;
}

/** Draggable viewport chrome wrapper. It clamps to the viewport and does a
 * lightweight collision pass against sibling floating islands so default chrome
 * and dragged chrome do not stack directly on top of each other. */
export function FloatingIsland({
  id,
  placement,
  children,
  className = '',
  handleLabel = 'Move panel',
  offset,
}: FloatingIslandProps) {
  const ref = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const posRef = useRef<Pos | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const preferred = parseSaved(id) ?? defaultPos(placement, box.width, box.height, offset);
    requestAnimationFrame(() => {
      const resolved = resolveOverlap(el, preferred);
      posRef.current = resolved;
      setPos(resolved);
    });
  }, [id, placement, offset]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resize settling reads latest position from posRef.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const settle = () => {
      const box = el.getBoundingClientRect();
      const preferred = posRef.current ?? defaultPos(placement, box.width, box.height, offset);
      const resolved = resolveOverlap(el, preferred);
      posRef.current = resolved;
      setPos(resolved);
    };
    window.addEventListener('resize', settle);
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => requestAnimationFrame(settle))
        : null;
    ro?.observe(el);
    return () => {
      window.removeEventListener('resize', settle);
      ro?.disconnect();
    };
  }, [placement]);

  const moveTo = (clientX: number, clientY: number) => {
    const el = ref.current;
    const d = drag.current;
    if (!el || !d) return;
    const box = el.getBoundingClientRect();
    const next = clamp({ x: clientX - d.dx, y: clientY - d.dy }, box.width, box.height);
    posRef.current = next;
    setPos(next);
  };

  const finishDrag = () => {
    const el = ref.current;
    drag.current = null;
    setDragging(false);
    const current = posRef.current;
    if (!el || !current) return;
    const resolved = resolveOverlap(el, current);
    posRef.current = resolved;
    setPos(resolved);
    savePos(id, resolved);
  };

  const beginDrag = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el || drag.current) return;
    const box = el.getBoundingClientRect();
    drag.current = { dx: clientX - box.left, dy: clientY - box.top };
    setDragging(true);

    const move = (ev: PointerEvent) => moveTo(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      finishDrag();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: native drag handlers read mutable refs; id is stable for each mounted island.
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;

    const down = (e: PointerEvent) => {
      if (!ref.current) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      beginDrag(e.clientX, e.clientY);
    };

    handle.addEventListener('pointerdown', down);
    return () => {
      handle.removeEventListener('pointerdown', down);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-floating-island={id}
      className={`pointer-events-auto absolute z-30 ${className}`}
      style={{
        left: pos?.x ?? 0,
        top: pos?.y ?? 0,
        visibility: pos ? 'visible' : 'hidden',
        zIndex: dragging ? 60 : undefined,
      }}
    >
      <button
        ref={handleRef}
        type="button"
        aria-label={handleLabel}
        title={handleLabel}
        onPointerDownCapture={(e: ReactPointerEvent<HTMLButtonElement>) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          beginDrag(e.clientX, e.clientY);
        }}
        className={`mb-1 flex h-4 w-full cursor-grab items-center justify-center rounded-md border border-border/70 bg-card/90 text-muted-foreground/80 shadow-sm backdrop-blur-sm hover:text-foreground active:cursor-grabbing ${
          dragging ? 'text-foreground' : ''
        }`}
      >
        <GripHorizontal size={13} />
      </button>
      {children}
    </div>
  );
}
