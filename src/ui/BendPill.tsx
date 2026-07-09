import { Check } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';

/** Options for the Bend tool (shown top-centre while it is active): drag a pipe
 * to bend it; "lock end angles" keeps the pipe's ends straight so the bend eases
 * in from a short distance past each end; "lock length" holds the pipe's material
 * length so the far end draws in as you bend instead of the pipe growing. */
export function BendPill() {
  const tool = useEditorStore((s) => s.tool);
  const lockEndAngles = useEditorStore((s) => s.bendLockEndAngles);
  const setLock = useEditorStore((s) => s.setBendLockEndAngles);
  const lengthLock = useEditorStore((s) => s.bendLengthLock);
  const setLengthLock = useEditorStore((s) => s.setBendLengthLock);
  if (tool !== 'bend') return null;
  const toggle = (on: boolean, onClick: () => void, label: string) => (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
        on
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      }`}
    >
      {on && <Check size={12} />} {label}
    </button>
  );
  return (
    <div className="-translate-x-1/2 absolute top-4 left-1/2 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
      <span className="text-[11px] text-muted-foreground">
        Drag a pipe to bend it · drag the orange points to tweak
      </span>
      <div className="h-5 w-px bg-border" />
      {toggle(lockEndAngles, () => setLock(!lockEndAngles), 'Lock end angles')}
      {toggle(lengthLock, () => setLengthLock(!lengthLock), 'Lock length')}
    </div>
  );
}
