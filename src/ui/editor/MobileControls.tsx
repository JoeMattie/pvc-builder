import {
  Axis3d,
  Check,
  Command,
  FileDown,
  FileUp,
  Group as GroupIcon,
  HelpCircle,
  Lock,
  LockOpen,
  Moon,
  MoreHorizontal,
  MousePointer2,
  Move3d,
  Pencil,
  Redo2,
  RotateCw,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  Ungroup,
  Waypoints,
  X,
} from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useState } from 'react';
import { useAppStore } from '../../state/appStore';
import { setView, VIEW_PRESETS, type ViewName } from '../../state/cameraStore';
import {
  clearSelection,
  deleteMembers,
  finishFormed,
  finishPath,
  groupSelection,
  placeDrawAtDistance,
  ungroupSelection,
} from '../../state/editorActions';
import { type Tool, useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { SnapPill } from '../SnapPill';
import { UnitsPill } from '../UnitsPill';
import { parseLength } from '../units';
import { useResponsiveLayout } from './useResponsiveLayout';

const PRIMARY: { id: Tool; label: string; icon: typeof MousePointer2 }[] = [
  { id: 'select', label: 'Select', icon: MousePointer2 },
  { id: 'draw', label: 'Draw', icon: Pencil },
  { id: 'move', label: 'Move', icon: Move3d },
  { id: 'rotate', label: 'Rotate', icon: RotateCw },
];

const SECONDARY: { id: Tool; label: string }[] = [
  { id: 'formed', label: 'Formed pipe' },
  { id: 'extend', label: 'Extend' },
  { id: 'bend', label: 'Bend' },
  { id: 'measure', label: 'Measure' },
  { id: 'guide', label: 'Guide' },
  { id: 'elastic', label: 'Elastic band' },
];

function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/30" />
        <Dialog.Content
          aria-describedby={undefined}
          data-mobile-sheet={title.toLowerCase()}
          data-viewport-occluder
          className="fixed right-0 bottom-0 left-0 z-[120] max-h-[min(78dvh,40rem)] overflow-y-auto rounded-t-2xl border border-border bg-card shadow-2xl outline-none"
          style={{
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
          }}
        >
          <div className="sticky top-0 z-10 flex min-h-12 items-center justify-between border-border/70 border-b bg-card py-2">
            <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={`Close ${title}`}
                className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-accent"
              >
                <X size={20} />
              </button>
            </Dialog.Close>
          </div>
          <div className="space-y-3 pt-3">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RowButton({
  label,
  icon,
  onClick,
  pressed,
  disabled,
}: {
  label: string;
  icon?: React.ReactNode;
  onClick(): void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={`flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 text-left text-sm font-medium disabled:opacity-40 ${pressed ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-accent'}`}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {pressed && <Check size={16} />}
    </button>
  );
}

function ExactLength() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const display = useAppStore((s) => s.current?.lengthDisplay);
  const commit = () => {
    const metres = parseLength(value, display);
    if (metres && placeDrawAtDistance(metres)) {
      setValue('');
      setOpen(false);
    }
  };
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-xl border border-border bg-card px-3 text-sm font-medium shadow-lg"
      >
        Exact length
      </button>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
      className="flex items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-lg"
    >
      <input
        inputMode="decimal"
        aria-label="Exact pipe length"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button
        type="submit"
        className="h-11 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
      >
        Add
      </button>
    </form>
  );
}

export function MobileDrawControls() {
  const tool = useEditorStore((s) => s.tool);
  const drawing = useEditorStore((s) => !!s.drawingFromNodeId);
  const formed = useEditorStore((s) => s.formedPoints.length > 0);
  const { visualViewport } = useResponsiveLayout();
  if (!(tool === 'draw' && drawing) && !(tool === 'formed' && formed)) return null;
  const cancel = () => {
    if (tool === 'draw') finishPath();
    else useEditorStore.getState().clearFormedPoints();
  };
  return (
    <div
      data-mobile-draw-controls
      data-viewport-occluder
      className="pointer-events-auto fixed right-2 left-2 z-40 flex items-end justify-center gap-2 sm:hidden"
      style={{ top: Math.max(8, visualViewport.offsetTop + visualViewport.height - 132) }}
    >
      {tool === 'draw' && <ExactLength />}
      <button
        type="button"
        onClick={tool === 'draw' ? finishPath : finishFormed}
        className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg"
      >
        Finish
      </button>
      <button
        type="button"
        onClick={cancel}
        className="min-h-11 rounded-xl border border-border bg-card px-4 text-sm font-semibold shadow-lg"
      >
        Cancel
      </button>
    </div>
  );
}

export interface MobileControlsProps {
  showBottomStrip: boolean;
  onExportJson(): void;
  onImportJson(): void;
  onResetWorkspace(): void;
  onHelp(): void;
}

export function MobileControls({
  showBottomStrip,
  onExportJson,
  onImportJson,
  onResetWorkspace,
  onHelp,
}: MobileControlsProps) {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const sheet = useEditorStore((s) => s.mobileSheet);
  const setSheet = useEditorStore((s) => s.setMobileSheet);
  const navigationMode = useEditorStore((s) => s.navigationMode);
  const setNavigationMode = useEditorStore((s) => s.setNavigationMode);
  const multi = useEditorStore((s) => s.mobileMultiSelect);
  const setMulti = useEditorStore((s) => s.setMobileMultiSelect);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const drawSize = useEditorStore((s) => s.drawSize);
  const setDrawSize = useEditorStore((s) => s.setDrawSize);
  const projection = useEditorStore((s) => s.projection);
  const wireframe = useEditorStore((s) => s.wireframe);
  const effects = useEditorStore((s) => s.rendererEffects);
  const night = useThemeStore((s) => s.night);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const lengthsLocked = useAppStore((s) => s.current?.lengthsLocked ?? false);
  const groups = useAppStore((s) => s.current?.groups ?? []);
  const canUngroup = groups.some((group) => selectedIds.some((id) => group.memberIds.includes(id)));
  const close = () => setSheet(null);

  return (
    <>
      {showBottomStrip && (
        <nav
          aria-label="Primary tools"
          data-mobile-primary-tools
          data-viewport-occluder
          className="pointer-events-auto fixed right-0 bottom-0 left-0 z-50 grid grid-cols-5 border-border/80 border-t bg-card/95 px-1 pt-1 shadow-xl backdrop-blur-md sm:hidden"
          style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))' }}
        >
          {PRIMARY.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={tool === id}
              onClick={() => setTool(id)}
              className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium ${tool === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
          <button
            type="button"
            aria-expanded={sheet === 'more'}
            onClick={() => setSheet('more')}
            className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium text-muted-foreground"
          >
            <MoreHorizontal size={20} />
            More
          </button>
        </nav>
      )}

      <button
        type="button"
        aria-label="Mobile commands"
        onClick={() => setSheet('commands')}
        data-mobile-command-trigger
        className="pointer-events-auto fixed top-2 right-2 z-50 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card/95 shadow-lg sm:hidden"
        style={{
          top: 'max(0.5rem, env(safe-area-inset-top))',
          right: 'max(0.5rem, env(safe-area-inset-right))',
        }}
      >
        <Command size={19} />
      </button>

      <div
        className="pointer-events-auto fixed right-2 z-40 flex gap-2 sm:hidden"
        style={{ top: 'max(3.75rem, calc(env(safe-area-inset-top) + 3.75rem))' }}
      >
        <button
          type="button"
          aria-pressed={navigationMode === 'edit'}
          onClick={() => setNavigationMode('edit')}
          className={`h-11 rounded-xl border px-3 text-xs font-semibold shadow ${navigationMode === 'edit' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}
        >
          Edit
        </button>
        <button
          type="button"
          aria-pressed={navigationMode === 'orbit'}
          onClick={() => setNavigationMode('orbit')}
          className={`h-11 rounded-xl border px-3 text-xs font-semibold shadow ${navigationMode === 'orbit' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}
        >
          Orbit
        </button>
      </div>

      <Sheet
        open={sheet === 'more'}
        onOpenChange={(open) => setSheet(open ? 'more' : null)}
        title="Tools and editing"
      >
        <div className="grid grid-cols-2 gap-2">
          {SECONDARY.map(({ id, label }) => (
            <RowButton
              key={id}
              label={label}
              pressed={tool === id}
              onClick={() => {
                setTool(id);
                close();
              }}
            />
          ))}
        </div>
        <RowButton
          label="Select multiple"
          pressed={multi}
          onClick={() => setMulti(!multi)}
          icon={<MousePointer2 size={18} />}
        />
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="sr-only">Draw pipe size</legend>
          {(['1/2"', '3/4"'] as const).map((size) => (
            <RowButton
              key={size}
              label={`${size} pipe`}
              pressed={drawSize === size}
              onClick={() => setDrawSize(size)}
            />
          ))}
        </fieldset>
        <RowButton
          label="Lock lengths while dragging"
          pressed={lengthsLocked}
          onClick={() =>
            useAppStore
              .getState()
              .updateCurrent((doc) => ({ ...doc, lengthsLocked: !doc.lengthsLocked }))
          }
          icon={lengthsLocked ? <Lock size={18} /> : <LockOpen size={18} />}
        />
        <div className="grid grid-cols-2 gap-2">
          <RowButton
            label="Group"
            disabled={!selectedIds.length}
            onClick={() => {
              groupSelection();
              close();
            }}
            icon={<GroupIcon size={18} />}
          />
          <RowButton
            label="Ungroup"
            disabled={!canUngroup}
            onClick={() => {
              ungroupSelection();
              close();
            }}
            icon={<Ungroup size={18} />}
          />
        </div>
        <RowButton
          label="Delete selection"
          disabled={!selectedIds.length}
          onClick={() => {
            deleteMembers(selectedIds);
            clearSelection();
            close();
          }}
          icon={<Trash2 size={18} />}
        />
        <div className="flex min-h-11 items-center justify-between rounded-xl border border-border px-3">
          <span className="text-sm font-medium">Display units</span>
          <UnitsPill />
        </div>
      </Sheet>

      <Sheet
        open={sheet === 'commands'}
        onOpenChange={(open) => setSheet(open ? 'commands' : null)}
        title="Commands"
      >
        <div className="grid grid-cols-2 gap-2">
          <RowButton label="Undo" onClick={undo} icon={<Undo2 size={18} />} />
          <RowButton label="Redo" onClick={redo} icon={<Redo2 size={18} />} />
        </div>
        <RowButton
          label="Select multiple"
          pressed={multi}
          onClick={() => setMulti(!multi)}
          icon={<MousePointer2 size={18} />}
        />
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Camera
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(VIEW_PRESETS) as ViewName[]).map((name) => (
              <RowButton
                key={name}
                label={name.replace('iso-', 'Iso ').replace(/^./, (c) => c.toUpperCase())}
                onClick={() => {
                  setView(name);
                  close();
                }}
              />
            ))}
          </div>
        </div>
        <RowButton
          label="Perspective projection"
          pressed={projection === 'perspective'}
          onClick={() => useEditorStore.getState().toggleProjection()}
          icon={<Axis3d size={18} />}
        />
        <RowButton
          label="Wireframe"
          pressed={wireframe}
          onClick={() => useEditorStore.getState().toggleWireframe()}
          icon={<Waypoints size={18} />}
        />
        <RowButton
          label="Renderer effects"
          pressed={effects}
          onClick={() => useEditorStore.getState().toggleRendererEffects()}
          icon={<Sparkles size={18} />}
        />
        <div className="flex min-h-11 items-center justify-between rounded-xl border border-border px-3">
          <span className="text-sm font-medium">Snap settings</span>
          <SnapPill />
        </div>
        <div className="flex min-h-11 items-center justify-between rounded-xl border border-border px-3">
          <span className="text-sm font-medium">Display units</span>
          <UnitsPill />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <RowButton
            label="Export design"
            onClick={() => {
              onExportJson();
              close();
            }}
            icon={<FileDown size={18} />}
          />
          <RowButton
            label="Import design"
            onClick={() => {
              onImportJson();
              close();
            }}
            icon={<FileUp size={18} />}
          />
        </div>
        <RowButton
          label="Reset workspace"
          onClick={() => {
            onResetWorkspace();
            close();
          }}
        />
        <RowButton
          label="Help and shortcuts"
          onClick={() => {
            onHelp();
            close();
          }}
          icon={<HelpCircle size={18} />}
        />
        <RowButton
          label={night ? 'Use day theme' : 'Use night theme'}
          pressed={night}
          onClick={() => useThemeStore.getState().toggleNight()}
          icon={night ? <Sun size={18} /> : <Moon size={18} />}
        />
      </Sheet>
      <MobileDrawControls />
    </>
  );
}
