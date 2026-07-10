const RIGHT_DRAG_SLOP_PX = 4;
const CONTEXT_SUPPRESS_MS = 420;
const LAST_UP_GRACE_MS = 260;
const MAX_DEBUG_EVENTS = 220;

export interface PointerDebugEvent {
  seq: number;
  t: number;
  type: string;
  target?: string;
  pointerId?: number;
  x?: number;
  y?: number;
  moved?: boolean;
  allowed?: boolean;
  id?: string;
}

interface RightGesture {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  target?: string;
}

let seq = 0;
const debugEvents: PointerDebugEvent[] = [];
let gesture: RightGesture | null = null;
let lastUp: {
  pointerId: number;
  moved: boolean;
  endedAt: number;
} | null = null;
let suppressContextUntil = 0;

function now() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

export function recordPointerDebug(
  type: string,
  detail: Omit<Partial<PointerDebugEvent>, 'seq' | 't' | 'type'> = {},
) {
  debugEvents.push({
    seq: ++seq,
    t: Math.round(now()),
    type,
    ...detail,
  });
  if (debugEvents.length > MAX_DEBUG_EVENTS)
    debugEvents.splice(0, debugEvents.length - MAX_DEBUG_EVENTS);
}

export function getPointerDebugEvents() {
  return debugEvents.slice();
}

export function clearPointerDebugEvents() {
  debugEvents.length = 0;
}

export function beginRightClickGesture(pointerId: number, x: number, y: number, target?: string) {
  gesture = { pointerId, startX: x, startY: y, lastX: x, lastY: y, moved: false, target };
  lastUp = null;
  recordPointerDebug('right-down', { pointerId, x, y, target });
}

export function updateRightClickGesture(pointerId: number, x: number, y: number): boolean {
  if (!gesture || gesture.pointerId !== pointerId) return false;
  const dist = Math.hypot(x - gesture.startX, y - gesture.startY);
  const crossed = dist >= RIGHT_DRAG_SLOP_PX;
  if (crossed && !gesture.moved) {
    gesture.moved = true;
    recordPointerDebug('right-drag-start', {
      pointerId,
      x,
      y,
      target: gesture.target,
      moved: true,
    });
  }
  gesture.lastX = x;
  gesture.lastY = y;
  if (gesture.moved) suppressContextUntil = now() + CONTEXT_SUPPRESS_MS;
  return gesture.moved;
}

export function finishRightClickGesture(pointerId: number) {
  if (!gesture || gesture.pointerId !== pointerId) {
    recordPointerDebug('right-up-missing', { pointerId });
    return { moved: false, menuAllowed: true };
  }
  const moved = gesture.moved;
  const endedAt = now();
  if (moved) suppressContextUntil = endedAt + CONTEXT_SUPPRESS_MS;
  lastUp = { pointerId, moved, endedAt };
  recordPointerDebug('right-up', {
    pointerId,
    x: gesture.lastX,
    y: gesture.lastY,
    target: gesture.target,
    moved,
    allowed: !moved,
  });
  gesture = null;
  return { moved, menuAllowed: !moved };
}

export function canOpenRightClickMenu(
  pointerId: number,
  target: string,
  x: number,
  y: number,
): boolean {
  const t = now();
  const active = gesture?.pointerId === pointerId ? gesture : null;
  const recent =
    lastUp?.pointerId === pointerId && t - lastUp.endedAt <= LAST_UP_GRACE_MS ? lastUp : null;
  const moved = active?.moved ?? recent?.moved ?? false;
  const allowed = !moved && t >= suppressContextUntil;
  recordPointerDebug(allowed ? 'menu-open-allowed' : 'menu-open-suppressed', {
    pointerId,
    x,
    y,
    target,
    moved,
    allowed,
  });
  return allowed;
}

/** True when this pointer's right-button gesture crossed the drag slop (i.e.
 * the press became an orbit). Checked on RELEASE by consumers that must not
 * fire after a drag — e.g. the draw-path right-click abort in
 * `ui/editor/useEditorHotkeys.ts`. Reads the active gesture, falling back to
 * the just-finished one (Scene's capture-phase pointerup calls
 * `finishRightClickGesture` before bubble listeners see the same event). */
export function wasRightDrag(pointerId: number): boolean {
  if (gesture?.pointerId === pointerId) return gesture.moved;
  if (lastUp?.pointerId === pointerId && now() - lastUp.endedAt <= LAST_UP_GRACE_MS)
    return lastUp.moved;
  return false;
}

export function shouldSuppressNativeContextMenu(): boolean {
  const t = now();
  const recentMoved = !!lastUp?.moved && t - lastUp.endedAt <= CONTEXT_SUPPRESS_MS;
  return !!gesture?.moved || recentMoved || t < suppressContextUntil;
}
