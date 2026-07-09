import { create } from 'zustand';
import { DEFAULT_GRID_M } from '../design/snapping';
import { getSnapPref, setSnapPref } from '../persistence/prefs';
import type { MeasurementEnd, NominalSize, Vec3 } from '../schema';

/** Snapping configuration (the snap pill). A workspace preference, persisted
 * to localStorage, never in the document. */
export interface SnapSettings {
  /** world grid increment in metres; 0 = no grid snapping */
  gridStepM: number;
  /** snap to existing nodes (pipe ends / junctions) */
  snapToEnds: boolean;
  /** snap to points along a pipe's length */
  snapToPipes: boolean;
  /** SketchUp-style world-axis inference while drawing */
  axisInference: boolean;
}

const DEFAULT_SNAP: SnapSettings = {
  gridStepM: DEFAULT_GRID_M, // 1/4"
  snapToEnds: true,
  snapToPipes: true,
  axisInference: true,
};

function initialSnap(): SnapSettings {
  const pref = getSnapPref();
  // migrate the old combined `snapToPoints` flag to both new toggles
  const legacy = pref?.snapToPoints;
  return {
    gridStepM: pref?.gridStepM ?? DEFAULT_SNAP.gridStepM,
    snapToEnds: pref?.snapToEnds ?? legacy ?? DEFAULT_SNAP.snapToEnds,
    snapToPipes: pref?.snapToPipes ?? legacy ?? DEFAULT_SNAP.snapToPipes,
    axisInference: pref?.axisInference ?? DEFAULT_SNAP.axisInference,
  };
}

// Transient editor state: the current tool, selection, viewport projection, and
// in-progress draw session (planfile §2). NEVER persisted and NEVER part of
// undo history — that is the document's job (appStore). Resolved fittings will
// also be cached here from Phase 2 on.

/** Active editing tool. `formed` draws a heat-bent spline; `move` translates the
 * selected member along a world axis via arrow handles; `rotate` swings it about
 * a ring gizmo. Pivots are created by right-clicking a pipe join (no tool). */
export type Tool = 'select' | 'draw' | 'formed' | 'move' | 'rotate' | 'measure' | 'bend';

/** Camera projection: orthographic isometric by default, one-toggle
 * perspective (planfile §1). */
export type Projection = 'ortho' | 'perspective';

export interface EditorState {
  tool: Tool;
  projection: Projection;
  selectedIds: string[];
  /** a first-class selected joint (its hardware is highlighted, not a pipe) —
   * mutually exclusive with `selectedIds` */
  selectedJointId: string | null;
  /** the size the draw tool lays pipe at (from the pillbox) */
  drawSize: NominalSize;
  /** while drawing a path, the node the next segment extends from (null = the
   * pen is up / no path in progress) */
  drawingFromNodeId: string | null;
  /** when a path STARTED on a pipe body, the run it landed on — the branch member
   * doesn't exist until the first segment, so the on-body union is created then */
  drawStartWrapMember: string | null;
  /** the committed points of the in-progress formed (heat-bent) pipe */
  formedPoints: Vec3[];
  /** tape measure: the first placed end (waiting for the second), or null */
  measureFrom: MeasurementEnd | null;
  /** tape measure: the just-placed measurement whose perpendicular offset is
   * being set by the next click/move, or null */
  measureAdjustId: string | null;
  /** the currently selected measurement (highlighted; Delete removes it) */
  selectedMeasurementId: string | null;
  /** Bend tool: keep the pipe's end tangents axial (smooth bend away from ends) */
  bendLockEndAngles: boolean;
  /** Bend tool: hold the material (developed) length — the far end draws in as
   * you bend, instead of the pipe growing */
  bendLengthLock: boolean;
  /** while drawing, the length typed into the length pill (empty = not typing) */
  drawLength: string;
  /** the current draw direction (unit, from the path cursor toward the preview) —
   * so a typed length can be committed along it */
  drawDirection: Vec3 | null;
  /** running the CrashCat rigid-body simulation (Play mode) */
  simulating: boolean;
  /** the in-progress rubber-band selection rectangle (screen/client px), or null */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  /** an open right-click join menu: the pipe end being edited + screen anchor */
  joinMenu: { nodeId: string; moverId: string; x: number; y: number } | null;
  /** an open right-click size switcher: the pipes to resize + screen anchor */
  sizeMenu: { memberIds: string[]; x: number; y: number } | null;
  /** snapping configuration (the snap pill) */
  snap: SnapSettings;
  setTool(tool: Tool): void;
  setProjection(projection: Projection): void;
  toggleProjection(): void;
  setSelection(ids: string[]): void;
  selectJoint(jointId: string | null): void;
  setDrawSize(size: NominalSize): void;
  setDrawingFrom(nodeId: string | null): void;
  setDrawStartWrap(memberId: string | null): void;
  pushFormedPoint(p: Vec3): void;
  clearFormedPoints(): void;
  setMeasureFrom(end: MeasurementEnd | null): void;
  setMeasureAdjustId(id: string | null): void;
  selectMeasurement(id: string | null): void;
  setBendLockEndAngles(on: boolean): void;
  setBendLengthLock(on: boolean): void;
  setDrawLength(s: string): void;
  setDrawDirection(v: Vec3 | null): void;
  setSimulating(on: boolean): void;
  setMarquee(m: { x0: number; y0: number; x1: number; y1: number } | null): void;
  openJoinMenu(menu: { nodeId: string; moverId: string; x: number; y: number }): void;
  closeJoinMenu(): void;
  openSizeMenu(menu: { memberIds: string[]; x: number; y: number }): void;
  closeSizeMenu(): void;
  setSnap(patch: Partial<SnapSettings>): void;
  /** reset everything transient (e.g. when switching designs) — keeps snap */
  resetTransient(): void;
}

const INITIAL = {
  tool: 'select' as Tool,
  projection: 'ortho' as Projection,
  selectedIds: [] as string[],
  selectedJointId: null as string | null,
  drawSize: '3/4"' as NominalSize,
  drawingFromNodeId: null as string | null,
  drawStartWrapMember: null as string | null,
  formedPoints: [] as Vec3[],
  measureFrom: null as MeasurementEnd | null,
  measureAdjustId: null as string | null,
  selectedMeasurementId: null as string | null,
  bendLockEndAngles: true,
  bendLengthLock: false,
  drawLength: '',
  drawDirection: null as Vec3 | null,
  simulating: false,
  marquee: null as { x0: number; y0: number; x1: number; y1: number } | null,
  joinMenu: null as { nodeId: string; moverId: string; x: number; y: number } | null,
  sizeMenu: null as { memberIds: string[]; x: number; y: number } | null,
};

export const useEditorStore = create<EditorState>()((set, get) => ({
  ...INITIAL,
  snap: initialSnap(),
  setTool(tool) {
    // leaving a drawing tool ends any path in progress
    set({
      tool,
      drawingFromNodeId: tool === 'draw' ? get().drawingFromNodeId : null,
      drawStartWrapMember: tool === 'draw' ? get().drawStartWrapMember : null,
      formedPoints: tool === 'formed' ? get().formedPoints : [],
      measureFrom: tool === 'measure' ? get().measureFrom : null,
      measureAdjustId: tool === 'measure' ? get().measureAdjustId : null,
      drawLength: '',
      drawDirection: null,
    });
  },
  setProjection(projection) {
    set({ projection });
  },
  toggleProjection() {
    set({ projection: get().projection === 'ortho' ? 'perspective' : 'ortho' });
  },
  setSelection(ids) {
    set({ selectedIds: ids, selectedJointId: null, selectedMeasurementId: null });
  },
  selectJoint(jointId) {
    set({ selectedJointId: jointId, selectedIds: [], selectedMeasurementId: null });
  },
  setDrawSize(size) {
    set({ drawSize: size });
  },
  setDrawingFrom(nodeId) {
    set({ drawingFromNodeId: nodeId });
  },
  setDrawStartWrap(memberId) {
    set({ drawStartWrapMember: memberId });
  },
  pushFormedPoint(p) {
    set({ formedPoints: [...get().formedPoints, p] });
  },
  clearFormedPoints() {
    set({ formedPoints: [] });
  },
  setMeasureFrom(end) {
    set({ measureFrom: end });
  },
  setMeasureAdjustId(id) {
    set({ measureAdjustId: id });
  },
  selectMeasurement(id) {
    set({ selectedMeasurementId: id, selectedIds: [], selectedJointId: null });
  },
  setBendLockEndAngles(on) {
    set({ bendLockEndAngles: on });
  },
  setBendLengthLock(on) {
    set({ bendLengthLock: on });
  },
  setDrawLength(s) {
    set({ drawLength: s });
  },
  setDrawDirection(v) {
    set({ drawDirection: v });
  },
  setSimulating(on) {
    // leaving a drawing tool / selection isn't needed; just toggle the sim
    set({ simulating: on });
  },
  setMarquee(m) {
    set({ marquee: m });
  },
  openJoinMenu(menu) {
    set({ joinMenu: menu, sizeMenu: null });
  },
  closeJoinMenu() {
    set({ joinMenu: null });
  },
  openSizeMenu(menu) {
    set({ sizeMenu: menu, joinMenu: null });
  },
  closeSizeMenu() {
    set({ sizeMenu: null });
  },
  setSnap(patch) {
    const next = { ...get().snap, ...patch };
    setSnapPref(next);
    set({ snap: next });
  },
  resetTransient() {
    set({ ...INITIAL }); // snap is a workspace pref, left untouched
  },
}));
