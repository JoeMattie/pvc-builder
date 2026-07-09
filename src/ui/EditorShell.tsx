import {
  Box,
  Bug,
  ChevronLeft,
  ClipboardList,
  FileDown,
  FileUp,
  HelpCircle,
  Lock,
  LockOpen,
  Moon,
  PersonStanding,
  Play,
  Redo2,
  Square,
  Sun,
  Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { bom } from '../design/bom';
import { memberById, memberLengthM } from '../design/docOps';
import { resolveFittings } from '../design/fittings';
import { analyzeFormed } from '../design/formed';
import { intersectingMembers } from '../design/intersections';
import { exportDesignJson, suggestedFileName } from '../persistence/exportImport';
import type { Vec3 } from '../schema';
import { solve } from '../solver';
import { physicsNodePositions, setPhysicsPrecision, setPhysicsTuning } from '../solver/physics';
import { useAppStore } from '../state/appStore';
import { requestPose, resetPose, setView, type ViewName } from '../state/cameraStore';
import {
  bendMemberAt,
  clearSelection,
  copySelection,
  cutSelection,
  deleteElastic,
  deleteMeasurement,
  deleteMembers,
  detachMemberEnd,
  dragNodeTo,
  enterGroup,
  exitGroup,
  finishFormed,
  finishPath,
  groupSelection,
  hasClipboard,
  jointOrientationsOf,
  makeFreeHub,
  makeManufacturedJoint,
  moveFormedControlPoint,
  pasteClipboard,
  pivotAnglesOf,
  placeDrawAtDistance,
  placeDrawPoint,
  placeElasticPoint,
  placeFormedPoint,
  placeMeasurePoint,
  resetPivots,
  rotateMemberBy,
  selectMember,
  setElasticTension,
  setJoinMode,
  setJointDamping,
  setLengthDisplay,
  setMannequin,
  setMemberLength,
  setMemberSize,
  setMembersSize,
  setPivotAngle,
  snapDrawPoint,
  swapJointReceiver,
  translateMemberBy,
  translateMembersBy,
  ungroupSelection,
  weldDroppedNode,
} from '../state/editorActions';
import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/themeStore';
import { BendPill } from './BendPill';
import { BomPanel } from './BomPanel';
import { ElasticPanel } from './ElasticPanel';
import { HelpPanel } from './HelpPanel';
import { JoinMenu } from './JoinMenu';
import { downloadFile } from './lib/download';
import { Pillbox } from './Pillbox';
import { PivotPanel } from './PivotPanel';
import { SelectionPanel } from './SelectionPanel';
import { SizeMenu } from './SizeMenu';
import { SnapPill } from './SnapPill';
import { Viewport } from './scene/Viewport';
import { UnitsPill } from './UnitsPill';
import { parseLength } from './units';
import { ViewMenu } from './ViewMenu';

/** The rubber-band selection rectangle (screen overlay). Blue solid when
 * dragging left→right (window / contained), green dashed right→left (crossing /
 * touching) — CAD convention. */
function MarqueeOverlay() {
  const marquee = useEditorStore((s) => s.marquee);
  if (!marquee) return null;
  const { x0, y0, x1, y1 } = marquee;
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const width = Math.abs(x1 - x0);
  const height = Math.abs(y1 - y0);
  const crossing = x1 < x0;
  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{
        left,
        top,
        width,
        height,
        border: `1.5px ${crossing ? 'dashed' : 'solid'} ${crossing ? '#3d9950' : '#2a78d6'}`,
        background: crossing ? 'rgba(61,153,80,0.10)' : 'rgba(42,120,214,0.10)',
      }}
    />
  );
}

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
  const [helpOpen, setHelpOpen] = useState(false);
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
  const tool = useEditorStore((s) => s.tool);
  const drawSize = useEditorStore((s) => s.drawSize);
  const simulating = useEditorStore((s) => s.simulating);
  const setSimulating = useEditorStore((s) => s.setSimulating);
  const physicsDebug = useEditorStore((s) => s.physicsDebug);
  const setPhysicsDebug = useEditorStore((s) => s.setPhysicsDebug);
  const mannequin = useAppStore((s) => s.current?.mannequin ?? false);
  const jointDamping = useAppStore((s) => s.current?.jointDamping ?? 1);

  // Restore doc-stored view + tool state on open (schema v6 `viewport`), and
  // reset transient state — so a document opens exactly as it was saved and does
  // NOT inherit the previous document's camera / tool / size.
  const designId = useAppStore((s) => s.current?.id);
  // biome-ignore lint/correctness/useExhaustiveDependencies: designId is the intentional re-run trigger; the body reads fresh state via getState()
  useEffect(() => {
    const doc = useAppStore.getState().current;
    if (!doc) return;
    const ed = useEditorStore.getState();
    ed.resetTransient();
    const vp = doc.viewport;
    if (vp?.projection === 'perspective' || vp?.projection === 'ortho')
      ed.setProjection(vp.projection);
    const TOOLS = ['select', 'draw', 'formed', 'move', 'rotate'];
    if (vp?.tool && TOOLS.includes(vp.tool)) ed.setTool(vp.tool as never);
    if (vp?.drawSize) ed.setDrawSize(vp.drawSize);
    const cam = vp?.camera;
    if (cam)
      requestPose(
        [cam.position.x, cam.position.y, cam.position.z],
        [cam.target.x, cam.target.y, cam.target.z],
        cam.zoom,
      );
    else resetPose();
  }, [designId]);

  // Persist tool / projection / draw-size changes into the document (non-undoable).
  // biome-ignore lint/correctness/useExhaustiveDependencies: designId re-persists after a restore
  useEffect(() => {
    if (!useAppStore.getState().current) return;
    useAppStore.getState().setViewport({ tool, projection, drawSize });
  }, [tool, projection, drawSize, designId]);

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
      // Ctrl/Cmd+Space → start/stop playback (physics simulation)
      if (mod && (e.key === ' ' || e.code === 'Space')) {
        e.preventDefault();
        editor.setSimulating(!editor.simulating);
        return;
      }
      if (typing) return;

      // copy / cut / paste the selection (mod-gated, so it also beats the plain
      // 'c'/'v' tool hotkeys below)
      if (mod && e.key.toLowerCase() === 'c') {
        if (copySelection()) e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === 'x') {
        if (cutSelection()) e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        if (pasteClipboard()) e.preventDefault();
        return;
      }

      // arrow / numpad nudge of the selected pipe(s) by one grid step. Arrows +
      // numpad-arrows move in the X/Z ground plane; Ctrl+Up/Down (or the numpad
      // Home/PgUp = up, End/PgDn = down) move vertically in Y.
      if (editor.selectedIds.length && !editor.drawingFromNodeId) {
        const s = editor.snap.gridStepM;
        const K = e.key;
        const C = e.code;
        let d: Vec3 | null = null;
        if (mod && K === 'ArrowUp') d = { x: 0, y: s, z: 0 };
        else if (mod && K === 'ArrowDown') d = { x: 0, y: -s, z: 0 };
        else if (K === 'Home' || K === 'PageUp' || C === 'Numpad7' || C === 'Numpad9')
          d = { x: 0, y: s, z: 0 };
        else if (K === 'End' || K === 'PageDown' || C === 'Numpad1' || C === 'Numpad3')
          d = { x: 0, y: -s, z: 0 };
        else if (K === 'ArrowLeft' || C === 'Numpad4') d = { x: -s, y: 0, z: 0 };
        else if (K === 'ArrowRight' || C === 'Numpad6') d = { x: s, y: 0, z: 0 };
        else if (K === 'ArrowUp' || C === 'Numpad8') d = { x: 0, y: 0, z: -s };
        else if (K === 'ArrowDown' || C === 'Numpad2') d = { x: 0, y: 0, z: s };
        if (d) {
          e.preventDefault();
          translateMembersBy(editor.selectedIds, d);
          return;
        }
      }

      // typed-length entry: while a draw path is open, digits/units type into the
      // length pill; Enter commits the segment at that distance (must run BEFORE
      // the tool hotkeys so e.g. "10cm" doesn't trigger the Curve tool on 'c')
      if (editor.tool === 'draw' && editor.drawingFromNodeId) {
        if (e.key === 'Enter' && editor.drawLength) {
          const doc = useAppStore.getState().current;
          const m = doc ? parseLength(editor.drawLength, doc.lengthDisplay) : null;
          if (m && m > 0 && placeDrawAtDistance(m)) {
            e.preventDefault();
            return;
          }
        } else if (e.key === 'Backspace' && editor.drawLength) {
          editor.setDrawLength(editor.drawLength.slice(0, -1));
          e.preventDefault();
          return;
        } else if (e.key === 'Escape' && editor.drawLength) {
          editor.setDrawLength('');
          e.preventDefault();
          return;
        } else if (e.key.length === 1 && /[0-9./'" a-z]/i.test(e.key)) {
          editor.setDrawLength(editor.drawLength + e.key);
          e.preventDefault();
          return;
        }
      }

      if (e.key === 'Escape' || e.key === 'Enter') {
        if (editor.drawingFromNodeId) finishPath();
        else if (editor.formedPoints.length) finishFormed();
        else if (editor.measureFrom || editor.measureAdjustId) {
          editor.setMeasureFrom(null);
          editor.setMeasureAdjustId(null);
        } else if (editor.elasticFrom) editor.setElasticFrom(null);
        else if (e.key === 'Escape' && editor.enteredGroupId) exitGroup();
        else clearSelection();
      } else if (e.key === 'g' || e.key === 'G') {
        // G groups the selection; Shift+G ungroups it (auto-solves boundary unions)
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
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
      } else if (e.key === 'c' || e.key === 'C') {
        // the heat-formed spline tool, now labelled "Curve"
        editor.setTool('formed');
      } else if (e.key === 'b' || e.key === 'B') {
        editor.setTool('bend');
      } else if (e.key === 't' || e.key === 'T') {
        editor.setTool('measure');
      } else if (e.key === 'e' || e.key === 'E') {
        editor.setTool('elastic');
      } else if (e.key === 'r' || e.key === 'R') {
        resetPivots();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editor.selectedMeasurementId) deleteMeasurement(editor.selectedMeasurementId);
        else if (editor.selectedElasticId) deleteElastic(editor.selectedElasticId);
        else if (editor.selectedIds.length) {
          deleteMembers(editor.selectedIds);
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
  }, [undo, redo]);

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
        selectedJointId: s.selectedJointId,
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
    hook.setTool = (
      tool: 'select' | 'draw' | 'formed' | 'move' | 'rotate' | 'measure' | 'bend' | 'elastic',
    ) => useEditorStore.getState().setTool(tool);
    hook.setProjection = (p: 'ortho' | 'perspective') => useEditorStore.getState().setProjection(p);
    hook.setView = (name: ViewName) => setView(name);
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
    hook.measure = (raw: Vec3) => placeMeasurePoint(raw);
    hook.getMeasurements = () => useAppStore.getState().current?.measurements ?? [];
    hook.deleteMeasurement = (id: string) => deleteMeasurement(id);
    // elastic-band seams (place two attachment points → a spring band)
    hook.placeElastic = (raw: Vec3) => placeElasticPoint(raw);
    hook.getElastics = () => useAppStore.getState().current?.elastics ?? [];
    hook.setElasticTension = (id: string, stiffnessNPerM: number) =>
      setElasticTension(id, stiffnessNPerM);
    hook.selectElastic = (id: string | null) => useEditorStore.getState().selectElastic(id);
    hook.deleteElastic = (id: string) => deleteElastic(id);
    hook.bendMember = (
      memberId: string,
      t: number,
      perpOffset: Vec3,
      lengthRef?: { axisDir: Vec3; lengthM: number },
    ) => bendMemberAt(memberId, t, perpOffset, lengthRef);
    hook.setBendLengthLock = (on: boolean) => useEditorStore.getState().setBendLengthLock(on);
    hook.moveControlPoint = (memberId: string, index: number, raw: Vec3) =>
      moveFormedControlPoint(memberId, index, raw);
    hook.selectMember = (id: string) => selectMember(id);
    hook.setSelection = (ids: string[]) => useEditorStore.getState().setSelection(ids);
    hook.openJoinMenu = (menu: { nodeId: string; moverId: string; x: number; y: number }) =>
      useEditorStore.getState().openJoinMenu(menu);
    hook.copySelection = () => copySelection();
    hook.cutSelection = () => cutSelection();
    hook.pasteClipboard = () => pasteClipboard();
    hook.hasClipboard = () => hasClipboard();
    hook.groupSelection = () => groupSelection();
    hook.ungroupSelection = () => ungroupSelection();
    hook.enterGroup = (id: string) => enterGroup(id);
    hook.exitGroup = () => exitGroup();
    hook.getEnteredGroup = () => useEditorStore.getState().enteredGroupId;
    hook.selectJoint = (id: string | null) => useEditorStore.getState().selectJoint(id);
    hook.clearSelection = () => clearSelection();
    hook.deleteMembers = (ids: string[]) => deleteMembers(ids);
    hook.setMemberLength = (id: string, lengthM: number) => setMemberLength(id, lengthM);
    hook.setMemberSize = (id: string, size: '1/2"' | '3/4"') => setMemberSize(id, size);
    hook.setMembersSize = (ids: string[], size: '1/2"' | '3/4"') => setMembersSize(ids, size);
    hook.setLengthDisplay = (d: 'mm' | 'cm' | 'in' | 'in-frac') => setLengthDisplay(d);
    hook.detachMemberEnd = (memberId: string, nodeId: string) => detachMemberEnd(memberId, nodeId);
    hook.weldDroppedNode = (nodeId: string) => weldDroppedNode(nodeId);
    hook.dragNode = (id: string, raw: Vec3) => dragNodeTo(id, raw);
    hook.moveMember = (id: string, delta: Vec3) => translateMemberBy(id, delta);
    hook.rotateMember = (id: string, axis: Vec3, angleRad: number, pivot: Vec3) =>
      rotateMemberBy(id, axis, angleRad, pivot);
    hook.getIntersections = () => {
      const d = useAppStore.getState().current;
      return d ? [...intersectingMembers(d)] : [];
    };
    hook.getFormed = (id: string) => {
      const d = useAppStore.getState().current;
      const m = d ? memberById(d, id) : undefined;
      return d && m && m.kind === 'formed' ? analyzeFormed(d, m) : null;
    };
    // joint seams (right-click a join → anchor / wrapped / free)
    hook.getJoints = () => useAppStore.getState().current?.joints ?? [];
    hook.setJoinMode = (
      nodeId: string,
      moverId: string,
      mode: 'anchor' | 'wrapped' | 'free',
      receiverId?: string,
    ) => setJoinMode(nodeId, moverId, mode, receiverId);
    hook.swapJointReceiver = (jointId: string) => swapJointReceiver(jointId);
    hook.makeManufacturedJoint = (nodeId: string, moverId: string) =>
      makeManufacturedJoint(nodeId, moverId);
    hook.makeFreeHub = (nodeId: string) => makeFreeHub(nodeId);
    // opt-in: logs what the draw cursor / a dragged endpoint snaps to
    hook.setSnapDebug = (on: boolean) => {
      hook.snapDebug = on;
    };
    // pivots / solver seams
    hook.setPivotAngle = (jointId: string, angleRad: number) => setPivotAngle(jointId, angleRad);
    hook.getSolve = () => {
      const d = useAppStore.getState().current;
      if (!d) return null;
      return solve(
        d,
        {
          lengthsLocked: d.lengthsLocked,
          pivotAngles: pivotAnglesOf(d),
          jointOrientations: jointOrientationsOf(d),
        },
        'pose',
      );
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
    hook.setPhysicsDebug = (on: boolean) => useEditorStore.getState().setPhysicsDebug(on);
    hook.getPhysics = () => physicsNodePositions();
    // mannequin (static human collision body) + global damping (friction/drag)
    hook.setMannequin = (on: boolean) => setMannequin(on);
    hook.setJointDamping = (mult: number) => setJointDamping(mult);
    // perf-lever A/B seams (set BEFORE simulating — baked at world build)
    hook.setPhysicsPrecision = (o: { substeps?: boolean; ccd?: boolean; vcap?: boolean }) =>
      setPhysicsPrecision(o);
    hook.setPhysicsTuning = (o: {
      velocityIterations?: number;
      positionIterations?: number;
      allowSleeping?: boolean;
    }) => setPhysicsTuning(o);
  }, []);

  if (!hasDesign) return null;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Viewport />
      <MarqueeOverlay />

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

      {/* Bend-tool options (top-center) */}
      <BendPill />

      {/* selected elastic-band tension slider (top-center) */}
      <ElasticPanel />

      {/* tool pillbox (bottom-center) */}
      <Pillbox />

      {/* snapping settings + display-units (bottom-left, side by side) */}
      <div className="absolute bottom-5 left-4 flex items-end gap-2">
        <SnapPill />
        <UnitsPill />
      </div>

      {/* pivot angle sliders + mobility (locked mode, top-right) */}
      <PivotPanel />

      {/* global damping (friction/drag) slider — shown while simulating so the
          model can be made to settle correctly (Play mode, bottom-center) */}
      {simulating && (
        <div className="-translate-x-1/2 absolute bottom-24 left-1/2 flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 shadow-md">
          <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
            Damping
          </span>
          <input
            type="range"
            min={0.2}
            max={5}
            step={0.1}
            value={jointDamping}
            aria-label="Joint damping"
            onChange={(e) => setJointDamping(Number(e.target.value))}
            className="w-40 accent-primary"
          />
          <span className="w-10 tabular-nums text-xs text-foreground">
            {jointDamping.toFixed(1)}×
          </span>
        </div>
      )}

      {/* right-click join menu (anchor / wrapped / free) */}
      <JoinMenu />

      {/* right-click size switcher (1/2" ↔ 3/4") */}
      <SizeMenu />

      {/* top-right: play + undo/redo + view + physics + theme toggles */}
      <div className="absolute top-4 right-4 flex items-center gap-1 rounded-lg border border-border bg-card px-1.5 py-1.5 shadow-sm">
        <button
          type="button"
          onClick={() => setSimulating(!simulating)}
          aria-pressed={simulating}
          title={
            simulating ? 'Stop simulation (Ctrl+Space)' : 'Play — rigid-body physics (Ctrl+Space)'
          }
          className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium ${
            simulating
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          {simulating ? <Square size={13} /> : <Play size={13} />}
          {simulating ? 'Stop' : 'Play'}
        </button>
        {/* physics debug overlay — only while simulating (crashcat/three) */}
        {simulating && (
          <button
            type="button"
            onClick={() => setPhysicsDebug(!physicsDebug)}
            aria-pressed={physicsDebug}
            title="Toggle physics debug overlay (bodies + constraints)"
            className={`flex items-center rounded-md px-2 py-1.5 ${
              physicsDebug
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <Bug size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setMannequin(!mannequin)}
          aria-pressed={mannequin}
          title={
            mannequin
              ? 'Hide the mannequin (static human to mount/rest on)'
              : 'Show a mannequin — a static human body the design rests / hangs on in Play'
          }
          className={`flex items-center rounded-md px-2 py-1.5 ${
            mannequin
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          <PersonStanding size={14} />
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
        <ViewMenu />
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
          onClick={() => setHelpOpen(true)}
          aria-label="Help & shortcuts"
          title="Help & keyboard shortcuts"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <HelpCircle size={16} />
        </button>
        <button
          type="button"
          onClick={toggleNight}
          aria-label="Toggle day/night"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {night ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
