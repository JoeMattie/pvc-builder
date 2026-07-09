import { Trash2 } from 'lucide-react';
import { elasticLengthM } from '../design/docOps';
import { useAppStore } from '../state/appStore';
import { deleteElastic, setElasticTension } from '../state/editorActions';
import { useEditorStore } from '../state/editorStore';
import { formatLengthDisplay } from './units';

/** Tension range for the slider (N/m, real). 0 = a limp band; the upper bound is
 * a firm pull that still settles stably in the sim. */
const MIN_TENSION = 0;
const MAX_TENSION = 600;

/** Floating panel for the selected elastic band (top-center, under the selection
 * inspector): a tension slider wired to the band's stiffness, plus its current /
 * rest span and a delete button. Mirrors BendPill / PivotPanel. */
export function ElasticPanel() {
  const selectedId = useEditorStore((s) => s.selectedElasticId);
  const design = useAppStore((s) => s.current);
  if (!selectedId || !design) return null;
  const band = design.elastics.find((e) => e.id === selectedId);
  if (!band) return null;

  const span = elasticLengthM(design, band);
  const units = design.lengthDisplay;

  return (
    <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-3 rounded-xl border border-border bg-card px-3 py-2 shadow-md">
      <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
        Band
      </span>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Tension
        <input
          type="range"
          min={MIN_TENSION}
          max={MAX_TENSION}
          step={5}
          value={Math.round(band.stiffnessNPerM)}
          aria-label="Band tension"
          onChange={(e) => setElasticTension(band.id, Number(e.target.value))}
          className="w-40 accent-primary"
        />
        <span className="w-16 tabular-nums text-foreground">
          {Math.round(band.stiffnessNPerM)} N/m
        </span>
      </label>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {formatLengthDisplay(span, units)} / rest {formatLengthDisplay(band.restLengthM, units)}
      </span>
      <button
        type="button"
        onClick={() => deleteElastic(band.id)}
        title="Delete band (Delete)"
        aria-label="Delete band"
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
