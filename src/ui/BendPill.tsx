import { Check } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';

/** Options for the Bend tool (shown top-centre while it is active): drag a pipe
 * to bend it; "lock end angles" keeps the pipe's ends straight so the bend eases
 * in from a short distance past each end. */
export function BendPill() {
  const tool = useEditorStore((s) => s.tool);
  const lockEndAngles = useEditorStore((s) => s.bendLockEndAngles);
  const setLock = useEditorStore((s) => s.setBendLockEndAngles);
  if (tool !== 'bend') return null;
  return (
    <div className="-translate-x-1/2 absolute top-4 left-1/2 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
      <span className="text-[11px] text-muted-foreground">
        Drag a pipe to bend it · drag the orange points to tweak
      </span>
      <div className="h-5 w-px bg-border" />
      <button
        type="button"
        aria-pressed={lockEndAngles}
        onClick={() => setLock(!lockEndAngles)}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
          lockEndAngles
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        }`}
      >
        {lockEndAngles && <Check size={12} />} Lock end angles
      </button>
    </div>
  );
}
