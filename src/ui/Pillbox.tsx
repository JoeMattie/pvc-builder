import { MousePointer2, Pencil } from 'lucide-react';
import type { NominalSize } from '../schema';
import { useEditorStore } from '../state/editorStore';

const SIZES: NominalSize[] = ['1/2"', '3/4"'];

/** Floating tool pillbox (planfile §1): the tool (select / draw) plus the
 * active pipe size the draw tool lays. */
export function Pillbox() {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const drawSize = useEditorStore((s) => s.drawSize);
  const setDrawSize = useEditorStore((s) => s.setDrawSize);

  return (
    <div className="-translate-x-1/2 absolute bottom-5 left-1/2 flex items-center gap-1 rounded-xl border border-border bg-card px-1.5 py-1.5 shadow-md">
      <button
        type="button"
        aria-pressed={tool === 'select'}
        onClick={() => setTool('select')}
        title="Select (V)"
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
          tool === 'select'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        }`}
      >
        <MousePointer2 size={15} /> Select
      </button>
      <button
        type="button"
        aria-pressed={tool === 'draw'}
        onClick={() => setTool('draw')}
        title="Draw pipe (B)"
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
          tool === 'draw'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        }`}
      >
        <Pencil size={15} /> Draw
      </button>

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
