import { create } from 'zustand';
import { DEFAULT_GRID_M } from '../design/snapping';
import { getSnapPref, setSnapPref } from '../persistence/prefs';
import type { NominalSize } from '../schema';

/** Snapping configuration (the snap pill). A workspace preference, persisted
 * to localStorage, never in the document. */
export interface SnapSettings {
  /** world grid increment in metres; 0 = no grid snapping */
  gridStepM: number;
  /** snap to existing nodes / on-pipe points */
  snapToPoints: boolean;
  /** SketchUp-style world-axis inference while drawing */
  axisInference: boolean;
}

const DEFAULT_SNAP: SnapSettings = {
  gridStepM: DEFAULT_GRID_M, // 1/4"
  snapToPoints: true,
  axisInference: true,
};

function initialSnap(): SnapSettings {
  const pref = getSnapPref();
  return {
    gridStepM: pref?.gridStepM ?? DEFAULT_SNAP.gridStepM,
    snapToPoints: pref?.snapToPoints ?? DEFAULT_SNAP.snapToPoints,
    axisInference: pref?.axisInference ?? DEFAULT_SNAP.axisInference,
  };
}

// Transient editor state: the current tool, selection, viewport projection, and
// in-progress draw session (planfile §2). NEVER persisted and NEVER part of
// undo history — that is the document's job (appStore). Resolved fittings will
// also be cached here from Phase 2 on.

/** Active editing tool. v1 ships select + draw; formed/pivot arrive later. */
export type Tool = 'select' | 'draw';

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
  /** snapping configuration (the snap pill) */
  snap: SnapSettings;
  setTool(tool: Tool): void;
  setProjection(projection: Projection): void;
  toggleProjection(): void;
  setSelection(ids: string[]): void;
  setDrawSize(size: NominalSize): void;
  setDrawingFrom(nodeId: string | null): void;
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
};

export const useEditorStore = create<EditorState>()((set, get) => ({
  ...INITIAL,
  snap: initialSnap(),
  setTool(tool) {
    // leaving the draw tool ends any path in progress
    set({ tool, drawingFromNodeId: tool === 'draw' ? get().drawingFromNodeId : null });
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
  setSnap(patch) {
    const next = { ...get().snap, ...patch };
    setSnapPref(next);
    set({ snap: next });
  },
  resetTransient() {
    set({ ...INITIAL }); // snap is a workspace pref, left untouched
  },
}));
