import { Bug, Gauge, Lock, LockOpen, PersonStanding, Play, RotateCcw, Square } from 'lucide-react';
import { useAppStore } from '../../state/appStore';
import { resetPivots, setJointDamping, setMannequin } from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';

function chipClass(active = false): string {
  return active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground';
}

/** Dedicated Simulate workspace controls. The tab is intentionally separate
 * from Play: users can inspect assumptions and prepare the sim before running
 * the live CrashCat physics world. */
export function SimulationPanel() {
  const design = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const simulating = useEditorStore((s) => s.simulating);
  const setSimulating = useEditorStore((s) => s.setSimulating);
  const physicsDebug = useEditorStore((s) => s.physicsDebug);
  const setPhysicsDebug = useEditorStore((s) => s.setPhysicsDebug);

  if (!design) return null;

  const lengthsLocked = design.lengthsLocked;
  const damping = design.jointDamping ?? 1;
  const jointCount = design.joints.length;
  const elasticCount = design.elastics.length;
  const setLengthsLocked = (locked: boolean) =>
    updateCurrent((doc) => ({ ...doc, lengthsLocked: locked }));

  return (
    <div className="w-[min(92vw,22rem)] rounded-xl border border-border bg-card p-3 shadow-md">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
            Simulate
          </div>
          <div className="truncate text-sm font-medium">
            {simulating ? 'Physics live' : 'Design pose'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSimulating(!simulating)}
          aria-pressed={simulating}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${
            simulating
              ? 'bg-primary text-primary-foreground'
              : 'bg-accent text-accent-foreground hover:bg-accent/80'
          }`}
        >
          {simulating ? <Square size={13} /> : <Play size={13} />}
          {simulating ? 'Stop' : 'Play'}
        </button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-1 text-[10px]">
        <span className={`rounded px-1.5 py-1 ${chipClass(lengthsLocked)}`}>
          lengths {lengthsLocked ? 'locked' : 'free'}
        </span>
        <span className={`rounded px-1.5 py-1 ${chipClass(simulating)}`}>
          {simulating ? 'CrashCat running' : 'ready'}
        </span>
        <span className="rounded bg-muted px-1.5 py-1 text-muted-foreground">
          joints {jointCount}
        </span>
        <span className="rounded bg-muted px-1.5 py-1 text-muted-foreground">
          elastics {elasticCount}
        </span>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Gauge size={13} />
          Damping
          <input
            type="range"
            min={0.2}
            max={5}
            step={0.1}
            value={damping}
            aria-label="Joint damping"
            onChange={(e) => setJointDamping(Number(e.target.value))}
            className="min-w-0 flex-1 accent-primary"
          />
          <span className="w-10 text-right tabular-nums text-foreground">
            {damping.toFixed(1)}×
          </span>
        </label>

        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => setLengthsLocked(!lengthsLocked)}
            aria-pressed={lengthsLocked}
            className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium ${
              lengthsLocked
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {lengthsLocked ? <Lock size={13} /> : <LockOpen size={13} />}
            Lengths
          </button>
          <button
            type="button"
            onClick={() => setMannequin(!design.mannequin)}
            aria-pressed={design.mannequin}
            className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium ${
              design.mannequin
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <PersonStanding size={13} />
            Body
          </button>
          <button
            type="button"
            onClick={() => setPhysicsDebug(!physicsDebug)}
            aria-pressed={physicsDebug}
            className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium ${
              physicsDebug
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <Bug size={13} />
            Debug
          </button>
          <button
            type="button"
            onClick={() => {
              setSimulating(false);
              resetPivots();
            }}
            className="flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <RotateCcw size={13} />
            Reset
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-1">pivots constrain motion</span>
        <span className="rounded bg-muted px-1.5 py-1">elastics pull live</span>
        <span className="rounded bg-muted px-1.5 py-1">pipe collisions off</span>
        <span className="rounded bg-muted px-1.5 py-1">body is static</span>
      </div>
    </div>
  );
}
