import { type ThreeEvent, useThree } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import { type Ray, Raycaster, Vector2, Vector3 } from 'three';
import type { Vec3 } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { dominantAxisNormal, rayToGround, rayToPlane } from './ground';
import { activeTouchCount, touchCancellationEpoch, touchCanEdit } from './touchGestures';

// A click and an orbit-drag both start with a pointerdown on the ground; only
// treat a pointerup as a "click" if the pointer barely moved.
export const CLICK_SLOP_PX = 6;

/** Live modifier state during a drag: reflects whether Shift/Ctrl is HELD right
 * now (seeded from the pointer-down, then updated on key down/up mid-drag), so
 * the mode follows the held key even while the cursor is stationary. */
export type DragMods = { shift: boolean; ctrl: boolean };

export interface WindowPointerDragOptions {
  onMove: (ev: PointerEvent) => void;
  onUp: (ev: PointerEvent) => void;
  onCancel?: (ev: PointerEvent) => void;
  onKeyDown?: (ev: KeyboardEvent) => void;
  onKeyUp?: (ev: KeyboardEvent) => void;
}

/** Shared window-listener lifecycle for scene drags. R3F mesh pointerup is easy
 * to lose once the cursor leaves a small mesh, so interactions that start on a
 * mesh/ground plane should register their move/up/cancel listeners here. */
export function startWindowPointerDrag(opts: WindowPointerDragOptions): () => void {
  function cleanup() {
    window.removeEventListener('pointermove', opts.onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    if (opts.onKeyDown) window.removeEventListener('keydown', opts.onKeyDown);
    if (opts.onKeyUp) window.removeEventListener('keyup', opts.onKeyUp);
  }
  function onUp(ev: PointerEvent) {
    cleanup();
    opts.onUp(ev);
  }
  function onCancel(ev: PointerEvent) {
    cleanup();
    (opts.onCancel ?? opts.onUp)(ev);
  }

  window.addEventListener('pointermove', opts.onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  if (opts.onKeyDown) window.addEventListener('keydown', opts.onKeyDown);
  if (opts.onKeyUp) window.addEventListener('keyup', opts.onKeyUp);
  return cleanup;
}

/**
 * A ground-plane drag driven by WINDOW pointer listeners, not the handle mesh's
 * own events. This is deliberate: r3f only sends a mesh pointermove/up while the
 * ray intersects it, so a mesh-driven drag would stop the moment the cursor left
 * the small handle, leaving OrbitControls disabled.
 */
export function useGroundDrag(
  onMove: (point: Vec3, mods: DragMods, ev: PointerEvent) => void,
  opts?: {
    // when it returns a point, the drag rides a view-facing plane through that
    // point instead of the y = 0 ground, so a floating node keeps its height
    viewPlaneOrigin?: () => Vec3 | null;
    // a fully custom projection of the picking ray to a world point, captured at
    // grab time. Takes precedence over viewPlaneOrigin / ground.
    project?: (ray: Ray) => Vec3 | null;
    // called once when the drag settles, inside the gesture, before commit
    onEnd?: () => void;
  },
) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const [dragging, setDragging] = useState(false);
  const rc = useMemo(() => new Raycaster(), []);
  const ndc = useMemo(() => new Vector2(), []);
  const fwd = useMemo(() => new Vector3(), []);

  const start = (e: ThreeEvent<PointerEvent>) => {
    if (!touchCanEdit(e.nativeEvent) || activeTouchCount() > 1) return;
    e.stopPropagation();
    if (controls) controls.enabled = false;
    const app = useAppStore.getState();
    const preGestureDoc = app.current;
    const touchEpoch = touchCancellationEpoch();
    app.beginGesture();
    setDragging(true);
    const el = gl.domElement;

    const project = opts?.project ?? null;
    const origin = project ? null : (opts?.viewPlaneOrigin?.() ?? null);
    let plane: { point: Vec3; normal: Vec3 } | null = null;
    if (origin) {
      camera.getWorldDirection(fwd);
      plane = { point: origin, normal: dominantAxisNormal({ x: fwd.x, y: fwd.y, z: fwd.z }) };
    }

    const mods: DragMods = { shift: e.nativeEvent.shiftKey, ctrl: e.nativeEvent.ctrlKey };
    let lastG: Vec3 | null = null;
    let lastEv: PointerEvent | null = null;

    const move = (ev: PointerEvent) => {
      if (ev.pointerType === 'touch' && touchCancellationEpoch() !== touchEpoch) return;
      const rect = el.getBoundingClientRect();
      ndc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      rc.setFromCamera(ndc, camera);
      const g = project
        ? project(rc.ray)
        : plane
          ? rayToPlane(rc.ray, plane.point, plane.normal)
          : rayToGround(rc.ray);
      if (g) {
        lastG = g;
        lastEv = ev;
        onMove(g, mods, ev);
      }
    };

    const setMod = (ev: KeyboardEvent, held: boolean) => {
      let changed = false;
      if (ev.key === 'Shift' && mods.shift !== held) {
        mods.shift = held;
        changed = true;
      } else if ((ev.key === 'Control' || ev.key === 'Meta') && mods.ctrl !== held) {
        mods.ctrl = held;
        changed = true;
      }
      if (changed) {
        ev.preventDefault();
        if (lastG && lastEv) onMove(lastG, mods, lastEv);
      }
    };
    const onKeyDown = (ev: KeyboardEvent) => setMod(ev, true);
    const onKeyUp = (ev: KeyboardEvent) => setMod(ev, false);
    const finish = () => {
      if (controls) controls.enabled = true;
      const cancelled =
        e.nativeEvent.pointerType === 'touch' && touchCancellationEpoch() !== touchEpoch;
      if (cancelled && preGestureDoc) useAppStore.getState().updateCurrent(() => preGestureDoc);
      else opts?.onEnd?.();
      useAppStore.getState().endGesture();
      setDragging(false);
    };

    startWindowPointerDrag({
      onMove: move,
      onUp: finish,
      onCancel: finish,
      onKeyDown,
      onKeyUp,
    });
  };

  return { start, dragging };
}
