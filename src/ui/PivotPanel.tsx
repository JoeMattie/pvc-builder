import { RotateCcw, Trash2 } from 'lucide-react';
import { removePivot } from '../design/docOps';
import { solve } from '../solver';
import { useAppStore } from '../state/appStore';
import { pivotAnglesOf, resetPivots, setPivotAngle } from '../state/editorActions';

const DEG = 180 / Math.PI;

/** Locked-mode pivot controls (planfile §5): a mobility/over-constrained
 * readout and an angle slider per pivot. Only shown when lengths are locked and
 * the design has pivots. */
export function PivotPanel() {
  const design = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  if (!design?.lengthsLocked || !design.pivots.length) return null;

  const { diagnostics } = solve(
    design,
    { lengthsLocked: true, pivotAngles: pivotAnglesOf(design) },
    'pose',
  );

  return (
    <div className="absolute top-20 right-4 w-56 rounded-xl border border-border bg-card p-3 shadow-md">
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
            title="Reset all pivots (R)"
            aria-label="Reset pivots"
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      {design.pivots.map((pv, i) => {
        const deg = Math.round((pv.angleRad ?? 0) * DEG);
        return (
          <div key={pv.id} className="mb-2 last:mb-0">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Pivot {i + 1}</span>
              <span className="flex items-center gap-1">
                <span className="tabular-nums text-foreground">{deg}°</span>
                <button
                  type="button"
                  aria-label={`Delete pivot ${i + 1}`}
                  onClick={() => updateCurrent((d) => removePivot(d, pv.id))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
            <input
              type="range"
              min={-180}
              max={180}
              value={deg}
              aria-label={`Pivot ${i + 1} angle`}
              onChange={(e) => setPivotAngle(pv.id, Number(e.target.value) / DEG)}
              className="w-full accent-primary"
            />
          </div>
        );
      })}
    </div>
  );
}
