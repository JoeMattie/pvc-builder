import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from './editorStore';

describe('editorStore tool palette layout', () => {
  beforeEach(() => {
    useEditorStore.getState().resetTransient();
    useEditorStore.getState().setToolPaletteLayout('horizontal');
    useEditorStore.getState().setRendererEffects(false);
  });

  it('setToolPaletteLayout sets the layout directly', () => {
    useEditorStore.getState().setToolPaletteLayout('vertical');
    expect(useEditorStore.getState().toolPaletteLayout).toBe('vertical');
  });

  it('toggleToolPaletteLayout flips horizontal <-> vertical', () => {
    useEditorStore.getState().toggleToolPaletteLayout();
    expect(useEditorStore.getState().toolPaletteLayout).toBe('vertical');
    useEditorStore.getState().toggleToolPaletteLayout();
    expect(useEditorStore.getState().toolPaletteLayout).toBe('horizontal');
  });

  it('resetTransient preserves toolPaletteLayout and rendererEffects, resets the rest', () => {
    const s = useEditorStore.getState();
    s.setToolPaletteLayout('vertical');
    s.setRendererEffects(true);
    s.setTool('draw');
    s.setSelection(['m1']);
    s.resetTransient();
    const next = useEditorStore.getState();
    expect(next.toolPaletteLayout).toBe('vertical');
    expect(next.rendererEffects).toBe(true);
    expect(next.tool).toBe('select');
    expect(next.selectedIds).toEqual([]);
  });
});
