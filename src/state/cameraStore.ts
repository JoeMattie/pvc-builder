// A camera pose shared across the projection toggle. Toggling ortho ⇄
// perspective remounts the camera + OrbitControls (the camera type changes, so
// the controls must rebind to the new default camera); without this the new
// camera mounts at the default isometric framing and the user's view snaps
// back. We hold the last position/target/zoom OUTSIDE React (like animStore) and
// restore them on mount, matching visible scale between the two projections so
// the toggle doesn't jump.

export type V3 = [number, number, number];

// Default isometric framing — the values Scene used before this store existed,
// so the first mount is byte-for-byte the old behaviour.
const ISO_DIR: V3 = [3.2, 3.2, 3.2];
const DEFAULT_ZOOM = 230;
export const PERSP_FOV = 40;

interface Pose {
  position: V3;
  target: V3;
  /** orthographic zoom factor (kept meaningful even while perspective is active,
   * so the next ortho mount matches the perspective scale) */
  zoom: number;
}

const pose: Pose = {
  position: [...ISO_DIR],
  target: [0, 0, 0],
  zoom: DEFAULT_ZOOM,
};

export function getCameraPose(): { position: V3; target: V3; zoom: number } {
  return { position: [...pose.position], target: [...pose.target], zoom: pose.zoom };
}

// A monotonically-rising version bumped whenever code requests a new pose
// imperatively (a view-preset click or a document restore). A ViewController
// inside the Canvas watches it and snaps the live camera + controls to `pose`.
let poseVersion = 0;
export function getPoseVersion(): number {
  return poseVersion;
}

/** Imperatively set the shared pose (preset / restore) and signal the
 * ViewController to apply it to the live camera. */
export function requestPose(position: V3, target: V3, zoom?: number): void {
  pose.position = [...position];
  pose.target = [...target];
  if (typeof zoom === 'number' && zoom > 0) pose.zoom = zoom;
  poseVersion++;
}

/** Reset to the default isometric framing (used when opening a document that
 * stored no camera, so it doesn't inherit the previous document's view). */
export function resetPose(): void {
  requestPose([...ISO_DIR], [0, 0, 0], DEFAULT_ZOOM);
}

/** Named camera directions (view presets). Iso corners + the six orthographic
 * faces; `top`/faces get a tiny bias so the up-vector never degenerates. */
export const VIEW_PRESETS = {
  'iso-ne': [3.2, 3.2, 3.2],
  'iso-nw': [-3.2, 3.2, 3.2],
  'iso-se': [3.2, 3.2, -3.2],
  'iso-sw': [-3.2, 3.2, -3.2],
  top: [0, 5, 0.0001],
  front: [0, 0.0001, 5],
  back: [0, 0.0001, -5],
  right: [5, 0.0001, 0],
  left: [-5, 0.0001, 0],
} as const satisfies Record<string, V3>;
export type ViewName = keyof typeof VIEW_PRESETS;

/** Snap the camera to a named view — a FULL camera reset, not just the angle:
 * target returns to the origin at the default framing distance and zoom,
 * looking along the preset direction. */
export function setView(name: ViewName): void {
  const dir = VIEW_PRESETS[name];
  const dist = Math.hypot(...ISO_DIR);
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  requestPose(
    [(dir[0] / len) * dist, (dir[1] / len) * dist, (dir[2] / len) * dist],
    [0, 0, 0],
    DEFAULT_ZOOM,
  );
}

function distance(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const HALF_FOV_RAD = (PERSP_FOV * Math.PI) / 180 / 2;

/** World height an orthographic camera shows at `zoom` for a viewport `viewportH`
 * pixels tall. */
function orthoVisibleHeight(zoom: number, viewportH: number): number {
  return viewportH / zoom;
}
/** World height a perspective camera shows at distance `d` from its target. */
function perspVisibleHeight(d: number): number {
  return 2 * d * Math.tan(HALF_FOV_RAD);
}
/** The perspective distance that shows `visibleHeight` world units. */
function perspDistanceFor(visibleHeight: number): number {
  return visibleHeight / (2 * Math.tan(HALF_FOV_RAD));
}

/** Record the live pose from the active camera + controls. `zoom` is stored so
 * that whichever projection mounts next lands at a matching visible scale:
 * ortho stores its zoom directly; perspective converts its distance into the
 * equivalent ortho zoom. */
export function recordPose(
  projection: 'ortho' | 'perspective',
  position: V3,
  target: V3,
  cameraZoom: number,
  viewportH: number,
): void {
  pose.position = [...position];
  pose.target = [...target];
  if (projection === 'ortho') {
    pose.zoom = cameraZoom;
  } else if (viewportH > 0) {
    const visH = perspVisibleHeight(distance(position, target));
    if (visH > 1e-9) pose.zoom = viewportH / visH;
  }
}

/** Initial props for the orthographic camera on (re)mount. */
export function orthoInit(): { position: V3; zoom: number } {
  return { position: [...pose.position], zoom: pose.zoom };
}

/** Initial position for the perspective camera on (re)mount: same view direction
 * and target as the stored pose, placed at the distance that reproduces the
 * stored ortho scale. */
export function perspInit(viewportH: number): { position: V3 } {
  const dir: V3 = [
    pose.position[0] - pose.target[0],
    pose.position[1] - pose.target[1],
    pose.position[2] - pose.target[2],
  ];
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = viewportH > 0 ? perspDistanceFor(orthoVisibleHeight(pose.zoom, viewportH)) : len;
  return {
    position: [
      pose.target[0] + (dir[0] / len) * d,
      pose.target[1] + (dir[1] / len) * d,
      pose.target[2] + (dir[2] / len) * d,
    ],
  };
}
