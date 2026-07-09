import { GripHorizontal, GripVertical } from 'lucide-react';
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
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
  defaultSize?: Partial<Size>;
  handleLabel?: string;
  maxSize?: Partial<Size>;
  minSize?: Partial<Size>;
  offset?: { x?: number; y?: number };
  resizable?: boolean;
  resizeLabel?: string;
}

interface Pos {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

const MARGIN = 16;
const GAP = 10;
const POS_PREFIX = 'pvc:floating-island:';
const SIZE_PREFIX = 'pvc:floating-island-size:';
const RESET_EVENT = 'pvc:floating-layout-reset';

function storageKey(id: string): string {
  return `${POS_PREFIX}${id}`;
}

function sizeKey(id: string): string {
  return `${SIZE_PREFIX}${id}`;
}

export function resetFloatingLayout() {
  if (typeof window === 'undefined') return;
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(POS_PREFIX) || key?.startsWith(SIZE_PREFIX)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Layout reset is best-effort; mounted islands still reset through the event.
  }
  window.dispatchEvent(new Event(RESET_EVENT));
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

function parseSavedSize(id: string): Size | null {
  try {
    const raw = localStorage.getItem(sizeKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Size>;
    return typeof parsed.width === 'number' && typeof parsed.height === 'number'
      ? { width: parsed.width, height: parsed.height }
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

function saveSize(id: string, size: Size) {
  try {
    localStorage.setItem(sizeKey(id), JSON.stringify(size));
  } catch {
    // Non-critical; resizing still works without persistence.
  }
}

function requestLayoutSettle() {
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  });
}

function fallbackSize(size: Partial<Size> | undefined): Size | null {
  if (typeof size?.width !== 'number' || typeof size?.height !== 'number') return null;
  return { width: size.width, height: size.height };
}

function clampSize(
  size: Size,
  minSize: Partial<Size> | undefined,
  maxSize: Partial<Size> | undefined,
): Size {
  const viewportMaxWidth = window.innerWidth - MARGIN * 2;
  const viewportMaxHeight = window.innerHeight - MARGIN * 2;
  const maxWidth = Math.max(160, Math.min(maxSize?.width ?? viewportMaxWidth, viewportMaxWidth));
  const maxHeight = Math.max(80, Math.min(maxSize?.height ?? viewportMaxHeight, viewportMaxHeight));
  const minWidth = minSize?.width ?? 180;
  const minHeight = minSize?.height ?? 48;
  return {
    width: Math.min(maxWidth, Math.max(minWidth, size.width)),
    height: Math.min(maxHeight, Math.max(minHeight, size.height)),
  };
}

function rectFrom(pos: Pos, width: number, height: number): DOMRect {
  return new DOMRect(pos.x, pos.y, width, height);
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function overlapArea(a: DOMRect, b: DOMRect): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

function resolveOverlap(el: HTMLDivElement, pos: Pos): Pos {
  const box = el.getBoundingClientRect();
  const preferred = clamp(pos, box.width, box.height);
  const others = Array.from(
    document.querySelectorAll<HTMLElement>('[data-floating-island]'),
  ).filter(
    (other) =>
      other !== el &&
      other.offsetParent !== null &&
      getComputedStyle(other).visibility !== 'hidden',
  );

  const otherRects = others.map((other) => other.getBoundingClientRect());
  const preferredRect = rectFrom(preferred, box.width, box.height);
  if (!otherRects.some((other) => overlaps(preferredRect, other))) return preferred;

  const xValues = [
    preferred.x,
    MARGIN,
    (window.innerWidth - box.width) / 2,
    window.innerWidth - box.width - MARGIN,
  ];
  const yValues = [
    preferred.y,
    MARGIN,
    (window.innerHeight - box.height) / 2,
    window.innerHeight - box.height - MARGIN,
  ];
  for (const other of otherRects) {
    xValues.push(other.left - box.width - GAP, other.right + GAP);
    yValues.push(other.top - box.height - GAP, other.bottom + GAP);
  }

  let best = preferred;
  let bestOverlap = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const x of xValues) {
    for (const y of yValues) {
      const candidate = clamp({ x, y }, box.width, box.height);
      const rect = rectFrom(candidate, box.width, box.height);
      const area = otherRects.reduce((sum, other) => sum + overlapArea(rect, other), 0);
      const distance = Math.hypot(candidate.x - preferred.x, candidate.y - preferred.y);
      if (
        area < bestOverlap - 1 ||
        (Math.abs(area - bestOverlap) <= 1 && distance < bestDistance)
      ) {
        best = candidate;
        bestOverlap = area;
        bestDistance = distance;
      }
    }
  }

  return best;
}

/** Draggable viewport chrome wrapper. It clamps to the viewport and does a
 * lightweight collision pass against sibling floating islands so default chrome
 * and dragged chrome do not stack directly on top of each other. */
export function FloatingIsland({
  id,
  placement,
  children,
  className = '',
  defaultSize,
  handleLabel = 'Move panel',
  maxSize,
  minSize,
  offset,
  resizable = false,
  resizeLabel = 'Resize panel',
}: FloatingIslandProps) {
  const offsetX = offset?.x;
  const offsetY = offset?.y;
  const resolvedOffset = useMemo(
    () => (offsetX === undefined && offsetY === undefined ? undefined : { x: offsetX, y: offsetY }),
    [offsetX, offsetY],
  );
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const posRef = useRef<Pos | null>(null);
  const resize = useRef<{ height: number; width: number; x: number; y: number } | null>(null);
  const userPositioned = useRef(false);
  const defaultSizeRef = useRef<Size | null>(fallbackSize(defaultSize));
  const sizeRef = useRef<Size | null>(parseSavedSize(id) ?? fallbackSize(defaultSize));
  const [pos, setPos] = useState<Pos | null>(null);
  const [size, setSize] = useState<Size | null>(() => sizeRef.current);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const savedSize = parseSavedSize(id);
    const baseSize = savedSize ?? fallbackSize(defaultSize);
    if (baseSize) {
      const nextSize = clampSize(baseSize, minSize, maxSize);
      defaultSizeRef.current = fallbackSize(defaultSize);
      sizeRef.current = nextSize;
      setSize(nextSize);
    }
    const box = el.getBoundingClientRect();
    const savedPos = parseSaved(id);
    userPositioned.current = savedPos !== null;
    const preferred = savedPos ?? defaultPos(placement, box.width, box.height, resolvedOffset);
    requestAnimationFrame(() => {
      const resolved = resolveOverlap(el, preferred);
      posRef.current = resolved;
      setPos(resolved);
    });
  }, [id, placement, resolvedOffset, defaultSize, minSize, maxSize]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const settle = () => {
      const box = el.getBoundingClientRect();
      const currentSize = sizeRef.current;
      if (currentSize) {
        const nextSize = clampSize(currentSize, minSize, maxSize);
        sizeRef.current = nextSize;
        setSize(nextSize);
      }
      const preferred =
        userPositioned.current && posRef.current
          ? posRef.current
          : defaultPos(placement, box.width, box.height, resolvedOffset);
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
  }, [placement, resolvedOffset, minSize, maxSize]);

  useEffect(() => {
    const reset = () => {
      const el = ref.current;
      if (!el) return;
      const baseSize = defaultSizeRef.current;
      userPositioned.current = false;
      sizeRef.current = baseSize ? clampSize(baseSize, minSize, maxSize) : null;
      setSize(sizeRef.current);
      requestAnimationFrame(() => {
        const box = el.getBoundingClientRect();
        const preferred = defaultPos(placement, box.width, box.height, resolvedOffset);
        const resolved = resolveOverlap(el, preferred);
        posRef.current = resolved;
        setPos(resolved);
      });
    };
    window.addEventListener(RESET_EVENT, reset);
    return () => window.removeEventListener(RESET_EVENT, reset);
  }, [maxSize, minSize, resolvedOffset, placement]);

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
    userPositioned.current = true;
    savePos(id, resolved);
    requestLayoutSettle();
  };

  const resizeTo = (clientX: number, clientY: number) => {
    const r = resize.current;
    if (!r) return;
    const next = clampSize(
      {
        width: r.width + clientX - r.x,
        height: r.height + clientY - r.y,
      },
      minSize,
      maxSize,
    );
    sizeRef.current = next;
    setSize(next);
  };

  const finishResize = () => {
    const el = ref.current;
    resize.current = null;
    setResizing(false);
    const currentSize = sizeRef.current;
    if (currentSize) saveSize(id, currentSize);
    const current = posRef.current;
    if (!el || !current) return;
    const resolved = resolveOverlap(el, current);
    posRef.current = resolved;
    setPos(resolved);
    userPositioned.current = true;
    savePos(id, resolved);
    requestLayoutSettle();
  };

  const beginResize = (clientX: number, clientY: number) => {
    const content = contentRef.current;
    if (!content || resize.current) return;
    const box = content.getBoundingClientRect();
    resize.current = { x: clientX, y: clientY, width: box.width, height: box.height };
    setResizing(true);

    const move = (ev: PointerEvent) => resizeTo(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      finishResize();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
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
        zIndex: dragging || resizing ? 60 : undefined,
      }}
    >
      <div className="flex overflow-hidden rounded-xl border border-border/80 bg-card/75 shadow-lg backdrop-blur-md">
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
          className={`flex w-4 shrink-0 cursor-grab items-center justify-center border-border/70 border-r bg-card/70 text-muted-foreground/80 hover:text-foreground active:cursor-grabbing ${
            dragging ? 'text-foreground' : ''
          }`}
        >
          <GripVertical size={13} />
        </button>
        <div
          ref={contentRef}
          className="relative flex min-h-0 min-w-0 p-1"
          style={{
            height: size?.height,
            width: size?.width,
          }}
        >
          {children}
          {resizable && (
            <button
              type="button"
              aria-label={resizeLabel}
              title={resizeLabel}
              onPointerDownCapture={(e: ReactPointerEvent<HTMLButtonElement>) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                beginResize(e.clientX, e.clientY);
              }}
              className={`absolute right-1 bottom-1 flex h-4 w-4 cursor-nwse-resize items-center justify-center rounded bg-card/80 text-muted-foreground shadow-sm ring-1 ring-border/70 hover:text-foreground ${
                resizing ? 'text-foreground' : ''
              }`}
            >
              <GripHorizontal size={11} className="-rotate-45" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
