import { AlertTriangle, ArrowLeftRight, Circle, Lock, Rotate3d, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { deleteMember, memberById, memberLengthM } from '../design/docOps';
import { analyzeFormed } from '../design/formed';
import { useAppStore } from '../state/appStore';
import {
  clearSelection,
  setJoinMode,
  setMemberLength,
  swapJointReceiver,
} from '../state/editorActions';
import { useEditorStore } from '../state/editorStore';
import { formatLength, lengthFromDisplay, lengthToDisplay, lengthUnit } from './units';

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
  // the joint this pipe is the MOVER of, if any (its mode — anchor / wrapped /
  // free — plus swap-receiver are configured here)
  const joint = design.joints.find((j) => j.mover === member.id);
  const canFree = !!joint; // free applies end-to-end and on-body (saddle eye bolt)

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

      {joint && (
        <>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Joint</span>
            <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
              <button
                type="button"
                aria-pressed={joint.mode === 'anchor'}
                title={joint.onBody ? 'Flattened + screwed — rigid' : 'Rigid coupling'}
                onClick={() => setJoinMode(joint.nodeId, member.id, 'anchor')}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                  joint.mode === 'anchor'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                <Lock size={12} /> Anchor
              </button>
              <button
                type="button"
                aria-pressed={joint.mode === 'wrapped'}
                title="Wrapped — swivels about the receiving pipe"
                onClick={() => setJoinMode(joint.nodeId, member.id, 'wrapped')}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                  joint.mode === 'wrapped'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                <Rotate3d size={12} /> Wrapped
              </button>
              {canFree && (
                <button
                  type="button"
                  aria-pressed={joint.mode === 'free'}
                  title="Free — eye-bolt + cord ball joint (pivots any direction)"
                  onClick={() => setJoinMode(joint.nodeId, member.id, 'free')}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                    joint.mode === 'free'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                >
                  <Circle size={12} /> Free
                </button>
              )}
            </div>
            {joint.mode === 'wrapped' && !joint.onBody && (
              <button
                type="button"
                title="Swap which pipe wraps which"
                aria-label="Swap receiver"
                onClick={() => swapJointReceiver(joint.id)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <ArrowLeftRight size={13} />
              </button>
            )}
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
