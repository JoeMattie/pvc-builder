import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { MOUSE, Vector3 } from 'three';
import type { Vec3 } from '../../schema';
import { solve } from '../../solver';
import {
  activeTopoHash,
  physicsActive,
  physicsNodePositions,
  physicsTopoHash,
  startPhysics,
  stepPhysics,
  stopPhysics,
} from '../../solver/physics';
import { bumpAnim, easedPos, stepEasing } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import {
  getCameraPose,
  orthoInit,
  PERSP_FOV,
  perspInit,
  recordPose,
  type V3,
} from '../../state/cameraStore';
import { pivotAnglesOf } from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { DrawController } from './DrawController';
import { FittingLayer } from './FittingLayer';
import { FormedLayer } from './FormedLayer';
import { IntersectionLayer } from './IntersectionLayer';
import { PipeLayer } from './PipeLayer';
import { PivotLayer } from './PivotLayer';
import { SelectionHandles } from './SelectionHandles';

/** Everything inside the Canvas: camera, studio lighting, ground grid + shadow
 * catcher, pipe meshes, the draw controller, and selection drag handles. */
export function Scene() {
  // Scene deliberately does NOT subscribe to the design document — the pipe and
  // handle layers read it themselves. That keeps a drag (which mutates the doc
  // every frame) from re-rendering the grid, gizmo, cameras, and lights.
  const projection = useEditorStore((s) => s.projection);
  const tool = useEditorStore((s) => s.tool);
  const night = useThemeStore((s) => s.night);
  const pal = scenePalette(night);
  // Viewport pixel height, to match ortho zoom ⇄ perspective distance on toggle.
  // Only changes on resize, so this doesn't re-render during a drag.
  const viewportH = useThree((s) => s.size.height);

  return (
    <>
      <color attach="background" args={[pal.viewport]} />

      {projection === 'ortho' ? (
        <OrthographicCamera makeDefault {...orthoInit()} near={-100} far={100} />
      ) : (
        <PerspectiveCamera
          makeDefault
          {...perspInit(viewportH)}
          fov={PERSP_FOV}
          near={0.01}
          far={1000}
        />
      )}

      <ambientLight intensity={0.65} />
      <hemisphereLight intensity={0.35} />
      <directionalLight
        position={[6, 12, 8]}
        intensity={1.15}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0002}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-camera-near={0.1}
        shadow-camera-far={40}
      />

      <Grid
        args={[40, 40]}
        infiniteGrid
        cellSize={0.1}
        cellThickness={0.6}
        cellColor={pal.gridCell}
        sectionSize={0.5}
        sectionThickness={1}
        sectionColor={pal.gridSection}
        fadeDistance={30}
        fadeStrength={1.5}
        followCamera={false}
      />

      <PipeLayer />
      <FormedLayer />
      <FittingLayer />
      <IntersectionLayer />

      {/* ground-plane pointer target + shadow catcher + draw preview */}
      <DrawController />

      {/* endpoint drag handles for the selected member */}
      {tool === 'select' && <SelectionHandles />}
      <PivotLayer />

      {/* middle = pan, right = free rotate; left is reserved (drawing / select
          / future marquee), so it never orbits. `key={projection}` remounts the
          controls onto the new default camera on toggle; the target comes from
          the shared pose so the view doesn't reset. */}
      <OrbitControls
        key={projection}
        makeDefault
        enableDamping
        zoomToCursor
        target={getCameraPose().target}
        mouseButtons={{ MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }}
      />
      <CameraPoseSync />

      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#d64545', '#3d9950', '#2a78d6']} labelColor="#fff" />
      </GizmoHelper>

      <GeometryAnimator />
      <VelocityZoom />
      <DebugBridge />
    </>
  );
}

/** Velocity-aware wheel zoom: scale OrbitControls' per-tick zoom step by how
 * fast the wheel is spinning, so a quick flick covers ground while a slow
 * scroll stays fine. Runs in the capture phase so the updated zoomSpeed is in
 * place before OrbitControls handles the same wheel event. */
function VelocityZoom() {
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as { zoomSpeed: number } | null;
  useEffect(() => {
    if (!controls) return;
    const el = gl.domElement;
    const BASE = controls.zoomSpeed;
    let last = performance.now();
    let vel = 0; // smoothed wheel magnitude per ms
    const onWheel = (e: WheelEvent) => {
      const now = performance.now();
      const dt = Math.max(1, now - last);
      last = now;
      // fade prior velocity over ~130 ms, then add this tick's instantaneous
      // speed (bigger/faster deltas ⇒ more) so rapid flicks accumulate
      vel = vel * Math.exp(-dt / 130) + Math.abs(e.deltaY) / dt;
      controls.zoomSpeed = Math.min(5, Math.max(0.6, 0.7 + vel * 0.9));
    };
    el.addEventListener('wheel', onWheel, { passive: true, capture: true });
    return () => {
      el.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
      controls.zoomSpeed = BASE;
    };
  }, [gl, controls]);
  return null;
}

/** Records the live camera pose (position / target / zoom) into cameraStore on
 * every OrbitControls change, so a projection toggle — which remounts the
 * camera + controls — can restore the same view instead of snapping back to the
 * default isometric framing. Mirrors VelocityZoom's `useThree(s => s.controls)`
 * access; no React re-renders (writes module state only). */
function CameraPoseSync() {
  const controls = useThree((s) => s.controls) as {
    target: { x: number; y: number; z: number };
    addEventListener: (t: string, cb: () => void) => void;
    removeEventListener: (t: string, cb: () => void) => void;
  } | null;
  const camera = useThree((s) => s.camera);
  const height = useThree((s) => s.size.height);
  const projection = useEditorStore((s) => s.projection);
  useEffect(() => {
    if (!controls) return;
    const onChange = () => {
      const p = camera.position;
      const t = controls.target;
      recordPose(
        projection,
        [p.x, p.y, p.z] as V3,
        [t.x, t.y, t.z] as V3,
        (camera as { zoom?: number }).zoom ?? 1,
        height,
      );
    };
    onChange(); // capture the initial pose too (so the first toggle is clean)
    controls.addEventListener('change', onChange);
    return () => controls.removeEventListener('change', onChange);
  }, [controls, camera, height, projection]);
  return null;
}

// Ease at ~40 ms time-constant; skip animation past this many nodes (e.g. the
// T-rex) so large designs never pay per-frame re-renders.
const EASE_TAU = 0.045;
const MAX_ANIMATED_NODES = 160;

/** Drives the eased render positions once per frame (see state/animStore).
 * When lengths are locked and pivots exist, the target positions come from the
 * solver (pose kinematics); otherwise from the document. */
function GeometryAnimator() {
  useFrame((_, dt) => {
    const design = useAppStore.getState().current;
    if (!design) return;
    const simulating = useEditorStore.getState().simulating;

    // Play mode: step the CrashCat rigid-body world and render body positions.
    if (simulating) {
      const hash = physicsTopoHash(design);
      if (!physicsActive() || activeTopoHash() !== hash) startPhysics(design);
      stepPhysics(dt);
      const pos = physicsNodePositions();
      const target = design.nodes.map((n) => ({ id: n.id, position: pos[n.id] ?? n.position }));
      stepEasing(target, 1, true); // physics is already smooth — no extra easing
      bumpAnim();
      return;
    }
    if (physicsActive()) stopPhysics(); // just stopped — sim disposed, revert to doc

    let target: Array<{ id: string; position: Vec3 }> = design.nodes;
    if (design.lengthsLocked && design.pivots.length) {
      const r = solve(design, { lengthsLocked: true, pivotAngles: pivotAnglesOf(design) }, 'pose');
      target = design.nodes.map((n) => ({
        id: n.id,
        position: r.nodePositions[n.id] ?? n.position,
      }));
    }
    const instant = design.nodes.length > MAX_ANIMATED_NODES;
    const alpha = Math.min(1, 1 - Math.exp(-dt / EASE_TAU));
    if (stepEasing(target, alpha, instant)) bumpAnim();
  });
  return null;
}

/** Publishes camera / controls / projection seams onto window.__pvc so scripted
 * checks can verify the viewport (e.g. that a handle drag doesn't leave
 * OrbitControls disabled). No-op for real users. */
function DebugBridge() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as {
    enabled: boolean;
    target?: { x: number; y: number; z: number };
  } | null;
  useEffect(() => {
    const w = window as unknown as { __pvc?: Record<string, unknown> };
    if (!w.__pvc) w.__pvc = {};
    w.__pvc.getCameraPos = () => ({
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    });
    w.__pvc.getCameraTarget = () =>
      controls?.target
        ? { x: controls.target.x, y: controls.target.y, z: controls.target.z }
        : null;
    w.__pvc.isControlsEnabled = () => (controls ? controls.enabled : null);
    w.__pvc.getEasedPos = (id: string) => easedPos(id) ?? null;
    // orthographic zoom factor (rises as you zoom in) — for verifying wheel zoom
    w.__pvc.getZoom = () => (camera as { zoom?: number }).zoom ?? null;
    w.__pvc.screenOf = (p: { x: number; y: number; z: number }) => {
      const rect = gl.domElement.getBoundingClientRect();
      const v = new Vector3(p.x, p.y, p.z).project(camera);
      return {
        x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
      };
    };
  });
  return null;
}
