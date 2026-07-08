// The editing actions the draw/select tools and the __pvc debug hook both call
// — one place so scripted checks drive exactly what the pointer does. Each
// bridges pure snapping (design/snapping) + pure docOps (design/docOps) into
// the appStore (undo/autosave) and transient editorStore.
import {
  appendPipe,
  connectPipe,
  memberEndpoints,
  nodeById,
  setMemberLengthM,
  setNodePosition,
  startPath,
} from '../design/docOps';
import {
  defaultSnapTolerances,
  type SnapContext,
  type SnapResult,
  snapPoint,
} from '../design/snapping';
import type { Design, Vec3 } from '../schema';
import { useAppStore } from './appStore';
import { useEditorStore } from './editorStore';

function segmentsOf(design: Design, excludeNode?: string): SnapContext['segments'] {
  const out: SnapContext['segments'] = [];
  for (const m of design.members) {
    if (excludeNode && (m.nodeA === excludeNode || m.nodeB === excludeNode)) continue;
    const e = memberEndpoints(design, m);
    if (e) out.push(e);
  }
  return out;
}

/** Snap context for the draw tool: all nodes + segments, with axis inference
 * anchored at the current path start. */
export function buildDrawSnapContext(): SnapContext {
  const design = useAppStore.getState().current;
  const fromId = useEditorStore.getState().drawingFromNodeId;
  const from = design && fromId ? nodeById(design, fromId)?.position : undefined;
  return {
    nodes: design ? design.nodes.map((n) => ({ id: n.id, position: n.position })) : [],
    segments: design ? segmentsOf(design) : [],
    fromNode: from,
    ...defaultSnapTolerances(),
  };
}

export function snapDrawPoint(raw: Vec3): SnapResult {
  return snapPoint(raw, buildDrawSnapContext());
}

/** Place the next draw point (pen click): start a path, extend it, or join an
 * existing node. Returns the resolved snap for callers that want feedback. */
export function placeDrawPoint(raw: Vec3): SnapResult {
  const app = useAppStore.getState();
  const editor = useEditorStore.getState();
  const snap = snapDrawPoint(raw);
  const size = editor.drawSize;
  const fromId = editor.drawingFromNodeId;

  if (!fromId) {
    if (snap.kind === 'node' && snap.nodeId) {
      editor.setDrawingFrom(snap.nodeId);
    } else {
      let newId = '';
      app.updateCurrent((d) => {
        const s = startPath(d, snap.position);
        newId = s.nodeId;
        return s.design;
      });
      editor.setDrawingFrom(newId);
    }
    return snap;
  }

  if (snap.nodeId === fromId) return snap; // clicked the current cursor — ignore

  if (snap.kind === 'node' && snap.nodeId) {
    app.updateCurrent((d) => connectPipe(d, fromId, snap.nodeId as string, size).design);
    editor.setDrawingFrom(snap.nodeId);
  } else {
    let nextId = '';
    app.updateCurrent((d) => {
      const r = appendPipe(d, fromId, snap.position, size);
      nextId = r.nodeId;
      return r.design;
    });
    editor.setDrawingFrom(nextId);
  }
  return snap;
}

/** End the current path (Escape / Enter / right-click / double-click). */
export function finishPath(): void {
  useEditorStore.getState().setDrawingFrom(null);
}

export function selectMember(memberId: string): void {
  useEditorStore.getState().setSelection([memberId]);
}

export function clearSelection(): void {
  useEditorStore.getState().setSelection([]);
}

/** Drag a node to a new ground point, snapping to other geometry (the dragged
 * node is excluded from its own snap targets). */
export function dragNodeTo(nodeId: string, raw: Vec3): void {
  const design = useAppStore.getState().current;
  if (!design) return;
  const snap = snapPoint(raw, {
    nodes: design.nodes
      .filter((n) => n.id !== nodeId)
      .map((n) => ({ id: n.id, position: n.position })),
    segments: segmentsOf(design, nodeId),
    fromNode: undefined,
    ...defaultSnapTolerances(),
  });
  useAppStore.getState().updateCurrent((d) => setNodePosition(d, nodeId, snap.position));
}

/** Set an exact length on a member (length editor). */
export function setMemberLength(memberId: string, lengthM: number): void {
  useAppStore.getState().updateCurrent((d) => setMemberLengthM(d, memberId, lengthM));
}
