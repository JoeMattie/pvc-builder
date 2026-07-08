import { AlertTriangle, GitFork, Lock, Rotate3d, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { deleteMember, memberById, memberLengthM, nodeById } from '../design/docOps';
import { analyzeFormed } from '../design/formed';
import { dot, normalize, sub } from '../geometry/math3';
import type { Design, Wrap } from '../schema';
import { useAppStore } from '../state/appStore';
import {
  clearSelection,
  convertWrapToFitting,
  setMemberLength,
  setWrapRigid,
} from '../state/editorActions';
import { useEditorStore } from '../state/editorStore';
import { formatLength, lengthFromDisplay, lengthToDisplay, lengthUnit } from './units';

/** Whether a standard socket tee is available for a wrap — the branch must be
 * within ~7° of perpendicular to the run (else no manufactured fitting fits). */
function teeAvailable(design: Design, wrap: Wrap): boolean {
  const through = memberById(design, wrap.throughMember);
  if (through?.kind !== 'straight') return false;
  const ta = nodeById(design, through.nodeA)?.position;
  const tb = nodeById(design, through.nodeB)?.position;
  const bn = nodeById(design, wrap.branchNode)?.position;
  const branchM = design.members.find(
    (m) =>
      (m.nodeA === wrap.branchNode || m.nodeB === wrap.branchNode) && m.id !== wrap.throughMember,
  );
  const bf = branchM
    ? nodeById(design, branchM.nodeA === wrap.branchNode ? branchM.nodeB : branchM.nodeA)?.position
    : undefined;
  if (!ta || !tb || !bn || !bf) return false;
  const run = normalize(sub(tb, ta));
  const br = normalize(sub(bf, bn));
  return Math.abs(dot(run, br)) < 0.12; // |cos θ| < 0.12 ⇒ within ~7° of 90°
}

/** Inspector for the selected member: its size, an editable exact length for
 * straight pipe (planfile §1) or the developed length + bend warnings for a
 * formed pipe, and delete. */
export function SelectionPanel() {
  const design = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const member = design && selectedIds[0] ? memberById(design, selectedIds[0]) : undefined;

  const units = design?.unitsPreference ?? 'imperial';
  const straight = member?.kind === 'straight';
  const lengthM = design && straight ? memberLengthM(design, member) : 0;
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

  const formed = member.kind === 'formed' ? analyzeFormed(design, member) : null;
  // the heat-wrapped tee this branch forms onto a run, if any (its joint type is
  // configured here: screwed/rigid ⇄ natural pivot ⇄ standard socket fitting)
  const wrap = design.wraps.find(
    (w) => w.branchNode === member.nodeA || w.branchNode === member.nodeB,
  );
  // a standard socket tee is only available where the branch is ~perpendicular
  const canFit = !!wrap && teeAvailable(design, wrap);

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
      <span className="text-xs font-medium text-muted-foreground tabular-nums">{member.size}</span>
      <div className="h-5 w-px bg-border" />

      {member.kind === 'straight' ? (
        <>
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
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            drag arrows to resize · ends to move · Shift locks axis
          </span>
        </>
      ) : (
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            Developed{' '}
            <span className="text-foreground tabular-nums">
              {formatLength(formed?.developedLengthM ?? 0, units)}
            </span>
          </span>
          <span className="text-muted-foreground">
            {formed?.bends.length ?? 0} bend{(formed?.bends.length ?? 0) === 1 ? '' : 's'}
          </span>
          {formed?.hasTightBend && (
            <span className="flex items-center gap-1 text-destructive">
              <AlertTriangle size={13} /> tight bend
            </span>
          )}
        </div>
      )}

      {wrap && (
        <>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Wrap</span>
            <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
              <button
                type="button"
                aria-pressed={wrap.rigid}
                title="Flattened + screwed — rigid"
                onClick={() => setWrapRigid(wrap.id, true)}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                  wrap.rigid
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                <Lock size={12} /> Screwed
              </button>
              <button
                type="button"
                aria-pressed={!wrap.rigid}
                title="Heat-wrapped — natural pivot about the run"
                onClick={() => setWrapRigid(wrap.id, false)}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                  !wrap.rigid
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                <Rotate3d size={12} /> Pivot
              </button>
              <button
                type="button"
                disabled={!canFit}
                title={
                  canFit
                    ? 'Standard socket tee — cut the run + insert a manufactured tee'
                    : 'Standard fitting needs a ~perpendicular branch'
                }
                onClick={() => canFit && convertWrapToFitting(wrap.id)}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                  canFit
                    ? 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    : 'cursor-not-allowed text-muted-foreground/40'
                }`}
              >
                <GitFork size={12} /> Fitting
              </button>
            </div>
          </div>
        </>
      )}

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
