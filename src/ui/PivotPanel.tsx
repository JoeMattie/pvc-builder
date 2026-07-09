import { RotateCcw, Trash2 } from 'lucide-react';
import { solve } from '../solver';
import { useAppStore } from '../state/appStore';
import {
  jointOrientationsOf,
  pivotAnglesOf,
  resetPivots,
  setJoinMode,
  setPivotAngle,
} from '../state/editorActions';
import { useEditorStore } from '../state/editorStore';

const DEG = 180 / Math.PI;

/** Locked-mode pivot controls (planfile §5): a mobility/over-constrained readout,
 * plus an angle slider per WRAPPED pivot (free ball joints are posed by dragging,
 * so they have no slider). Only shown when lengths are locked and pivots exist. */
export function PivotPanel() {
  const design = useAppStore((s) => s.current);
  const simulating = useEditorStore((s) => s.simulating);
  const physicsDebug = useEditorStore((s) => s.physicsDebug);
  if (!design?.lengthsLocked || !design.joints.length) return null;

  const wrapped = design.joints.filter((j) => j.mode === 'wrapped');
  const freeCount = design.joints.filter((j) => j.mode === 'free').length;
  if (!wrapped.length && !freeCount) return null;

  const { diagnostics } = solve(
    design,
    {
      lengthsLocked: true,
      pivotAngles: pivotAnglesOf(design),
      jointOrientations: jointOrientationsOf(design),
    },
    'pose',
  );

  return (
    <div className="absolute top-20 right-4 w-72 rounded-xl border border-border bg-card p-3 shadow-md">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
          Pivots
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
              diagnostics.overConstrained
                ? 'bg-destructive/15 text-destructive'
                : 'bg-accent text-accent-foreground'
            }`}
          >
            {diagnostics.overConstrained ? 'over-locked' : `${diagnostics.mobilityDof} DOF`}
          </span>
          <button
            type="button"
            onClick={() => resetPivots()}
            title="Reset all pivots"
            aria-label="Reset pivots"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <RotateCcw size={13} />
            Reset
          </button>
        </div>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-1">pose: closed-form kinematics</span>
        <span className="rounded bg-muted px-1.5 py-1">
          physics: {simulating ? 'Play live' : 'idle'}
        </span>
        <span className="rounded bg-muted px-1.5 py-1">pipe collisions: off</span>
        <span className="rounded bg-muted px-1.5 py-1">
          mannequin: {design.mannequin ? 'on' : 'off'}
        </span>
        <span className="rounded bg-muted px-1.5 py-1">
          damping: {(design.jointDamping ?? 1).toFixed(1)}×
        </span>
        <span className="rounded bg-muted px-1.5 py-1">
          debug: {physicsDebug ? 'shown' : 'hidden'}
        </span>
      </div>

      {wrapped.map((j, i) => {
        const deg = Math.round((j.angleRad ?? 0) * DEG);
        const minDeg = Math.round((j.limits?.minRad ?? -Math.PI) * DEG);
        const maxDeg = Math.round((j.limits?.maxRad ?? Math.PI) * DEG);
        const sliderDeg = Math.min(maxDeg, Math.max(minDeg, deg));
        return (
          <div key={j.id} className="mb-2 last:mb-0">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Wrapped {i + 1}</span>
              <span className="flex items-center gap-1">
                <span className="tabular-nums text-foreground">{deg}°</span>
                <button
                  type="button"
                  aria-label={`Reset wrapped pivot ${i + 1}`}
                  title="Reset this pivot angle"
                  onClick={() => setPivotAngle(j.id, 0)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw size={12} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove wrapped pivot ${i + 1}`}
                  onClick={() => setJoinMode(j.nodeId, j.mover, 'anchor')}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{j.limits ? 'Limits' : 'Slider range'}</span>
              <span className="tabular-nums">
                {minDeg}° to {maxDeg}°
              </span>
            </div>
            <input
              type="range"
              min={minDeg}
              max={maxDeg}
              value={sliderDeg}
              aria-label={`Wrapped pivot ${i + 1} angle`}
              onChange={(e) => setPivotAngle(j.id, Number(e.target.value) / DEG)}
              className="w-full accent-primary"
            />
          </div>
        );
      })}

      {freeCount > 0 && (
        <div className="mt-2 rounded-md border border-border bg-muted/35 px-2 py-1.5 text-[11px] text-muted-foreground">
          {freeCount} free ball joint{freeCount === 1 ? '' : 's'}: orientation is 3-DOF and resets
          with the global pivot reset.
        </div>
      )}
    </div>
  );
}
