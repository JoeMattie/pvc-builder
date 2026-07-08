import { create } from 'zustand';
import { DEFAULT_GRID_M } from '../design/snapping';
import { getSnapPref, setSnapPref } from '../persistence/prefs';
import type { NominalSize, Vec3 } from '../schema';

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

/** Active editing tool. `formed` draws a heat-bent spline; `pivot` turns a
 * junction into a heat-formed revolute joint; `move` translates the selected
 * member along a world axis via arrow handles. */
export type Tool = 'select' | 'draw' | 'formed' | 'pivot' | 'move' | 'rotate';

/** Camera projection: orthographic isometric by default, one-toggle
 * perspective (planfile §1). */
export type Projection = 'ortho' | 'perspective';

export interface EditorState {
  tool: Tool;
  projection: Projection;
  selectedIds: string[];
  /** the size the draw tool lays pipe at (from the pillbox) */
  drawSize: NominalSize;
  /** while drawing a path, the node the next segment extends from (null = the
   * pen is up / no path in progress) */
  drawingFromNodeId: string | null;
  /** the committed points of the in-progress formed (heat-bent) pipe */
  formedPoints: Vec3[];
  /** running the CrashCat rigid-body simulation (Play mode) */
  simulating: boolean;
  /** snapping configuration (the snap pill) */
  snap: SnapSettings;
  setTool(tool: Tool): void;
  setProjection(projection: Projection): void;
  toggleProjection(): void;
  setSelection(ids: string[]): void;
  setDrawSize(size: NominalSize): void;
  setDrawingFrom(nodeId: string | null): void;
  pushFormedPoint(p: Vec3): void;
  clearFormedPoints(): void;
  setSimulating(on: boolean): void;
  setSnap(patch: Partial<SnapSettings>): void;
  /** reset everything transient (e.g. when switching designs) — keeps snap */
  resetTransient(): void;
}

const INITIAL = {
  tool: 'select' as Tool,
  projection: 'ortho' as Projection,
  selectedIds: [] as string[],
  drawSize: '3/4"' as NominalSize,
  drawingFromNodeId: null as string | null,
  formedPoints: [] as Vec3[],
  simulating: false,
};

export const useEditorStore = create<EditorState>()((set, get) => ({
  ...INITIAL,
  snap: initialSnap(),
  setTool(tool) {
    // leaving a drawing tool ends any path in progress
    set({
      tool,
      drawingFromNodeId: tool === 'draw' ? get().drawingFromNodeId : null,
      formedPoints: tool === 'formed' ? get().formedPoints : [],
    });
  },
  setProjection(projection) {
    set({ projection });
  },
  toggleProjection() {
    set({ projection: get().projection === 'ortho' ? 'perspective' : 'ortho' });
  },
  setSelection(ids) {
    set({ selectedIds: ids });
  },
  setDrawSize(size) {
    set({ drawSize: size });
  },
  setDrawingFrom(nodeId) {
    set({ drawingFromNodeId: nodeId });
  },
  pushFormedPoint(p) {
    set({ formedPoints: [...get().formedPoints, p] });
  },
  clearFormedPoints() {
    set({ formedPoints: [] });
  },
  setSimulating(on) {
    // leaving a drawing tool / selection isn't needed; just toggle the sim
    set({ simulating: on });
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
