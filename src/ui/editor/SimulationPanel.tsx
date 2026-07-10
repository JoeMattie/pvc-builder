import { Bug, Gauge, PersonStanding, RotateCcw } from 'lucide-react';
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
  const simulating = useEditorStore((s) => s.simulating);
  const setSimulating = useEditorStore((s) => s.setSimulating);
  const physicsDebug = useEditorStore((s) => s.physicsDebug);
  const setPhysicsDebug = useEditorStore((s) => s.setPhysicsDebug);

  if (!design) return null;

  const damping = design.jointDamping ?? 1;
  const jointCount = design.joints.length;
  const elasticCount = design.elastics.length;

  return (
    // no card chrome — this renders as the workflow panel's Simulate tab body;
    // Play/Stop lives in the tab strip (EditorWorkflowStatus). The old static
    // explainer chips (pipe collisions off, body is static, …) moved to Help —
    // they read as toggles but were facts of the engine.
    <div className="w-full px-1 pb-1">
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setMannequin(!design.mannequin)}
          aria-pressed={design.mannequin}
          title="Toggle the static mannequin body the design rests on"
          className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium ${
            design.mannequin
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          <PersonStanding size={13} />
          Body
        </button>
        <button
          type="button"
          onClick={() => setPhysicsDebug(!physicsDebug)}
          aria-pressed={physicsDebug}
          aria-label="Physics debug overlay"
          title="Physics debug overlay (bodies + constraints)"
          className={`flex items-center justify-center rounded-md p-1.5 ${
            physicsDebug
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          <Bug size={14} />
        </button>
        <button
          type="button"
          onClick={() => {
            setSimulating(false);
            resetPivots();
          }}
          aria-label="Stop and reset pivots"
          title="Stop the sim and reset all pivots"
          className="flex items-center justify-center rounded-md bg-muted p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      <label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
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
        <span className="w-10 text-right tabular-nums text-foreground">{damping.toFixed(1)}×</span>
      </label>

      <div className="flex flex-wrap gap-1 text-[10px]">
        <span className={`rounded px-1.5 py-1 ${chipClass(simulating)}`}>
          {simulating ? 'physics running' : 'physics idle'}
        </span>
        <span className="rounded bg-muted px-1.5 py-1 text-muted-foreground">
          joints {jointCount}
        </span>
        <span className="rounded bg-muted px-1.5 py-1 text-muted-foreground">
          elastics {elasticCount}
        </span>
      </div>
    </div>
  );
}
