import { Box, ChevronLeft, Lock, LockOpen, Moon, Sun } from 'lucide-react';
import { useEffect } from 'react';
import { useAppStore } from '../state/appStore';
import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/themeStore';
import { Viewport } from './scene/Viewport';

/** The editor: the 3D viewport plus floating chrome. Phase 0 ships the
 * viewport, a project name / back control, and the projection + lengths-lock +
 * theme toggles. Drawing tools, the pillbox, and inspectors arrive in later
 * phases. */
export function EditorShell() {
  const design = useAppStore((s) => s.current);
  const closeProject = useAppStore((s) => s.closeProject);
  const updateCurrent = useAppStore((s) => s.updateCurrent);

  const projection = useEditorStore((s) => s.projection);
  const toggleProjection = useEditorStore((s) => s.toggleProjection);

  const night = useThemeStore((s) => s.night);
  const toggleNight = useThemeStore((s) => s.toggleNight);

  const lengthsLocked = design?.lengthsLocked ?? false;
  const setLengthsLocked = (locked: boolean) =>
    updateCurrent((doc) => ({ ...doc, lengthsLocked: locked }));

  // test/debug hook (planfile §7): lets scripted checks assert on the live
  // document and drive editor state. Merged (not replaced) so seams published
  // by children survive this initializer regardless of effect ordering.
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
        night: useThemeStore.getState().night,
      };
    };
    hook.setTool = (tool: 'select' | 'draw') => useEditorStore.getState().setTool(tool);
    hook.setProjection = (p: 'ortho' | 'perspective') => useEditorStore.getState().setProjection(p);
    hook.setLengthsLocked = (locked: boolean) =>
      useAppStore.getState().updateCurrent((doc) => ({ ...doc, lengthsLocked: locked }));
    hook.setNight = (on: boolean) => useThemeStore.getState().setNight(on);
  }, []);

  if (!design) return null;

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
          <span className="text-sm font-medium">{design.name}</span>
        </div>
      </div>

      {/* top-right: view + physics + theme toggles */}
      <div className="absolute top-4 right-4 flex items-center gap-1 rounded-lg border border-border bg-card px-1.5 py-1.5 shadow-sm">
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
