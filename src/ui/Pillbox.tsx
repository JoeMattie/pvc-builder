import {
  ArrowUpFromDot,
  Cable,
  CornerUpRight,
  Group as GroupIcon,
  Lock,
  LockOpen,
  MousePointer2,
  Move3d,
  Pencil,
  PenLine,
  RotateCw,
  Ruler,
  Spline,
  UnfoldHorizontal,
  UnfoldVertical,
  Ungroup,
} from 'lucide-react';
import { Tooltip } from 'radix-ui';
import type { ComponentType, ReactNode } from 'react';
import type { NominalSize } from '../schema';
import { useAppStore } from '../state/appStore';
import { groupSelection, ungroupSelection } from '../state/editorActions';
import { type Tool, type ToolPaletteLayout, useEditorStore } from '../state/editorStore';

const SIZES: NominalSize[] = ['1/2"', '3/4"'];

/** The tools, in pillbox order, with their icon, label, and visible hotkey. */
const TOOLS: { id: Tool; icon: ComponentType<{ size?: number }>; label: string; key?: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select', key: 'V' },
  { id: 'draw', icon: Pencil, label: 'Draw', key: 'D' },
  { id: 'extend', icon: ArrowUpFromDot, label: 'Extend', key: 'P' },
  { id: 'move', icon: Move3d, label: 'Move', key: 'M' },
  { id: 'rotate', icon: RotateCw, label: 'Rotate', key: 'R' },
  { id: 'formed', icon: Spline, label: 'Curve', key: 'C' },
  { id: 'bend', icon: CornerUpRight, label: 'Bend', key: 'B' },
  { id: 'measure', icon: Ruler, label: 'Measure', key: 'T' },
  { id: 'guide', icon: PenLine, label: 'Guide', key: 'Q' },
  { id: 'elastic', icon: Cable, label: 'Band', key: 'E' },
];

function ToolbarTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={7}
            className="z-[120] max-w-56 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground shadow-lg"
          >
            {label}
            <Tooltip.Arrow className="fill-card" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/** Floating tool pillbox (planfile §1): each tool with its icon + visible
 * hotkey badge, plus the active pipe size the draw tool lays. */
export function Pillbox({ layout }: { layout?: ToolPaletteLayout }) {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const drawSize = useEditorStore((s) => s.drawSize);
  const setDrawSize = useEditorStore((s) => s.setDrawSize);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const enteredGroupId = useEditorStore((s) => s.enteredGroupId);
  const preferredLayout = useEditorStore((s) => s.toolPaletteLayout);
  const toggleToolPaletteLayout = useEditorStore((s) => s.toggleToolPaletteLayout);
  const lengthsLocked = useAppStore((s) => s.current?.lengthsLocked ?? false);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const groupSig = useAppStore((s) => {
    const d = s.current;
    return d ? d.groups.map((g) => `${g.id}:${g.memberIds.join('.')}`).join('|') : '';
  });

  const activeLayout = layout ?? preferredLayout;
  const vertical = activeLayout === 'vertical';
  const design = useAppStore.getState().current;
  void groupSig;
  const canGroup = selectedIds.length >= 1;
  const canUngroup =
    !!enteredGroupId ||
    !!design?.groups.some((g) => selectedIds.some((id) => g.memberIds.includes(id)));
  const setLengthsLocked = (locked: boolean) =>
    updateCurrent((doc) => ({ ...doc, lengthsLocked: locked }));
  const buttonClass = (active = false, disabled = false) =>
    `flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${
      vertical ? 'w-full justify-start' : ''
    } ${
      disabled
        ? 'cursor-not-allowed text-muted-foreground/35'
        : active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
    }`;
  const Separator = () => (
    <div className={vertical ? 'my-0.5 h-px w-full bg-border' : 'mx-0.5 h-6 w-px bg-border'} />
  );

  return (
    <div
      className={`scrollbar-minimal flex gap-1 px-1 py-1 ${
        vertical
          ? 'max-h-[calc(100vh-8rem)] w-max flex-col items-stretch overflow-y-auto'
          : 'max-w-[calc(100vw-4rem)] flex-wrap items-center justify-center'
      }`}
    >
      {TOOLS.map(({ id, icon: Icon, label, key }) => {
        const active = tool === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => setTool(id)}
            title={key ? `${label} (${key})` : label}
            className={buttonClass(active)}
          >
            <Icon size={15} />{' '}
            <span className={vertical ? 'inline' : 'hidden lg:inline'}>{label}</span>
            {key && (
              <kbd
                className={`ml-0.5 rounded px-1 py-px font-mono text-[10px] leading-none ${
                  vertical ? 'ml-auto inline' : 'hidden 2xl:inline'
                } ${
                  active
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {key}
              </kbd>
            )}
          </button>
        );
      })}

      <Separator />

      <ToolbarTooltip label="Group selected objects. Shortcut: G.">
        <button
          type="button"
          aria-disabled={!canGroup}
          aria-label="Group selection"
          onClick={() => {
            if (canGroup) groupSelection();
          }}
          className={buttonClass(false, !canGroup)}
        >
          <GroupIcon size={15} />
          <kbd
            className={`rounded bg-muted px-1 py-px font-mono text-[10px] leading-none text-muted-foreground ${
              vertical ? '' : 'hidden 2xl:inline'
            }`}
          >
            G
          </kbd>
        </button>
      </ToolbarTooltip>
      <ToolbarTooltip label="Ungroup selected or entered group. Shortcut: Shift+G.">
        <button
          type="button"
          aria-disabled={!canUngroup}
          aria-label="Ungroup selection"
          onClick={() => {
            if (canUngroup) ungroupSelection();
          }}
          className={buttonClass(false, !canUngroup)}
        >
          <Ungroup size={15} />
          <kbd
            className={`rounded bg-muted px-1 py-px font-mono text-[10px] leading-none text-muted-foreground ${
              vertical ? '' : 'hidden 2xl:inline'
            }`}
          >
            ⇧G
          </kbd>
        </button>
      </ToolbarTooltip>

      <ToolbarTooltip label="Lock member lengths while dragging endpoints and pivots.">
        <button
          type="button"
          aria-pressed={lengthsLocked}
          aria-label="Toggle locked-length dragging"
          onClick={() => setLengthsLocked(!lengthsLocked)}
          className={buttonClass(lengthsLocked)}
        >
          {lengthsLocked ? <Lock size={15} /> : <LockOpen size={15} />}
          <span className={vertical ? 'inline' : 'hidden xl:inline'}>Drag lock</span>
        </button>
      </ToolbarTooltip>

      <Separator />

      <fieldset
        className={`flex gap-1 border-0 p-0 m-0 ${vertical ? 'flex-col' : 'items-center'}`}
        aria-label="Pipe size"
      >
        {SIZES.map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={drawSize === size}
            onClick={() => setDrawSize(size)}
            className={`rounded-md px-2 py-1.5 font-medium text-xs tabular-nums ${
              vertical ? 'w-full text-left' : ''
            } ${
              drawSize === size
                ? 'bg-accent text-accent-foreground ring-1 ring-ring/40'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {size}
          </button>
        ))}
      </fieldset>

      <Separator />

      <ToolbarTooltip
        label={`Switch tools to ${preferredLayout === 'horizontal' ? 'vertical' : 'horizontal'} layout.`}
      >
        <button
          type="button"
          aria-label="Toggle tool palette layout"
          onClick={toggleToolPaletteLayout}
          className={buttonClass(false)}
        >
          {preferredLayout === 'horizontal' ? (
            <UnfoldVertical size={15} />
          ) : (
            <UnfoldHorizontal size={15} />
          )}
          <span className={vertical ? 'inline' : 'sr-only'}>Layout</span>
        </button>
      </ToolbarTooltip>
    </div>
  );
}
