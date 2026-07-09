import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  DraftingCompass,
  Hammer,
  PlayCircle,
  Save,
} from 'lucide-react';
import { useMemo } from 'react';
import { useAppStore } from '../../state/appStore';
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
  onOpenBom(): void;
}

function statusChipClass(tone: 'ok' | 'warn' | 'neutral' | 'active'): string {
  if (tone === 'ok') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (tone === 'warn') return 'bg-destructive/15 text-destructive';
  if (tone === 'active') return 'bg-primary/15 text-primary';
  return 'bg-muted text-muted-foreground';
}

export function EditorWorkflowStatus({
  activeWorkflow,
  onWorkflowChange,
  onOpenBom,
}: EditorWorkflowStatusProps) {
  const design = useAppStore((s) => s.current);
  const saveState = useAppStore((s) => s.saveState);
  const lengthsLocked = useAppStore((s) => s.current?.lengthsLocked ?? false);
  const simulating = useEditorStore((s) => s.simulating);
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
  const geometry = simulating
    ? { label: 'Physics live', tone: 'active' as const }
    : lengthsLocked
      ? { label: 'Locked pose', tone: 'neutral' as const }
      : { label: 'Document geometry', tone: 'ok' as const };

  return (
    <div className="pointer-events-auto flex w-full flex-col gap-1.5 rounded-xl border border-border bg-card p-2 shadow-md">
      <div className="grid grid-cols-3 gap-1">
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
              className={`flex min-w-0 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <Icon size={13} />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-1.5">
        <span
          title={saveState === 'saved' ? 'Autosave complete' : 'Autosave pending'}
          className={`flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${statusChipClass(
            saveTone,
          )}`}
        >
          {saveState === 'saved' ? <CheckCircle2 size={12} /> : <Save size={12} />}
          {saveState === 'saved' ? 'Saved' : 'Saving'}
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

      <div className="flex items-center justify-between gap-2">
        <span
          title={simulating ? 'Viewport is using live physics positions' : geometry.label}
          className={`flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${statusChipClass(
            geometry.tone,
          )}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          <span className="truncate">{geometry.label}</span>
        </span>
        <button
          type="button"
          onClick={onOpenBom}
          title="Open cut list / BOM"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <ClipboardList size={12} />
          BOM
        </button>
      </div>
    </div>
  );
}
