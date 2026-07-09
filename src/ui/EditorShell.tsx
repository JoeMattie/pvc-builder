import {
  Box,
  ChevronLeft,
  ClipboardList,
  FileDown,
  FileUp,
  HelpCircle,
  Moon,
  Redo2,
  RefreshCcw,
  Sun,
  Undo2,
  Waypoints,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { exportDesignJson, suggestedFileName } from '../persistence/exportImport';
import { useAppStore } from '../state/appStore';
import { requestPose, resetPose } from '../state/cameraStore';
import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/themeStore';
import { BendPill } from './BendPill';
import { BomPanel } from './BomPanel';
import { FloatingIsland, resetFloatingLayout } from './chrome/FloatingIsland';
import { ElasticPanel } from './ElasticPanel';
import { EditorWorkflowStatus } from './editor/EditorWorkflowStatus';
import { PvcAutomationBridge } from './editor/PvcAutomationBridge';
import { SimulationPanel } from './editor/SimulationPanel';
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

const OBJECT_TREE_SIZE = { width: 304, height: 220 };
const OBJECT_TREE_COMPACT_SIZE = { width: 304, height: 150 };
const OBJECT_TREE_MIN_SIZE = { width: 224, height: 150 };
const OBJECT_TREE_MAX_SIZE = { width: 520, height: 620 };
const OBJECT_TREE_DOCKED_MAX_SIZE = { width: 350, height: 620 };
const OBJECT_TREE_COMPACT_MAX_SIZE = { width: 330, height: 220 };
const BOM_SIZE = { width: 384, height: 420 };
const BOM_COMPACT_SIZE = { width: 300, height: 220 };
const BOM_MIN_SIZE = { width: 280, height: 220 };
const BOM_MAX_SIZE = { width: 560, height: 620 };
const BOM_DOCKED_MAX_SIZE = { width: 384, height: 620 };
const BOM_COMPACT_MAX_SIZE = { width: 320, height: 240 };
const TOOLBAR_MIN_SIZE = { width: 240, height: 64 };
const TOOLBAR_MAX_SIZE = { width: 960, height: 180 };
const TOOLBAR_COMPACT_MAX_SIZE = { width: 330, height: 110 };
const WORKFLOW_COMPACT_OFFSET = { y: 48 };

function useCompactChrome() {
  const [compact, setCompact] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth < 640,
  );

  useEffect(() => {
    const sync = () => setCompact(window.innerWidth < 640);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  return compact;
}

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
  const closeProject = useAppStore((s) => s.closeProject);
  const importAndOpen = useAppStore((s) => s.importAndOpen);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const hasPivotPanel = useAppStore((s) => {
    const d = s.current;
    return !!d?.lengthsLocked && d.joints.some((j) => j.mode === 'wrapped' || j.mode === 'free');
  });

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
  const workflow = useEditorStore((s) => s.sceneStatus);
  const setWorkflow = useEditorStore((s) => s.setSceneStatus);
  const wireframe = useEditorStore((s) => s.wireframe);
  const toggleWireframe = useEditorStore((s) => s.toggleWireframe);
  const selectedCount = useEditorStore((s) => s.selectedIds.length);
  const selectedJointId = useEditorStore((s) => s.selectedJointId);
  const selectedElasticId = useEditorStore((s) => s.selectedElasticId);

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
  const compactChrome = useCompactChrome();

  useEditorHotkeys({ undo, redo });

  useEffect(() => {
    if (simulating) setWorkflow('simulate');
  }, [simulating, setWorkflow]);

  const chromeLayoutSignature = `${bomOpen}:${compactChrome}:${hasPivotPanel}:${workflow}`;
  useEffect(() => {
    if (!hasDesign) return;
    void chromeLayoutSignature;
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => cancelAnimationFrame(frame);
  }, [chromeLayoutSignature, hasDesign]);

  if (!hasDesign) return null;

  const showInspector =
    selectedCount > 0 || !!selectedJointId || !!selectedElasticId || tool === 'bend';
  const rightDockOpen = workflow === 'simulate' || hasPivotPanel;
  const objectTreeMaxSize = rightDockOpen
    ? compactChrome
      ? OBJECT_TREE_COMPACT_MAX_SIZE
      : OBJECT_TREE_DOCKED_MAX_SIZE
    : compactChrome
      ? OBJECT_TREE_COMPACT_MAX_SIZE
      : OBJECT_TREE_MAX_SIZE;
  const bomMaxSize = compactChrome
    ? BOM_COMPACT_MAX_SIZE
    : rightDockOpen
      ? BOM_DOCKED_MAX_SIZE
      : BOM_MAX_SIZE;
  const objectTreeOffsetY = compactChrome ? 190 : 148;
  const bomOffsetY = rightDockOpen ? (compactChrome ? 352 : 318) : compactChrome ? 352 : 0;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <PvcAutomationBridge />
      <Viewport />
      <MarqueeOverlay />

      <button
        type="button"
        onClick={resetFloatingLayout}
        aria-label="Reset workspace layout"
        title="Reset workspace layout"
        className="absolute top-2 left-2 z-[80] flex h-7 w-7 items-center justify-center rounded-md border border-border/80 bg-card/85 text-muted-foreground shadow-md backdrop-blur-md hover:text-foreground"
      >
        <RefreshCcw size={14} />
      </button>

      {/* top-left: back + design name */}
      <FloatingIsland
        id="document-controls"
        placement="top-left"
        offset={{ x: 32 }}
        handleLabel="Move document controls"
      >
        <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void closeProject()}
            aria-label="Back to projects"
            className="flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-2 text-sm text-foreground shadow-sm"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="flex max-w-[16rem] items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
            <Box size={16} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{designName}</span>
          </div>
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card px-1.5 py-1.5 shadow-sm">
            <button
              type="button"
              onClick={() => {
                if (!bomOpen) setWorkflow('fabricate');
                setBomOpen((open) => !open);
              }}
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
      </FloatingIsland>

      <FloatingIsland
        id="workflow-stack"
        placement="left-stack"
        offset={compactChrome ? WORKFLOW_COMPACT_OFFSET : undefined}
        handleLabel="Move workflow panel"
      >
        <div className="flex w-[min(92vw,19rem)] flex-col gap-2">
          <EditorWorkflowStatus
            activeWorkflow={workflow}
            onWorkflowChange={setWorkflow}
            onOpenBom={() => {
              setWorkflow('fabricate');
              setBomOpen(true);
            }}
          />
        </div>
      </FloatingIsland>

      <FloatingIsland
        id="object-tree"
        placement="left-stack"
        offset={{ y: objectTreeOffsetY }}
        defaultSize={compactChrome ? OBJECT_TREE_COMPACT_SIZE : OBJECT_TREE_SIZE}
        maxSize={objectTreeMaxSize}
        minSize={OBJECT_TREE_MIN_SIZE}
        resizable
        handleLabel="Move objects panel"
        resizeLabel="Resize objects panel"
      >
        <div className="h-full w-full">
          <ObjectTree />
        </div>
      </FloatingIsland>

      {showInspector && (
        <FloatingIsland
          id="inspector-stack"
          placement="top-center"
          handleLabel="Move inspector panels"
        >
          <div className="flex max-w-[calc(100vw-2rem)] flex-col items-center gap-2">
            <SelectionPanel />
            <BendPill />
            <ElasticPanel />
          </div>
        </FloatingIsland>
      )}

      {/* tool pillbox (bottom-center) */}
      <FloatingIsland
        id="tool-pillbox"
        placement="bottom-center"
        maxSize={compactChrome ? TOOLBAR_COMPACT_MAX_SIZE : TOOLBAR_MAX_SIZE}
        minSize={TOOLBAR_MIN_SIZE}
        resizable
        handleLabel="Move tool palette"
        resizeLabel="Resize tool palette"
      >
        <Pillbox />
      </FloatingIsland>

      {/* snapping settings + display-units (bottom-left, side by side) */}
      <FloatingIsland
        id="snap-units"
        placement="bottom-left"
        className="hidden sm:block"
        handleLabel="Move snap and units controls"
      >
        <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-end gap-2">
          <SnapPill />
          <UnitsPill />
        </div>
      </FloatingIsland>

      {rightDockOpen ? (
        <FloatingIsland
          id="right-stack"
          placement="right-stack"
          handleLabel="Move simulation and fabrication panels"
        >
          <div className="scrollbar-minimal flex max-h-[calc(100vh-7rem)] flex-col items-end gap-2 overflow-y-auto pr-1">
            {workflow === 'simulate' && <SimulationPanel />}
            <PivotPanel />
          </div>
        </FloatingIsland>
      ) : null}

      {bomOpen && (
        <FloatingIsland
          id="bom-panel"
          placement="right-stack"
          offset={{ y: bomOffsetY }}
          defaultSize={compactChrome ? BOM_COMPACT_SIZE : BOM_SIZE}
          maxSize={bomMaxSize}
          minSize={BOM_MIN_SIZE}
          resizable
          handleLabel="Move BOM panel"
          resizeLabel="Resize BOM panel"
        >
          <BomPanel onClose={() => setBomOpen(false)} />
        </FloatingIsland>
      )}

      {/* right-click join menu (anchor / wrapped / free) */}
      <JoinMenu />

      {/* right-click size switcher (1/2" ↔ 3/4") */}
      <SizeMenu />

      {/* top-right: undo/redo + view + theme toggles */}
      <FloatingIsland
        id="view-toolbar"
        placement="top-right"
        className="hidden sm:block"
        handleLabel="Move view toolbar"
      >
        <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-1 rounded-lg border border-border bg-card px-1.5 py-1.5 shadow-sm">
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
      </FloatingIsland>

      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
