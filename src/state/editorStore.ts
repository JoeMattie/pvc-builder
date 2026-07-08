import { create } from 'zustand';

// Transient editor state: the current tool, selection, and viewport
// projection (planfile §2). NEVER persisted and NEVER part of undo history —
// that is the document's job (appStore). Resolved fittings will also be cached
// here from Phase 2 on.

/** Active editing tool. v1 ships select; draw/formed/pivot arrive in later
 * phases. */
export type Tool = 'select' | 'draw';

/** Camera projection: orthographic isometric by default, one-toggle
 * perspective (planfile §1). */
export type Projection = 'ortho' | 'perspective';

export interface EditorState {
  tool: Tool;
  projection: Projection;
  selectedIds: string[];
  setTool(tool: Tool): void;
  setProjection(projection: Projection): void;
  toggleProjection(): void;
  setSelection(ids: string[]): void;
  /** reset everything transient (e.g. when switching designs) */
  resetTransient(): void;
}

const INITIAL = {
  tool: 'select' as Tool,
  projection: 'ortho' as Projection,
  selectedIds: [] as string[],
};

export const useEditorStore = create<EditorState>()((set, get) => ({
  ...INITIAL,
  setTool(tool) {
    set({ tool });
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
  resetTransient() {
    set({ ...INITIAL });
  },
}));
