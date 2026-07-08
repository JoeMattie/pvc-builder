import { Box, ChevronLeft, Lock, LockOpen, Moon, Redo2, Sun, Undo2 } from 'lucide-react';
import { useEffect } from 'react';
import { deleteMember, memberLengthM } from '../design/docOps';
import type { Vec3 } from '../schema';
import { useAppStore } from '../state/appStore';
import {
  clearSelection,
  dragNodeTo,
  finishPath,
  placeDrawPoint,
  selectMember,
  setMemberLength,
  snapDrawPoint,
} from '../state/editorActions';
import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/themeStore';
import { Pillbox } from './Pillbox';
import { SelectionPanel } from './SelectionPanel';
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
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);

  const projection = useEditorStore((s) => s.projection);
  const toggleProjection = useEditorStore((s) => s.toggleProjection);

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
        else clearSelection();
      } else if (e.key === 'v' || e.key === 'V') {
        editor.setTool('select');
      } else if (e.key === 'b' || e.key === 'B') {
        editor.setTool('draw');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = editor.selectedIds[0];
        if (id) {
          updateCurrent((d) => deleteMember(d, id));
          clearSelection();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
        night: useThemeStore.getState().night,
      };
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
    hook.setTool = (tool: 'select' | 'draw') => useEditorStore.getState().setTool(tool);
    hook.setProjection = (p: 'ortho' | 'perspective') => useEditorStore.getState().setProjection(p);
    hook.setDrawSize = (size: '1/2"' | '3/4"') => useEditorStore.getState().setDrawSize(size);
    hook.setLengthsLocked = (locked: boolean) =>
      useAppStore.getState().updateCurrent((doc) => ({ ...doc, lengthsLocked: locked }));
    hook.setNight = (on: boolean) => useThemeStore.getState().setNight(on);
    // drawing / editing seams (world ground points)
    hook.snap = (raw: Vec3) => snapDrawPoint(raw);
    hook.draw = (raw: Vec3) => placeDrawPoint(raw);
    hook.finishPath = () => finishPath();
    hook.selectMember = (id: string) => selectMember(id);
    hook.clearSelection = () => clearSelection();
    hook.setMemberLength = (id: string, lengthM: number) => setMemberLength(id, lengthM);
    hook.dragNode = (id: string, raw: Vec3) => dragNodeTo(id, raw);
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
      </div>

      {/* selected-member inspector (top-center) */}
      <SelectionPanel />

      {/* tool pillbox (bottom-center) */}
      <Pillbox />

      {/* top-right: undo/redo + view + physics + theme toggles */}
      <div className="absolute top-4 right-4 flex items-center gap-1 rounded-lg border border-border bg-card px-1.5 py-1.5 shadow-sm">
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
