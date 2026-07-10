import {
  AlertTriangle,
  CheckCircle2,
  Combine,
  DraftingCompass,
  Hammer,
  Play,
  PlayCircle,
  Save,
  Square,
} from 'lucide-react';
import { useMemo } from 'react';
import { resolveFittings } from '../../design/fittings';
import { intersectingMembers } from '../../design/intersections';
import { useAppStore } from '../../state/appStore';
import { solveIntersections } from '../../state/editorActions';
import { type SceneStatus, useEditorStore } from '../../state/editorStore';
import { summarizeEditorWarnings } from './editorStatus';

export type EditorWorkflow = SceneStatus;

const WORKFLOWS: {
  id: EditorWorkflow;
  label: string;
  icon: typeof DraftingCompass;
  title: string;
}[] = [
  {
    id: 'design',
    label: 'Design',
    icon: DraftingCompass,
    title: 'Design workflow',
  },
  {
    id: 'fabricate',
    label: 'Fabricate',
    icon: Hammer,
    title: 'Fabrication workflow',
  },
  {
    id: 'simulate',
    label: 'Simulate',
    icon: PlayCircle,
    title: 'Simulation workflow',
  },
];

interface EditorWorkflowStatusProps {
  activeWorkflow: EditorWorkflow;
  onWorkflowChange(workflow: EditorWorkflow): void;
}

function statusChipClass(tone: 'ok' | 'warn' | 'neutral' | 'active'): string {
  if (tone === 'ok') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (tone === 'warn') return 'bg-destructive/15 text-destructive';
  if (tone === 'active') return 'bg-primary/15 text-primary';
  return 'bg-muted text-muted-foreground';
}

/** The workflow tab strip — Design / Fabricate / Simulate tabs whose content
 * renders in the workflow panel body, plus an always-available Play/Stop so
 * the simulation can be run from any tab. Status chips live in
 * `EditorStatusChips` on the document panel. */
export function EditorWorkflowStatus({
  activeWorkflow,
  onWorkflowChange,
}: EditorWorkflowStatusProps) {
  const simulating = useEditorStore((s) => s.simulating);
  const setSimulating = useEditorStore((s) => s.setSimulating);
  return (
    <div className="pointer-events-auto flex items-center gap-1 p-1">
      {WORKFLOWS.map(({ id, icon: Icon, label, title }) => {
        const active = activeWorkflow === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            title={title}
            onClick={() => onWorkflowChange(id)}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <Icon size={13} />
            <span>{label}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setSimulating(!simulating)}
        aria-pressed={simulating}
        aria-label={simulating ? 'Stop simulation' : 'Play simulation'}
        title={simulating ? 'Stop simulation (Ctrl+Space)' : 'Play simulation (Ctrl+Space)'}
        className={`ml-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium ${
          simulating
            ? 'bg-primary text-primary-foreground'
            : 'bg-accent text-accent-foreground hover:bg-accent/80'
        }`}
      >
        {simulating ? <Square size={13} /> : <Play size={13} />}
      </button>
    </div>
  );
}

/** Compact amber call-to-action shown in the workflow panel's Design tab while
 * pipe volumes overlap (the red shells): one click joins every crossing with a
 * rigid on-body union (heat-wrapped + screwed — the fabricated anchor tee).
 * Self-subscribes to the document (the shell keeps its narrow subscriptions)
 * and renders nothing when there is no overlap. */
export function OverlapSolveRow() {
  const design = useAppStore((s) => s.current);
  // the solver fixes BOTH capsule overlaps (pass 1) and record-less junction
  // conflicts — nonstandard corners/unions (pass 2) — so the row must show for
  // either (a doc can have conflicts with zero overlaps)
  const unresolved = useMemo(() => {
    if (!design) return { overlaps: 0, conflicts: 0 };
    return {
      overlaps: intersectingMembers(design).size,
      conflicts: resolveFittings(design).conflicts.length,
    };
  }, [design]);
  const total = unresolved.overlaps + unresolved.conflicts;
  if (!total) return null;
  const label = [
    unresolved.overlaps ? `${unresolved.overlaps} overlapping` : '',
    unresolved.conflicts
      ? `${unresolved.conflicts} unresolved junction${unresolved.conflicts === 1 ? '' : 's'}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="mx-1 mt-1 flex items-center gap-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300">
      <AlertTriangle size={13} className="shrink-0" />
      <span className="flex-1 tabular-nums">{label}</span>
      <button
        type="button"
        onClick={() => solveIntersections()}
        title="Join each crossing with a rigid heat-wrapped union"
        className="flex shrink-0 items-center gap-1 rounded-md bg-amber-500/15 px-2 py-1 font-medium hover:bg-amber-500/25"
      >
        <Combine size={13} />
        Solve intersections
      </button>
    </div>
  );
}

/** Autosave + warnings chips (compact, for the document panel). Subscribes to
 * the document itself, so it re-renders on doc changes without dragging the
 * whole shell along. */
export function EditorStatusChips() {
  const design = useAppStore((s) => s.current);
  const saveState = useAppStore((s) => s.saveState);
  const warnings = useMemo(() => summarizeEditorWarnings(design), [design]);

  const saveTone = saveState === 'saved' ? 'ok' : 'neutral';
  const warningTone = warnings.total > 0 ? 'warn' : 'ok';
  const warningTitle =
    warnings.total > 0
      ? [
          warnings.fittingConflicts ? `${warnings.fittingConflicts} fitting` : '',
          warnings.overlaps ? `${warnings.overlaps} overlap` : '',
          warnings.tightBends ? `${warnings.tightBends} tight bend` : '',
        ]
          .filter(Boolean)
          .join(', ')
      : 'No warnings';
  return (
    <div className="flex items-center gap-1">
      <span
        title={saveState === 'saved' ? 'Autosave complete' : 'Autosave pending'}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${statusChipClass(
          saveTone,
        )}`}
      >
        {saveState === 'saved' ? <CheckCircle2 size={12} /> : <Save size={12} />}
        {/* icon-only below lg so the pinned document row stays a single line */}
        <span className="hidden lg:inline">{saveState === 'saved' ? 'Saved' : 'Saving'}</span>
      </span>
      <span
        title={warningTitle}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium tabular-nums ${statusChipClass(
          warningTone,
        )}`}
      >
        <AlertTriangle size={12} />
        {warnings.total}
      </span>
    </div>
  );
}
