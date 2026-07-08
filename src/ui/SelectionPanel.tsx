import { Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { deleteMember, memberById, memberLengthM } from '../design/docOps';
import { useAppStore } from '../state/appStore';
import { clearSelection, setMemberLength } from '../state/editorActions';
import { useEditorStore } from '../state/editorStore';
import { lengthFromDisplay, lengthToDisplay, lengthUnit } from './units';

/** Inspector for the selected member: its size, an editable exact length
 * (planfile §1 "freely adjustable dimensions"), and delete. */
export function SelectionPanel() {
  const design = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const member = design && selectedIds[0] ? memberById(design, selectedIds[0]) : undefined;

  const units = design?.unitsPreference ?? 'imperial';
  const lengthM = design && member ? memberLengthM(design, member) : 0;
  const [draft, setDraft] = useState('');

  // reflect the live length into the input whenever the selection or geometry
  // changes (e.g. after a drag), except while the field is being edited
  const display = lengthToDisplay(lengthM, units);
  useEffect(() => {
    setDraft(String(Number(display.toFixed(units === 'imperial' ? 3 : 4))));
  }, [display, units]);

  if (!design || !member) return null;

  const commit = (e: FormEvent) => {
    e.preventDefault();
    const v = Number(draft);
    if (Number.isFinite(v) && v > 0) setMemberLength(member.id, lengthFromDisplay(v, units));
  };

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
      <span className="text-xs font-medium text-muted-foreground tabular-nums">{member.size}</span>
      <div className="h-5 w-px bg-border" />
      <form onSubmit={commit} className="flex items-center gap-1.5">
        <label className="flex items-center gap-1.5 text-muted-foreground text-xs">
          Length
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            inputMode="decimal"
            className="border-input bg-background w-20 rounded-md border px-2 py-1 text-right text-sm tabular-nums text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </label>
        <span className="text-muted-foreground text-xs">{lengthUnit(units)}</span>
      </form>
      <div className="h-5 w-px bg-border" />
      <button
        type="button"
        aria-label="Delete pipe"
        onClick={() => {
          updateCurrent((d) => deleteMember(d, member.id));
          clearSelection();
        }}
        className="text-muted-foreground hover:text-destructive rounded-md p-1.5"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}
