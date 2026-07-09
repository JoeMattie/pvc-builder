import {
  AlertTriangle,
  CheckCircle2,
  DraftingCompass,
  Hammer,
  PlayCircle,
  Save,
} from 'lucide-react';
import { useMemo } from 'react';
import { useAppStore } from '../../state/appStore';
import type { SceneStatus } from '../../state/editorStore';
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
  onOpenBom(): void;
}

function statusChipClass(tone: 'ok' | 'warn' | 'neutral' | 'active'): string {
  if (tone === 'ok') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (tone === 'warn') return 'bg-destructive/15 text-destructive';
  if (tone === 'active') return 'bg-primary/15 text-primary';
  return 'bg-muted text-muted-foreground';
}

/** The Design / Fabricate / Simulate switcher — a single inline row (the
 * workflow island keeps its title beside these). Status chips live in
 * `EditorStatusChips` on the document panel. */
export function EditorWorkflowStatus({
  activeWorkflow,
  onWorkflowChange,
  onOpenBom,
}: EditorWorkflowStatusProps) {
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
            onClick={() => {
              onWorkflowChange(id);
              if (id === 'fabricate') onOpenBom();
            }}
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
