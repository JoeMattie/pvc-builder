import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  GripHorizontal,
  GripVertical,
  type LucideIcon,
} from 'lucide-react';
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
  | 'bottom-center'
  | 'bottom-right';

interface FloatingIslandProps {
  id: string;
  placement: Placement;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  /** Start collapsed when no collapse state is saved (responsive compact chrome). */
  defaultCollapsed?: boolean;
  defaultSize?: Partial<Size>;
  /** false pins the panel at its default placement: no drag handle, no saved position. */
  draggable?: boolean;
  handleLabel?: string;
  icon?: LucideIcon;
  maxSize?: Partial<Size>;
  minSize?: Partial<Size>;
  offset?: { x?: number; y?: number };
  resizable?: boolean;
  resizeLabel?: string;
  stackId?: string;
  stackOrder?: number;
  title?: string;
  titleActions?: ReactNode;
  titleLayout?: 'inline' | 'side' | 'top';
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
const SNAP_THRESHOLD = 12;
const POS_PREFIX = 'pvc:floating-island:';
const SIZE_PREFIX = 'pvc:floating-island-size:';
const COLLAPSE_PREFIX = 'pvc:floating-island-collapsed:';
const RESET_EVENT = 'pvc:floating-layout-reset';

function storageKey(id: string): string {
  return `${POS_PREFIX}${id}`;
}

function sizeKey(id: string): string {
  return `${SIZE_PREFIX}${id}`;
}

function collapseKey(id: string): string {
  return `${COLLAPSE_PREFIX}${id}`;
}

export function resetFloatingLayout() {
  if (typeof window === 'undefined') return;
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (
        key?.startsWith(POS_PREFIX) ||
        key?.startsWith(SIZE_PREFIX) ||
        key?.startsWith(COLLAPSE_PREFIX)
      ) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Layout reset is best-effort; mounted islands still reset through the event.
  }
  window.dispatchEvent(new Event(RESET_EVENT));
  // Two follow-up settle passes so measured stacks converge: order-1 panels
  // need order-0 rects committed to the DOM first, order-2 need order-1.
  requestLayoutSettle();
}

export function clampFloatingPos(
  pos: Pos,
  size: Size,
  viewport: Size = { width: window.innerWidth, height: window.innerHeight },
): Pos {
  const maxX = Math.max(MARGIN, viewport.width - size.width - MARGIN);
  const maxY = Math.max(MARGIN, viewport.height - size.height - MARGIN);
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
    case 'bottom-right':
      return { x: rightX + ox, y: bottomY + oy };
  }
}

function stackedDefaultPos(
  el: HTMLDivElement,
  placement: Placement,
  width: number,
  height: number,
  offset: { x?: number; y?: number } | undefined,
  stackId: string | undefined,
  stackOrder: number,
): Pos {
  const base = defaultPos(placement, width, height, offset);
  if (!stackId) return base;

  const lowerPeers = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-floating-stack="${stackId}"]`),
  )
    .filter(
      (peer) =>
        peer !== el &&
        peer.offsetParent !== null &&
        getComputedStyle(peer).visibility !== 'hidden' &&
        peer.dataset.floatingUserPositioned !== 'true' &&
        Number(peer.dataset.floatingOrder ?? 0) < stackOrder,
    )
    .sort((a, b) => Number(a.dataset.floatingOrder ?? 0) - Number(b.dataset.floatingOrder ?? 0));

  let y = MARGIN + (offset?.y ?? 0);
  for (const peer of lowerPeers) {
    const rect = peer.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    y = Math.max(y, rect.bottom + GAP);
  }

  return clampFloatingPos({ x: base.x, y }, { width, height });
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

function parseSavedCollapse(id: string): boolean | null {
  try {
    const raw = localStorage.getItem(collapseKey(id));
    return raw === null ? null : raw === '1';
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

function saveCollapse(id: string, collapsed: boolean) {
  try {
    localStorage.setItem(collapseKey(id), collapsed ? '1' : '0');
  } catch {
    // Non-critical; collapsing still works without persistence.
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
  bounds?: Partial<Size>,
): Size {
  const viewportMaxWidth = Math.max(80, (bounds?.width ?? window.innerWidth) - MARGIN * 2);
  const viewportMaxHeight = Math.max(48, (bounds?.height ?? window.innerHeight) - MARGIN * 2);
  const minWidth = minSize?.width ?? 180;
  const minHeight = minSize?.height ?? 48;
  const maxWidth = Math.max(
    minWidth,
    Math.min(maxSize?.width ?? viewportMaxWidth, viewportMaxWidth),
  );
  const maxHeight = Math.max(
    minHeight,
    Math.min(maxSize?.height ?? viewportMaxHeight, viewportMaxHeight),
  );
  return {
    width: Math.min(maxWidth, Math.max(minWidth, size.width)),
    height: Math.min(maxHeight, Math.max(minHeight, size.height)),
  };
}

export interface FloatingRect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

function rectFrom(pos: Pos, width: number, height: number): FloatingRect {
  return {
    left: pos.x,
    top: pos.y,
    right: pos.x + width,
    bottom: pos.y + height,
    width,
    height,
  };
}

function rectOf(r: DOMRect): FloatingRect {
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  };
}

export function snapFloatingPos(
  pos: Pos,
  size: Size,
  others: FloatingRect[],
  viewport: Size = { width: window.innerWidth, height: window.innerHeight },
  threshold = SNAP_THRESHOLD,
): Pos {
  const current = rectFrom(pos, size.width, size.height);
  let next = pos;
  let bestX = threshold + 1;
  let bestY = threshold + 1;

  for (const other of others) {
    const xTargets = [
      other.left,
      other.right - current.width,
      other.left - current.width - GAP,
      other.right + GAP,
    ];
    const yTargets = [
      other.top,
      other.bottom - current.height,
      other.top - current.height - GAP,
      other.bottom + GAP,
    ];
    for (const x of xTargets) {
      const d = Math.abs(pos.x - x);
      if (d <= threshold && d < bestX) {
        bestX = d;
        next = { ...next, x };
      }
    }
    for (const y of yTargets) {
      const d = Math.abs(pos.y - y);
      if (d <= threshold && d < bestY) {
        bestY = d;
        next = { ...next, y };
      }
    }
  }

  return clampFloatingPos(next, size, viewport);
}

export function constrainFloatingSize(
  size: Size,
  pos: Pos,
  minSize: Partial<Size> | undefined,
  maxSize: Partial<Size> | undefined,
  viewport: Size = { width: window.innerWidth, height: window.innerHeight },
  chrome: Partial<Size> = {},
): Size {
  const available = {
    width: Math.max(80, viewport.width - pos.x - MARGIN - (chrome.width ?? 0) + MARGIN * 2),
    height: Math.max(48, viewport.height - pos.y - MARGIN - (chrome.height ?? 0) + MARGIN * 2),
  };
  return clampSize(size, minSize, maxSize, available);
}

function siblingRects(el: HTMLDivElement): FloatingRect[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-floating-island]'))
    .filter(
      (other) =>
        other !== el &&
        other.offsetParent !== null &&
        getComputedStyle(other).visibility !== 'hidden',
    )
    .map((other) => rectOf(other.getBoundingClientRect()));
}

function labelFromHandle(handleLabel: string): string {
  return handleLabel
    .replace(/^Move\s+/i, '')
    .replace(/\s+panel$/i, '')
    .replace(/\s+palette$/i, '')
    .trim();
}

function isNoDragTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest('button,input,select,textarea,a,[role="button"],[data-floating-no-drag]')
  );
}

/** Draggable viewport chrome wrapper. Panels clamp to the viewport and snap
 * magnetically to sibling edges while dragging; overlap is allowed by design.
 * Default (non-user-moved) positions come from measured stacks (`stackId` +
 * `stackOrder`) rather than fixed offsets. */
export function FloatingIsland({
  id,
  placement,
  children,
  className = '',
  collapsible = true,
  defaultCollapsed = false,
  defaultSize,
  draggable = true,
  handleLabel = 'Move panel',
  icon: Icon,
  maxSize,
  minSize,
  offset,
  resizable = false,
  resizeLabel = 'Resize panel',
  stackId,
  stackOrder = 0,
  title,
  titleActions,
  titleLayout,
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
  const sizeRef = useRef<Size | null>(
    (resizable ? parseSavedSize(id) : null) ?? fallbackSize(defaultSize),
  );
  const [pos, setPos] = useState<Pos | null>(null);
  const [size, setSize] = useState<Size | null>(() => sizeRef.current);
  const [collapsed, setCollapsed] = useState(
    () => parseSavedCollapse(id) ?? (collapsible && defaultCollapsed),
  );
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const layout = titleLayout ?? 'top';
  const panelTitle = title ?? (labelFromHandle(handleLabel) || 'Panel');

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const savedSize = resizable ? parseSavedSize(id) : null;
    const baseSize = savedSize ?? fallbackSize(defaultSize);
    if (baseSize) {
      const nextSize = clampSize(baseSize, minSize, maxSize);
      defaultSizeRef.current = fallbackSize(defaultSize);
      sizeRef.current = nextSize;
      setSize(nextSize);
    }
    const box = el.getBoundingClientRect();
    const savedPos = draggable ? parseSaved(id) : null;
    userPositioned.current = savedPos !== null;
    const preferred =
      savedPos ??
      stackedDefaultPos(el, placement, box.width, box.height, resolvedOffset, stackId, stackOrder);
    requestAnimationFrame(() => {
      const resolved = clampFloatingPos(preferred, { width: box.width, height: box.height });
      posRef.current = resolved;
      setPos(resolved);
      // Measured stacks need peers' rects committed to the DOM: run the
      // double-settle so order-1 then order-2 members land after their peers
      // (mount is as racy as reset — every island measures simultaneously).
      if (stackId && !userPositioned.current) requestLayoutSettle();
    });
  }, [
    id,
    placement,
    resolvedOffset,
    defaultSize,
    minSize,
    maxSize,
    draggable,
    resizable,
    stackId,
    stackOrder,
  ]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const settle = () => {
      if (drag.current || resize.current) return;
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
          : stackedDefaultPos(
              el,
              placement,
              box.width,
              box.height,
              resolvedOffset,
              stackId,
              stackOrder,
            );
      const resolved = clampFloatingPos(preferred, { width: box.width, height: box.height });
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
  }, [placement, resolvedOffset, minSize, maxSize, stackId, stackOrder]);

  useEffect(() => {
    const reset = () => {
      const el = ref.current;
      if (!el) return;
      const baseSize = defaultSizeRef.current;
      userPositioned.current = false;
      setCollapsed(collapsible && defaultCollapsed);
      sizeRef.current = baseSize ? clampSize(baseSize, minSize, maxSize) : null;
      setSize(sizeRef.current);
      requestAnimationFrame(() => {
        const box = el.getBoundingClientRect();
        const preferred = stackedDefaultPos(
          el,
          placement,
          box.width,
          box.height,
          resolvedOffset,
          stackId,
          stackOrder,
        );
        const resolved = clampFloatingPos(preferred, { width: box.width, height: box.height });
        posRef.current = resolved;
        setPos(resolved);
      });
    };
    window.addEventListener(RESET_EVENT, reset);
    return () => window.removeEventListener(RESET_EVENT, reset);
  }, [
    collapsible,
    defaultCollapsed,
    maxSize,
    minSize,
    resolvedOffset,
    placement,
    stackId,
    stackOrder,
  ]);

  const moveTo = (clientX: number, clientY: number) => {
    const el = ref.current;
    const d = drag.current;
    if (!el || !d) return;
    const box = el.getBoundingClientRect();
    const clamped = clampFloatingPos(
      { x: clientX - d.dx, y: clientY - d.dy },
      { width: box.width, height: box.height },
    );
    const next = snapFloatingPos(
      clamped,
      { width: box.width, height: box.height },
      siblingRects(el),
    );
    posRef.current = next;
    setPos(next);
  };

  const finishDrag = () => {
    const el = ref.current;
    drag.current = null;
    setDragging(false);
    const current = posRef.current;
    if (!el || !current) return;
    const box = el.getBoundingClientRect();
    const resolved = clampFloatingPos(current, { width: box.width, height: box.height });
    posRef.current = resolved;
    setPos(resolved);
    userPositioned.current = true;
    savePos(id, resolved);
    requestLayoutSettle();
  };

  const resizeTo = (clientX: number, clientY: number) => {
    const r = resize.current;
    if (!r) return;
    const pos0 = posRef.current ?? { x: MARGIN, y: MARGIN };
    const island = ref.current?.getBoundingClientRect();
    const content = contentRef.current?.getBoundingClientRect();
    const chrome = island && content ? { width: island.width - content.width, height: 0 } : {};
    const next = constrainFloatingSize(
      { width: r.width + clientX - r.x, height: r.height + clientY - r.y },
      pos0,
      minSize,
      maxSize,
      undefined,
      chrome,
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
    const box = el.getBoundingClientRect();
    const resolved = clampFloatingPos(current, { width: box.width, height: box.height });
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

  const toggleCollapsed = () => {
    if (!collapsible) return;
    setCollapsed((cur) => {
      const next = !cur;
      saveCollapse(id, next);
      requestLayoutSettle();
      return next;
    });
  };

  const beginBarDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggable || isNoDragTarget(e.target)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    beginDrag(e.clientX, e.clientY);
  };

  const dragButton = (variant: 'side' | 'top') =>
    draggable ? (
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
        className={`flex shrink-0 cursor-grab items-center justify-center text-muted-foreground/80 hover:text-foreground active:cursor-grabbing ${
          variant === 'side' ? 'h-7 w-full' : 'h-7 w-7 rounded-md hover:bg-accent'
        } ${dragging ? 'text-foreground' : ''}`}
      >
        {variant === 'side' ? <GripVertical size={13} /> : <GripHorizontal size={14} />}
      </button>
    ) : null;

  const collapseButton = (variant: 'side' | 'top') =>
    collapsible ? (
      <button
        type="button"
        aria-label={collapsed ? `Expand ${panelTitle}` : `Collapse ${panelTitle}`}
        title={collapsed ? `Expand ${panelTitle}` : `Collapse ${panelTitle}`}
        onClick={toggleCollapsed}
        className={`flex shrink-0 items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground ${
          variant === 'side' ? 'h-7 w-full' : 'h-7 w-7 rounded-md'
        }`}
      >
        {variant === 'side' ? (
          collapsed ? (
            <ChevronRight size={14} />
          ) : (
            <ChevronLeft size={14} />
          )
        ) : collapsed ? (
          <ChevronDown size={14} />
        ) : (
          <ChevronUp size={14} />
        )}
      </button>
    ) : null;

  const sideRail = (
    <div className="flex w-8 shrink-0 flex-col items-center border-border/70 border-r bg-card/75">
      {dragButton('side')}
      <div className="flex min-h-20 flex-1 items-center justify-center overflow-hidden">
        <div className="flex max-w-7 flex-col items-center gap-1 text-center text-[10px] font-medium text-muted-foreground leading-tight">
          {Icon && <Icon size={13} className="shrink-0" />}
          <span>{panelTitle}</span>
        </div>
      </div>
      {collapseButton('side')}
    </div>
  );

  const topBar = (
    <div
      className={`flex min-h-9 items-center gap-1 border-border/70 border-b bg-card/75 px-1.5 ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${dragging ? 'text-foreground' : ''}`}
      onPointerDownCapture={beginBarDrag}
    >
      {dragButton('top')}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon size={13} className="shrink-0" />}
        <span className="truncate">{panelTitle}</span>
      </div>
      {titleActions}
      {collapseButton('top')}
    </div>
  );

  const inlineBar = (
    <div
      className={`flex min-h-9 shrink-0 items-center gap-1 border-border/70 border-r bg-card/75 px-1.5 ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${dragging ? 'text-foreground' : ''}`}
      onPointerDownCapture={beginBarDrag}
    >
      {dragButton('top')}
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon size={13} className="shrink-0" />}
        {/* inline titles go icon-only below lg so single-row islands fit tablet/phone widths */}
        <span className="hidden lg:inline">{panelTitle}</span>
      </div>
      {titleActions}
      {collapseButton('top')}
    </div>
  );

  return (
    <div
      ref={ref}
      data-floating-island={id}
      data-floating-stack={stackId}
      data-floating-order={stackId ? stackOrder : undefined}
      data-floating-user-positioned={userPositioned.current ? 'true' : 'false'}
      className={`pointer-events-auto absolute z-30 ${className}`}
      style={{
        left: pos?.x ?? 0,
        top: pos?.y ?? 0,
        visibility: pos ? 'visible' : 'hidden',
        zIndex: dragging || resizing ? 60 : undefined,
      }}
    >
      <div
        className={`overflow-hidden rounded-lg border border-border/80 bg-card/75 shadow-lg backdrop-blur-md ${
          layout === 'top' ? 'flex flex-col' : 'flex'
        }`}
      >
        {layout === 'top' ? topBar : layout === 'inline' ? inlineBar : sideRail}
        <div
          ref={contentRef}
          className={`relative flex min-h-0 min-w-0 transition-opacity duration-100 ${
            collapsed ? 'pointer-events-none overflow-hidden p-0 opacity-0' : 'p-1 opacity-100'
          }`}
          aria-hidden={collapsed}
          style={{
            height: collapsed && layout === 'top' ? 0 : size?.height,
            width: collapsed && layout !== 'top' ? 0 : size?.width,
          }}
        >
          {children}
          {resizable && !collapsed && (
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
