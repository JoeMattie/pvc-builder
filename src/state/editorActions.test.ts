import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { memberLengthM } from '../design/docOps';
import { createEmptyDesign, type Vec3 } from '../schema';
import { useAppStore } from './appStore';
import {
  clearSelection,
  dragMemberEndLength,
  dragNodeTo,
  finishPath,
  placeDrawPoint,
  selectMember,
  setMemberLength,
} from './editorActions';
import { useEditorStore } from './editorStore';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Drive the real draw action (the exact path the pointer + __pvc hook use)
 * over a design held in the live stores. */
beforeEach(() => {
  useAppStore.setState({ current: createEmptyDesign('d', 'Path'), saveState: 'saved' });
  useEditorStore.getState().resetTransient();
  useEditorStore.getState().setTool('draw');
});

const design = () => useAppStore.getState().current!;

describe('draw tool integration (snapping → docOps → store)', () => {
  it('draws a 3-pipe path whose lengths match the (grid-aligned) input within 1e-6', () => {
    // grid-aligned, axis-aligned points so snapping returns them unchanged
    const pts = [V(0, 0, 0), V(0.3048, 0, 0), V(0.3048, 0, 0.254), V(0, 0, 0.254)];
    for (const p of pts) placeDrawPoint(p);

    const d = design();
    expect(d.members).toHaveLength(3);
    const lengths = d.members.map((m) => memberLengthM(d, m));
    expect(lengths[0]).toBeCloseTo(0.3048, 6);
    expect(lengths[1]).toBeCloseTo(0.254, 6);
    expect(lengths[2]).toBeCloseTo(0.3048, 6);
  });

  it('advances the path cursor after each placed point', () => {
    placeDrawPoint(V(0, 0, 0));
    const first = useEditorStore.getState().drawingFromNodeId;
    expect(first).not.toBeNull();
    placeDrawPoint(V(0.3048, 0, 0));
    expect(useEditorStore.getState().drawingFromNodeId).not.toBe(first);
  });

  it('joins an existing node instead of adding a duplicate (closes a loop)', () => {
    for (const p of [V(0, 0, 0), V(0.3048, 0, 0), V(0.3048, 0, 0.254), V(0, 0, 0.254)]) {
      placeDrawPoint(p);
    }
    const before = design();
    expect(before.nodes).toHaveLength(4);
    // click back on the start node → connect without a new node
    placeDrawPoint(V(0, 0, 0));
    const after = design();
    expect(after.nodes).toHaveLength(4);
    expect(after.members).toHaveLength(4);
  });

  it('finishPath lifts the pen', () => {
    placeDrawPoint(V(0, 0, 0));
    finishPath();
    expect(useEditorStore.getState().drawingFromNodeId).toBeNull();
  });

  it('carries the pillbox size onto drawn members', () => {
    useEditorStore.getState().setDrawSize('1/2"');
    placeDrawPoint(V(0, 0, 0));
    placeDrawPoint(V(0.3048, 0, 0));
    expect(design().members[0]!.size).toBe('1/2"');
  });
});

describe('select + edit integration', () => {
  it('sets an exact member length through the length editor action', () => {
    placeDrawPoint(V(0, 0, 0));
    placeDrawPoint(V(0.3048, 0, 0));
    const id = design().members[0]!.id;
    setMemberLength(id, 0.5);
    expect(memberLengthM(design(), design().members[0]!)).toBeCloseTo(0.5, 6);
  });

  it('drags an endpoint node, snapping to the world grid', () => {
    placeDrawPoint(V(0, 0, 0));
    placeDrawPoint(V(0.3048, 0, 0));
    useEditorStore.getState().setTool('select');
    const nodeB = design().members[0]!.nodeB;
    dragNodeTo(nodeB, V(0.507, 0, 0.001)); // near 0.508 (20") grid point
    const moved = design().nodes.find((n) => n.id === nodeB)!;
    expect(moved.position.x).toBeCloseTo(0.508, 6);
    expect(moved.position.z).toBeCloseTo(0, 6);
  });

  it('selects and clears selection', () => {
    placeDrawPoint(V(0, 0, 0));
    placeDrawPoint(V(0.3048, 0, 0));
    const id = design().members[0]!.id;
    selectMember(id);
    expect(useEditorStore.getState().selectedIds).toEqual([id]);
    clearSelection();
    expect(useEditorStore.getState().selectedIds).toEqual([]);
  });
});

describe('length arrows + Shift-lock', () => {
  it('resizes a pipe along its own axis via the end arrow (opposite end fixed)', () => {
    placeDrawPoint(V(0, 0, 0));
    placeDrawPoint(V(0.3048, 0, 0)); // pipe A(0,0,0) → B(0.3048,0,0)
    const m = design().members[0]!;
    // drag B's arrow: fixed end = A, axis = +X, cursor off-axis at ~0.5 m
    dragMemberEndLength(m.nodeB, V(0, 0, 0), V(1, 0, 0), V(0.5, 0, 0.2));
    const b = design().nodes.find((n) => n.id === m.nodeB)!;
    expect(b.position.x).toBeCloseTo(0.508, 6); // 0.5 → 20" grid
    expect(b.position.z).toBeCloseTo(0, 9); // stays on the axis
  });

  it('locks a free move to the Z axis with Shift, anchored at drag start', () => {
    placeDrawPoint(V(0, 0, 0));
    placeDrawPoint(V(0.3048, 0, 0));
    useEditorStore.getState().setTool('select');
    const nodeB = design().members[0]!.nodeB;
    const anchor = V(0.3048, 0, 0);
    // cursor drifts mostly along +Z from the anchor → lock to Z, x unchanged
    dragNodeTo(nodeB, V(0.42, 0, 0.31), { lockAxis: true, anchor });
    const moved = design().nodes.find((n) => n.id === nodeB)!;
    expect(moved.position.x).toBeCloseTo(0.3048, 9);
    expect(moved.position.z).toBeCloseTo(0.3048, 6); // 0.31 → 12" grid
  });
});
