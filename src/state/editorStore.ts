import { create } from 'zustand';
import type { NominalSize } from '../schema';

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
  setTool(tool: Tool): void;
  setProjection(projection: Projection): void;
  toggleProjection(): void;
  setSelection(ids: string[]): void;
  setDrawSize(size: NominalSize): void;
  setDrawingFrom(nodeId: string | null): void;
  /** reset everything transient (e.g. when switching designs) */
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
  resetTransient() {
    set({ ...INITIAL });
  },
}));
