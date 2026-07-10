import {
  Axis3d,
  Box,
  Check,
  ChevronLeft,
  Download,
  FileDown,
  FileUp,
  HelpCircle,
  ListTree,
  Loader2,
  Magnet,
  Moon,
  Pencil,
  Redo2,
  RefreshCcw,
  Sparkles,
  Sun,
  Undo2,
  Waypoints,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { bomToCsv } from '../design/bom';
import { exportDesignJson, suggestedFileName } from '../persistence/exportImport';
import { useAppStore } from '../state/appStore';
import { requestPose, resetPose } from '../state/cameraStore';
import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/themeStore';
import { BendPill } from './BendPill';
import { BomPanel } from './BomPanel';
import { FloatingIsland, resetFloatingLayout } from './chrome/FloatingIsland';
import { ElasticPanel } from './ElasticPanel';
import { EditorStatusChips, EditorWorkflowStatus } from './editor/EditorWorkflowStatus';
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
const OBJECT_TREE_DOCKED_MAX_SIZE = { width: 350, height: 1000 };
const OBJECT_TREE_COMPACT_MAX_SIZE = { width: 330, height: 220 };

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
  const currentProjectId = useAppStore((s) => s.current?.id ?? null);
  const closeProject = useAppStore((s) => s.closeProject);
  const importAndOpen = useAppStore((s) => s.importAndOpen);
  const renameProject = useAppStore((s) => s.renameProject);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const [helpOpen, setHelpOpen] = useState(false);
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [cameraReadyDesignId, setCameraReadyDesignId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const exportJson = () => {
    const design = useAppStore.getState().current;
    if (design)
      downloadFile(suggestedFileName(design), exportDesignJson(design), 'application/json');
  };
  const exportBomCsv = () => {
    const design = useAppStore.getState().current;
    if (!design) return;
    downloadFile(
      suggestedFileName(design).replace(/\.pvc\.json$/, '.csv'),
      bomToCsv(design),
      'text/csv',
    );
  };
  const startNameEdit = () => {
    setNameDraft(designName);
    setNameEditing(true);
    requestAnimationFrame(() => nameInputRef.current?.select());
  };
  const cancelNameEdit = () => {
    setNameDraft('');
    setNameEditing(false);
  };
  const saveNameEdit = async () => {
    const trimmed = nameDraft.trim();
    if (!currentProjectId || !trimmed) return;
    await renameProject(currentProjectId, trimmed);
    setNameEditing(false);
    setNameDraft('');
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
  const rendererEffects = useEditorStore((s) => s.rendererEffects);
  const toggleRendererEffects = useEditorStore((s) => s.toggleRendererEffects);
  // Brief blur while the postprocessing chain (re)builds, so the toggle reads as
  // a transition instead of a hitch + visual pop.
  const [effectsSettling, setEffectsSettling] = useState(false);
  const effectsSeenRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: rendererEffects is the intentional trigger; its value isn't read
  useEffect(() => {
    if (!effectsSeenRef.current) {
      effectsSeenRef.current = true;
      return;
    }
    setEffectsSettling(true);
    const timer = window.setTimeout(() => setEffectsSettling(false), 550);
    return () => window.clearTimeout(timer);
  }, [rendererEffects]);
  const toolPaletteLayout = useEditorStore((s) => s.toolPaletteLayout);
  const selectedCount = useEditorStore((s) => s.selectedIds.length);
  const selectedJointId = useEditorStore((s) => s.selectedJointId);
  const selectedElasticId = useEditorStore((s) => s.selectedElasticId);

  // Restore doc-stored view + tool state on open (schema v6 `viewport`), and
  // reset transient state — so a document opens exactly as it was saved and does
  // NOT inherit the previous document's camera / tool / size.
  const designId = currentProjectId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: designId is the intentional re-run trigger; the body reads fresh state via getState()
  useLayoutEffect(() => {
    const doc = useAppStore.getState().current;
    if (!doc) {
      setCameraReadyDesignId(null);
      return;
    }
    setCameraReadyDesignId(null);
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
    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    const fallback = window.setTimeout(() => {
      if (!cancelled) setCameraReadyDesignId(doc.id);
    }, 500);
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        window.clearTimeout(fallback);
        setCameraReadyDesignId(doc.id);
      });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
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

  // starting a run from anywhere jumps to the Simulate tab
  useEffect(() => {
    if (simulating) setWorkflow('simulate');
  }, [simulating, setWorkflow]);

  const changeWorkflow = (next: typeof workflow) => setWorkflow(next);

  const chromeLayoutSignature = `${compactChrome}:${workflow}`;
  useEffect(() => {
    if (!hasDesign) return;
    void chromeLayoutSignature;
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => cancelAnimationFrame(frame);
  }, [chromeLayoutSignature, hasDesign]);

  if (!hasDesign) return null;

  const cameraSettling = !!designId && cameraReadyDesignId !== designId;

  const showInspector =
    selectedCount > 0 || !!selectedJointId || !!selectedElasticId || tool === 'bend';
  // the workflow panel always occupies the right side now — keep Objects narrow
  const objectTreeMaxSize = compactChrome
    ? OBJECT_TREE_COMPACT_MAX_SIZE
    : OBJECT_TREE_DOCKED_MAX_SIZE;
  const toolbarVertical = compactChrome || toolPaletteLayout === 'vertical';

  return (
    <div className="relative h-full w-full overflow-hidden">
      <PvcAutomationBridge />
      <Viewport />
      <MarqueeOverlay />

      {effectsSettling && (
        <div className="pointer-events-none absolute inset-0 z-[70] bg-background/20 backdrop-blur-sm transition-opacity" />
      )}

      {cameraSettling && (
        <div className="pointer-events-none absolute inset-0 z-[80] flex items-center justify-center bg-background/35 backdrop-blur-md">
          <div className="flex items-center gap-2 rounded-md border border-border/70 bg-card/80 px-3 py-2 text-xs font-semibold text-foreground shadow-lg">
            <Loader2 size={15} className="animate-spin text-primary" />
            Setting camera
          </div>
        </div>
      )}

      {/* top-left: back + design name — pinned (not draggable), holds the
          workspace reset + autosave/warning chips */}
      <FloatingIsland
        id="document-controls"
        placement="top-left"
        collapsible={false}
        draggable={false}
        icon={Box}
        stackId="left"
        stackOrder={0}
        title="Document"
        titleLayout="inline"
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
          {nameEditing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveNameEdit();
              }}
              className="flex w-56 max-w-[calc(100vw-9rem)] items-center gap-1 rounded-lg border border-border bg-card px-2 py-1.5 shadow-sm lg:w-64"
            >
              <input
                ref={nameInputRef}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelNameEdit();
                  }
                }}
                aria-label="Design name"
                className="min-w-0 flex-1 bg-transparent px-1 text-sm font-medium outline-none"
              />
              <button
                type="submit"
                disabled={!nameDraft.trim()}
                aria-label="Save design name"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
              >
                <Check size={15} />
              </button>
              <button
                type="button"
                onClick={cancelNameEdit}
                aria-label="Cancel design name edit"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <X size={15} />
              </button>
            </form>
          ) : (
            <div className="flex w-44 max-w-[calc(100vw-13rem)] items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm lg:w-64 lg:max-w-[calc(100vw-10rem)]">
              <Box size={16} className="shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium">{designName}</span>
              <button
                type="button"
                onClick={startNameEdit}
                aria-label="Edit design name"
                title="Edit design name"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <Pencil size={13} />
              </button>
            </div>
          )}
          {/* export/import/reset condense away below lg so the document row stays one line */}
          <div className="hidden items-center gap-0.5 rounded-lg border border-border bg-card px-1.5 py-1.5 shadow-sm lg:flex">
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
            <div className="mx-0.5 h-5 w-px bg-border" />
            <button
              type="button"
              onClick={resetFloatingLayout}
              aria-label="Reset workspace layout"
              title="Reset workspace layout"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <RefreshCcw size={16} />
            </button>
          </div>
          <EditorStatusChips />
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
        id="object-tree"
        placement="left-stack"
        defaultCollapsed={compactChrome}
        defaultSize={compactChrome ? OBJECT_TREE_COMPACT_SIZE : OBJECT_TREE_SIZE}
        maxSize={objectTreeMaxSize}
        minSize={OBJECT_TREE_MIN_SIZE}
        resizable
        handleLabel="Move objects panel"
        resizeLabel="Resize objects panel"
        icon={ListTree}
        stackId="left"
        stackOrder={1}
        title="Objects"
        titleLayout="top"
      >
        <div className="h-full w-full">
          <ObjectTree hidePanelTitle />
        </div>
      </FloatingIsland>

      {/* the workflow panel: Design/Fabricate/Simulate tabs (+ Play/Stop) whose
          body is the active mode's tools — inspector, cut list, or sim controls.
          Sits under View on the right; bottom-right on compact chrome. */}
      <FloatingIsland
        id="workflow-panel"
        placement={compactChrome ? 'bottom-right' : 'right-stack'}
        handleLabel="Move workflow panel"
        icon={Waypoints}
        stackId={compactChrome ? undefined : 'right'}
        stackOrder={1}
        title="Workflow"
        titleLayout="top"
        titleActions={
          workflow === 'fabricate' ? (
            <button
              type="button"
              onClick={exportBomCsv}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <Download size={13} /> CSV
            </button>
          ) : undefined
        }
      >
        <div className="flex w-[min(92vw,24rem)] flex-col gap-1.5">
          <EditorWorkflowStatus activeWorkflow={workflow} onWorkflowChange={changeWorkflow} />
          <div className="h-px w-full bg-border/70" />
          {workflow === 'design' &&
            (showInspector ? (
              <div className="flex flex-col items-stretch gap-2 p-1">
                <SelectionPanel />
                <BendPill />
                <ElasticPanel />
              </div>
            ) : (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                Select a pipe, joint, or band to inspect it.
              </p>
            ))}
          {workflow === 'fabricate' && (
            <div className="scrollbar-minimal h-[min(55vh,30rem)] overflow-y-auto">
              <BomPanel hideHeader />
            </div>
          )}
          {workflow === 'simulate' && (
            <div className="scrollbar-minimal flex max-h-[min(55vh,30rem)] flex-col overflow-y-auto">
              <SimulationPanel />
              <PivotPanel />
            </div>
          )}
        </div>
      </FloatingIsland>

      {/* tool pillbox — sizes to its content so every button is always visible;
          no resize, no scroll. Compact chrome docks it into the left measured
          stack as an icons-only vertical rail instead of floating bottom-center. */}
      <FloatingIsland
        id="tool-pillbox"
        placement={compactChrome ? 'left-stack' : 'bottom-center'}
        handleLabel="Move tool palette"
        icon={Waypoints}
        stackId={compactChrome ? 'left' : undefined}
        stackOrder={compactChrome ? 4 : undefined}
        title="Tools"
        titleLayout={toolbarVertical ? 'top' : 'inline'}
      >
        <Pillbox layout={toolbarVertical ? 'vertical' : 'horizontal'} compact={compactChrome} />
      </FloatingIsland>

      {/* snapping settings + display-units — bottom of the left stack */}
      <FloatingIsland
        id="snap-units"
        placement="left-stack"
        className="hidden sm:block"
        collapsible={false}
        handleLabel="Move snap and units controls"
        icon={Magnet}
        stackId="left"
        stackOrder={3}
        title="Snap"
        titleLayout="inline"
      >
        <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-end gap-2">
          <SnapPill />
          <UnitsPill />
        </div>
      </FloatingIsland>

      {/* right-click join menu (anchor / wrapped / free) */}
      <JoinMenu />

      {/* right-click size switcher (1/2" ↔ 3/4") */}
      <SizeMenu />

      {/* top-right: undo/redo + view + theme toggles */}
      <FloatingIsland
        id="view-toolbar"
        placement="top-right"
        className="hidden sm:block"
        collapsible={false}
        handleLabel="Move view toolbar"
        icon={Box}
        stackId="right"
        stackOrder={0}
        title="View"
        titleLayout="inline"
      >
        <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-1 px-1.5 py-1.5">
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
            aria-pressed={projection === 'perspective'}
            title="Toggle perspective camera"
            className={`flex items-center rounded-md px-2.5 py-1.5 text-xs font-medium ${
              projection === 'perspective'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {/* icon-only below lg so the view toolbar fits tablet widths */}
            <Axis3d size={15} className="lg:hidden" />
            <span className="hidden lg:inline">Perspective</span>
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
          <button
            type="button"
            onClick={toggleRendererEffects}
            aria-pressed={rendererEffects}
            aria-label="Renderer effects"
            title="Renderer effects"
            className={`flex items-center rounded-md p-1.5 ${
              rendererEffects
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <Sparkles size={15} />
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
