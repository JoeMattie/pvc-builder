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
  Waypoints,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { exportDesignJson, suggestedFileName } from '../persistence/exportImport';
import { useAppStore } from '../state/appStore';
import { requestPose, resetPose } from '../state/cameraStore';
import { setJointDamping, setMannequin } from '../state/editorActions';
import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/themeStore';
import { BendPill } from './BendPill';
import { BomPanel } from './BomPanel';
import { ElasticPanel } from './ElasticPanel';
import { EditorWorkflowStatus } from './editor/EditorWorkflowStatus';
import { PvcAutomationBridge } from './editor/PvcAutomationBridge';
import { useEditorHotkeys } from './editor/useEditorHotkeys';
import { HelpPanel } from './HelpPanel';
import { JoinMenu } from './JoinMenu';
import { downloadFile } from './lib/download';
import { ObjectTree } from './ObjectTree';
import { Pillbox } from './Pillbox';
import { PivotPanel } from './PivotPanel';
import { SelectionPanel } from './SelectionPanel';
import { SizeMenu } from './SizeMenu';
import { SnapPill } from './SnapPill';
import { Viewport } from './scene/Viewport';
import { UnitsPill } from './UnitsPill';
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
  const workflow = useEditorStore((s) => s.sceneStatus);
  const setWorkflow = useEditorStore((s) => s.setSceneStatus);
  const physicsDebug = useEditorStore((s) => s.physicsDebug);
  const setPhysicsDebug = useEditorStore((s) => s.setPhysicsDebug);
  const wireframe = useEditorStore((s) => s.wireframe);
  const toggleWireframe = useEditorStore((s) => s.toggleWireframe);
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
    ed.setSceneStatus('design');
    const vp = doc.viewport;
    if (vp?.projection === 'perspective' || vp?.projection === 'ortho')
      ed.setProjection(vp.projection);
    const TOOLS = ['select', 'draw', 'formed', 'move', 'rotate', 'extend', 'guide'];
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

  useEditorHotkeys({ undo, redo });

  useEffect(() => {
    if (simulating) setWorkflow('simulate');
  }, [simulating, setWorkflow]);

  if (!hasDesign) return null;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <PvcAutomationBridge />
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
            onClick={() =>
              setBomOpen((open) => {
                const next = !open;
                if (next) setWorkflow('fabricate');
                return next;
              })
            }
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

      <div className="absolute top-16 left-4">
        <EditorWorkflowStatus
          activeWorkflow={workflow}
          onWorkflowChange={setWorkflow}
          onOpenBom={() => {
            setWorkflow('fabricate');
            setBomOpen(true);
          }}
        />
      </div>

      {/* object / group tree (left, below workflow status) */}
      <div className="pointer-events-none absolute top-44 left-4">
        <ObjectTree />
      </div>

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
        <button
          type="button"
          onClick={toggleWireframe}
          aria-pressed={wireframe}
          title="Wireframe view (W)"
          className={`flex items-center rounded-md px-2 py-1.5 ${
            wireframe
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          <Waypoints size={15} />
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
