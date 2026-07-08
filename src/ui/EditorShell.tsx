import {
  Box,
  ChevronLeft,
  ClipboardList,
  FileDown,
  FileUp,
  Lock,
  LockOpen,
  Moon,
  Play,
  Redo2,
  Square,
  Sun,
  Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { bom } from '../design/bom';
import { deleteMember, memberById, memberLengthM } from '../design/docOps';
import { resolveFittings } from '../design/fittings';
import { analyzeFormed } from '../design/formed';
import { intersectingMembers } from '../design/intersections';
import { exportDesignJson, suggestedFileName } from '../persistence/exportImport';
import type { Vec3 } from '../schema';
import { solve } from '../solver';
import { physicsNodePositions } from '../solver/physics';
import { useAppStore } from '../state/appStore';
import {
  clearSelection,
  createPivotAt,
  dragNodeTo,
  finishFormed,
  finishPath,
  pivotAnglesOf,
  placeDrawPoint,
  placeFormedPoint,
  resetPivots,
  selectMember,
  setMemberLength,
  setPivotAngle,
  setWrapRigid,
  snapDrawPoint,
  translateMemberBy,
} from '../state/editorActions';
import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/themeStore';
import { BomPanel } from './BomPanel';
import { downloadFile } from './lib/download';
import { Pillbox } from './Pillbox';
import { PivotPanel } from './PivotPanel';
import { SelectionPanel } from './SelectionPanel';
import { SnapPill } from './SnapPill';
import { Viewport } from './scene/Viewport';

/** The editor: the 3D viewport plus floating chrome — pillbox, selection
 * inspector, and the view / physics / theme toggles. */
export function EditorShell() {
  // Narrow field subscriptions (not the whole document) so a drag — which
  // mutates the doc every frame — doesn't re-render the chrome.
  const hasDesign = useAppStore((s) => s.current !== null);
  const designName = useAppStore((s) => s.current?.name ?? '');
  const lengthsLocked = useAppStore((s) => s.current?.lengthsLocked ?? false);
  const closeProject = useAppStore((s) => s.closeProject);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const importAndOpen = useAppStore((s) => s.importAndOpen);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);

  const [bomOpen, setBomOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportJson = () => {
    const design = useAppStore.getState().current;
    if (design)
      downloadFile(suggestedFileName(design), exportDesignJson(design), 'application/json');
  };
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await importAndOpen(await file.text());
  };

  const projection = useEditorStore((s) => s.projection);
  const toggleProjection = useEditorStore((s) => s.toggleProjection);
  const simulating = useEditorStore((s) => s.simulating);
  const setSimulating = useEditorStore((s) => s.setSimulating);

  const night = useThemeStore((s) => s.night);
  const toggleNight = useThemeStore((s) => s.toggleNight);

  const setLengthsLocked = (locked: boolean) =>
    updateCurrent((doc) => ({ ...doc, lengthsLocked: locked }));

  // keyboard: tool switches, finish/cancel a path, delete, undo/redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const editor = useEditorStore.getState();
      const typing =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (typing) return;

      if (e.key === 'Escape' || e.key === 'Enter') {
        if (editor.drawingFromNodeId) finishPath();
        else if (editor.formedPoints.length) finishFormed();
        else clearSelection();
      } else if (e.key === ' ') {
        // spacebar → back to the select tool
        e.preventDefault();
        editor.setTool('select');
      } else if (e.key === 'v' || e.key === 'V') {
        editor.setTool('select');
      } else if (e.key === 'd' || e.key === 'D') {
        editor.setTool('draw');
      } else if (e.key === 'm' || e.key === 'M') {
        editor.setTool('move');
      } else if (e.key === 'b' || e.key === 'B' || e.key === 'h' || e.key === 'H') {
        editor.setTool('formed');
      } else if (e.key === 'p' || e.key === 'P') {
        editor.setTool('pivot');
      } else if (e.key === 'r' || e.key === 'R') {
        resetPivots();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = editor.selectedIds[0];
        if (id) {
          updateCurrent((d) => deleteMember(d, id));
          clearSelection();
        }
      }
    };
    // right button ends any path in progress (and never opens a context menu);
    // right-drag still rotates via OrbitControls
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 2) return;
      const s = useEditorStore.getState();
      if (s.drawingFromNodeId) finishPath();
      else if (s.formedPoints.length) finishFormed();
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, [undo, redo, updateCurrent]);

  // test/debug hook (planfile §7): drives exactly what the tools drive, so a
  // scripted check can draw a path and assert the resulting geometry. Merged,
  // not replaced.
  useEffect(() => {
    const w = window as unknown as { __pvc?: Record<string, unknown> };
    if (!w.__pvc) w.__pvc = {};
    const hook = w.__pvc;
    hook.getDoc = () => useAppStore.getState().current;
    hook.getEditor = () => {
      const s = useEditorStore.getState();
      return {
        tool: s.tool,
        projection: s.projection,
        selectedIds: s.selectedIds,
        drawSize: s.drawSize,
        drawingFromNodeId: s.drawingFromNodeId,
        snap: s.snap,
        night: useThemeStore.getState().night,
      };
    };
    hook.setSnap = (patch: Record<string, unknown>) =>
      useEditorStore.getState().setSnap(patch as never);
    hook.getFittings = () => {
      const d = useAppStore.getState().current;
      return d ? resolveFittings(d) : { fittings: [], conflicts: [] };
    };
    hook.getMembers = () => {
      const d = useAppStore.getState().current;
      if (!d) return [];
      return d.members.map((m) => ({
        id: m.id,
        size: m.size,
        nodeA: m.nodeA,
        nodeB: m.nodeB,
        lengthM: memberLengthM(d, m),
      }));
    };
    hook.setTool = (tool: 'select' | 'draw' | 'formed' | 'pivot' | 'move') =>
      useEditorStore.getState().setTool(tool);
    hook.setProjection = (p: 'ortho' | 'perspective') => useEditorStore.getState().setProjection(p);
    hook.setDrawSize = (size: '1/2"' | '3/4"') => useEditorStore.getState().setDrawSize(size);
    hook.setLengthsLocked = (locked: boolean) =>
      useAppStore.getState().updateCurrent((doc) => ({ ...doc, lengthsLocked: locked }));
    hook.setNight = (on: boolean) => useThemeStore.getState().setNight(on);
    // drawing / editing seams (world ground points)
    hook.snap = (raw: Vec3, lockAxis?: boolean) => snapDrawPoint(raw, !!lockAxis);
    hook.draw = (raw: Vec3, lockAxis?: boolean) => placeDrawPoint(raw, !!lockAxis);
    hook.finishPath = () => finishPath();
    hook.drawFormed = (raw: Vec3) => placeFormedPoint(raw);
    hook.finishFormed = () => finishFormed();
    hook.selectMember = (id: string) => selectMember(id);
    hook.clearSelection = () => clearSelection();
    hook.setMemberLength = (id: string, lengthM: number) => setMemberLength(id, lengthM);
    hook.dragNode = (id: string, raw: Vec3) => dragNodeTo(id, raw);
    hook.moveMember = (id: string, delta: Vec3) => translateMemberBy(id, delta);
    hook.getIntersections = () => {
      const d = useAppStore.getState().current;
      return d ? [...intersectingMembers(d)] : [];
    };
    hook.getFormed = (id: string) => {
      const d = useAppStore.getState().current;
      const m = d ? memberById(d, id) : undefined;
      return d && m && m.kind === 'formed' ? analyzeFormed(d, m) : null;
    };
    // heat-wrapped tee seams
    hook.getWraps = () => useAppStore.getState().current?.wraps ?? [];
    hook.setWrapRigid = (wrapId: string, rigid: boolean) => setWrapRigid(wrapId, rigid);
    // pivots / solver seams
    hook.createPivotAt = (nodeId: string) => createPivotAt(nodeId);
    hook.setPivotAngle = (pivotId: string, angleRad: number) => setPivotAngle(pivotId, angleRad);
    hook.getSolve = () => {
      const d = useAppStore.getState().current;
      if (!d) return null;
      return solve(d, { lengthsLocked: d.lengthsLocked, pivotAngles: pivotAnglesOf(d) }, 'pose');
    };
    // BOM + export/import seams
    hook.getBom = () => {
      const d = useAppStore.getState().current;
      return d ? bom(d) : null;
    };
    hook.exportJson = () => {
      const d = useAppStore.getState().current;
      return d ? exportDesignJson(d) : null;
    };
    hook.importJson = (text: string) => useAppStore.getState().importAndOpen(text);
    // physics seams
    hook.setSimulating = (on: boolean) => useEditorStore.getState().setSimulating(on);
    hook.getPhysics = () => physicsNodePositions();
  }, []);

  if (!hasDesign) return null;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Viewport />

      {/* top-left: back + design name */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void closeProject()}
          aria-label="Back to projects"
          className="border-border bg-card text-foreground flex items-center gap-1 rounded-lg border px-2.5 py-2 text-sm shadow-sm"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="border-border bg-card flex items-center gap-2 rounded-lg border px-3 py-2 shadow-sm">
          <Box size={16} className="text-muted-foreground" />
          <span className="text-sm font-medium">{designName}</span>
        </div>
        <div className="border-border bg-card flex items-center gap-0.5 rounded-lg border px-1.5 py-1.5 shadow-sm">
          <button
            type="button"
            onClick={() => setBomOpen((o) => !o)}
            aria-pressed={bomOpen}
            title="Cut list / BOM"
            className={`rounded-md p-1.5 ${bomOpen ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
          >
            <ClipboardList size={16} />
          </button>
          <button
            type="button"
            onClick={exportJson}
            aria-label="Export JSON"
            title="Export .pvc.json"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <FileDown size={16} />
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Import JSON"
            title="Import .pvc.json"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <FileUp size={16} />
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={onImportFile}
        />
      </div>

      {bomOpen && <BomPanel onClose={() => setBomOpen(false)} />}

      {/* selected-member inspector (top-center) */}
      <SelectionPanel />

      {/* tool pillbox (bottom-center) */}
      <Pillbox />

      {/* snapping settings (bottom-left) */}
      <SnapPill />

      {/* pivot angle sliders + mobility (locked mode, top-right) */}
      <PivotPanel />

      {/* top-right: play + undo/redo + view + physics + theme toggles */}
      <div className="absolute top-4 right-4 flex items-center gap-1 rounded-lg border border-border bg-card px-1.5 py-1.5 shadow-sm">
        <button
          type="button"
          onClick={() => setSimulating(!simulating)}
          aria-pressed={simulating}
          title={simulating ? 'Stop simulation' : 'Play — rigid-body physics'}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium ${
            simulating
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          {simulating ? <Square size={13} /> : <Play size={13} />}
          {simulating ? 'Stop' : 'Play'}
        </button>
        <div className="mx-0.5 h-5 w-px bg-border" />
        <button
          type="button"
          onClick={undo}
          aria-label="Undo"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          onClick={redo}
          aria-label="Redo"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Redo2 size={16} />
        </button>
        <div className="mx-0.5 h-5 w-px bg-border" />
        <button
          type="button"
          onClick={toggleProjection}
          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {projection === 'ortho' ? 'Isometric' : 'Perspective'}
        </button>
        <div className="mx-0.5 h-5 w-px bg-border" />
        <button
          type="button"
          onClick={() => setLengthsLocked(!lengthsLocked)}
          aria-pressed={lengthsLocked}
          title={lengthsLocked ? 'Lengths locked' : 'Lengths free'}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium ${
            lengthsLocked
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          {lengthsLocked ? <Lock size={14} /> : <LockOpen size={14} />}
          Lengths
        </button>
        <div className="mx-0.5 h-5 w-px bg-border" />
        <button
          type="button"
          onClick={toggleNight}
          aria-label="Toggle day/night"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {night ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </div>
  );
}
