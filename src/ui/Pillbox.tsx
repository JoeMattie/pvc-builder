import {
  Cable,
  CornerUpRight,
  MousePointer2,
  Move3d,
  Pencil,
  RotateCw,
  Ruler,
  Spline,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { NominalSize } from '../schema';
import { type Tool, useEditorStore } from '../state/editorStore';

const SIZES: NominalSize[] = ['1/2"', '3/4"'];

/** The tools, in pillbox order, with their icon, label, and visible hotkey. */
const TOOLS: { id: Tool; icon: ComponentType<{ size?: number }>; label: string; key?: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select', key: 'V' },
  { id: 'draw', icon: Pencil, label: 'Draw', key: 'D' },
  { id: 'move', icon: Move3d, label: 'Move', key: 'M' },
  { id: 'rotate', icon: RotateCw, label: 'Rotate' },
  { id: 'formed', icon: Spline, label: 'Curve', key: 'C' },
  { id: 'bend', icon: CornerUpRight, label: 'Bend', key: 'B' },
  { id: 'measure', icon: Ruler, label: 'Measure', key: 'T' },
  { id: 'elastic', icon: Cable, label: 'Band', key: 'E' },
];

/** Floating tool pillbox (planfile §1): each tool with its icon + visible
 * hotkey badge, plus the active pipe size the draw tool lays. */
export function Pillbox() {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const drawSize = useEditorStore((s) => s.drawSize);
  const setDrawSize = useEditorStore((s) => s.setDrawSize);

  return (
    <div className="-translate-x-1/2 absolute bottom-5 left-1/2 flex items-center gap-1 rounded-xl border border-border bg-card px-1.5 py-1.5 shadow-md">
      {TOOLS.map(({ id, icon: Icon, label, key }) => {
        const active = tool === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => setTool(id)}
            title={key ? `${label} (${key})` : label}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <Icon size={15} /> {label}
            {key && (
              <kbd
                className={`ml-0.5 rounded px-1 py-px font-mono text-[10px] leading-none ${
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

      <div className="mx-0.5 h-6 w-px bg-border" />

      <fieldset className="flex items-center gap-1 border-0 p-0 m-0" aria-label="Pipe size">
        {SIZES.map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={drawSize === size}
            onClick={() => setDrawSize(size)}
            className={`rounded-lg px-2.5 py-1.5 font-medium text-xs tabular-nums ${
              drawSize === size
                ? 'bg-accent text-accent-foreground ring-1 ring-ring/40'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {size}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
