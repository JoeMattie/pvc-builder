import {
  AlertTriangle,
  ArrowLeftRight,
  Circle,
  Factory,
  Info,
  Lock,
  Rotate3d,
  RotateCcw,
  Trash2,
  Wrench,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import {
  EYE_BOLT_TAKEOFF_M,
  endCapAllowanceM,
  fittingTakeoffM,
  JOINT_HARDWARE,
  wrapAllowanceM,
} from '../design/bom';
import { incidentMembers, memberById, memberLengthM } from '../design/docOps';
import { analyzeFormed } from '../design/formed';
import type { Design, Joint, JointMode, LengthDisplay, Member } from '../schema';
import { useAppStore } from '../state/appStore';
import {
  clearSelection,
  deleteMembers,
  resetPivots,
  setJoinMode,
  setMemberLength,
  setMembersSize,
  setPivotAngle,
  swapJointReceiver,
} from '../state/editorActions';
import { useEditorStore } from '../state/editorStore';
import { formatLengthDisplay, lengthDisplayUnit, parseLength } from './units';

/** Length value (no unit suffix) for the editable field, in the current display
 * format — so the input round-trips through `parseLength`. */
function lengthDraft(m: number, display: LengthDisplay | undefined): string {
  return formatLengthDisplay(m, display)
    .replace(/"$/, '')
    .replace(/\s*(mm|cm)$/, '')
    .trim();
}

function modeLabel(mode: JointMode): string {
  if (mode === 'wrapped') return 'Wrapped pivot';
  if (mode === 'free') return 'Free pivot';
  return 'Anchor';
}

function memberLabel(design: Design, id: string): string {
  const index = design.members.findIndex((m) => m.id === id);
  const member = index >= 0 ? design.members[index] : undefined;
  if (!member) return id;
  return `${member.kind === 'formed' ? 'Curve' : 'Pipe'} ${index + 1}`;
}

function memberDetail(member: Member | undefined): string {
  if (!member) return 'Missing member';
  return `${member.size} ${member.kind}`;
}

function deg(rad: number): number {
  return Math.round((rad * 180) / Math.PI);
}

function jointBomEffect(design: Design, joint: Joint): { title: string; detail: string } {
  const receiver = memberById(design, joint.receiver);
  const units = design.lengthDisplay;

  if (joint.manufactured) {
    const takeoff = receiver ? fittingTakeoffM('tee', receiver.size) : 0;
    return {
      title: joint.onBody ? 'Manufactured socket tee' : 'Manufactured fitting',
      detail: joint.onBody
        ? `Receiver run is cut at the branch; tee take-off is ${formatLengthDisplay(
            takeoff,
            units,
          )} per adjacent socket.`
        : 'Fitting is inferred as standard socket hardware and uses fitting take-offs.',
    };
  }

  if (joint.mode === 'wrapped') {
    const wrap = receiver ? wrapAllowanceM(receiver.size) : 0;
    const cap =
      receiver && (receiver.nodeA === joint.nodeId || receiver.nodeB === joint.nodeId)
        ? endCapAllowanceM(receiver.size)
        : 0;
    return {
      title: 'Fabricated wrapped pivot',
      detail: `Mover cut adds ${formatLengthDisplay(wrap, units)} wrap allowance${
        cap > 0 ? `; receiver end cap adds ${formatLengthDisplay(cap, units)}` : ''
      }.`,
    };
  }

  if (joint.mode === 'free') {
    return {
      title: 'Ball-joint hardware',
      detail: `Pipe ends at this hub lose ${formatLengthDisplay(
        EYE_BOLT_TAKEOFF_M,
        units,
      )} eye-bolt take-off; hardware counts once per free node.`,
    };
  }

  return {
    title: joint.onBody ? 'Fabricated screwed tee' : 'Rigid socket connection',
    detail: joint.onBody
      ? 'Receiver run stays intact; BOM counts screwed-tee hardware with no socket tee cut.'
      : 'End-to-end anchor is the default rigid connection; socket fitting is inferred when no joint record is stored.',
  };
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function JointInspector({ design, joint }: { design: Design; joint: Joint }) {
  const receiver = memberById(design, joint.receiver);
  const mover = memberById(design, joint.mover);
  const bomEffect = jointBomEffect(design, joint);
  const limits =
    joint.mode === 'wrapped' && joint.limits
      ? `${deg(joint.limits.minRad)}° to ${deg(joint.limits.maxRad)}°`
      : joint.mode === 'wrapped'
        ? 'No stored travel limits'
        : 'Not applicable';
  const angle =
    joint.mode === 'wrapped'
      ? `${deg(joint.angleRad ?? 0)}°`
      : joint.mode === 'free'
        ? '3 DOF'
        : '0°';

  return (
    // stacked to fit the workflow panel's ~22rem body (this used to be a wide
    // top-center bar)
    <div className="w-full rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
            {joint.mode === 'wrapped' ? (
              <Rotate3d size={16} />
            ) : joint.mode === 'free' ? (
              <Circle size={16} />
            ) : (
              <Lock size={16} />
            )}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{modeLabel(joint.mode)}</div>
            <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5">
                {joint.onBody ? 'on-body branch' : 'end-to-end'}
              </span>
              <span className="rounded bg-muted px-1.5 py-0.5">
                {joint.manufactured ? 'manufactured' : 'fabricated'}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Receiver
            </div>
            <div className="truncate font-medium text-foreground">
              {memberLabel(design, joint.receiver)}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {memberDetail(receiver)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Mover</div>
            <div className="truncate font-medium text-foreground">
              {memberLabel(design, joint.mover)}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">{memberDetail(mover)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Angle</div>
            <div className="tabular-nums text-foreground">{angle}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Limits</div>
            <div className="truncate text-foreground">{limits}</div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 text-xs">
          <div className="flex items-start gap-1.5 text-muted-foreground">
            <Info size={13} className="mt-0.5 shrink-0" />
            <span>
              <span className="font-medium text-foreground">{bomEffect.title}</span>:{' '}
              {bomEffect.detail}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Wrench size={13} />
            <span className="truncate">{JOINT_HARDWARE[joint.mode]}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
            <ModeButton
              active={joint.mode === 'anchor'}
              icon={<Lock size={12} />}
              label="Anchor"
              onClick={() => setJoinMode(joint.nodeId, joint.mover, 'anchor')}
            />
            <ModeButton
              active={joint.mode === 'wrapped'}
              icon={<Rotate3d size={12} />}
              label="Wrapped"
              onClick={() => setJoinMode(joint.nodeId, joint.mover, 'wrapped')}
            />
            <ModeButton
              active={joint.mode === 'free'}
              icon={<Circle size={12} />}
              label="Free"
              onClick={() => setJoinMode(joint.nodeId, joint.mover, 'free')}
            />
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
          {joint.mode === 'wrapped' && (
            <button
              type="button"
              title="Reset this pivot angle"
              aria-label="Reset this pivot angle"
              onClick={() => setPivotAngle(joint.id, 0)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <RotateCcw size={13} />
            </button>
          )}
          {joint.mode === 'free' && (
            <button
              type="button"
              title="Reset all free and wrapped pivots"
              aria-label="Reset all pivots"
              onClick={() => resetPivots()}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <RotateCcw size={13} />
            </button>
          )}
          {joint.manufactured && (
            <span className="rounded bg-accent px-1.5 py-1 text-[10px] font-medium text-accent-foreground">
              <Factory size={11} className="mr-1 inline" />
              socket
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Multi-selection: a summary + breakdown by size/kind with total length —
 * per-object rows would just repeat the scene labels. */
function MultiSelectionSummary({ design, ids }: { design: Design; ids: string[] }) {
  const display = design.lengthDisplay;
  const members = ids.map((id) => memberById(design, id)).filter((m): m is Member => !!m);
  const groups = new Map<string, { count: number; totalM: number }>();
  let totalM = 0;
  for (const m of members) {
    const len = memberLengthM(design, m);
    totalM += len;
    const key = `${m.size} ${m.kind === 'formed' ? 'Curve' : 'Pipe'}`;
    const g = groups.get(key) ?? { count: 0, totalM: 0 };
    g.count += 1;
    g.totalM += len;
    groups.set(key, g);
  }
  return (
    <div className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-medium text-sm">{members.length} objects selected</span>
        <button
          type="button"
          aria-label="Delete selected objects"
          title="Delete selected objects"
          onClick={() => {
            deleteMembers(ids);
            clearSelection();
          }}
          className="rounded-md p-1.5 text-muted-foreground hover:text-destructive"
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {[...groups.entries()].map(([label, g]) => (
          <div key={label} className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {g.count}× {label}
            </span>
            <span className="tabular-nums">{formatLengthDisplay(g.totalM, display)}</span>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between border-border/70 border-t pt-1 font-medium">
          <span>Total length</span>
          <span className="tabular-nums">{formatLengthDisplay(totalM, display)}</span>
        </div>
      </div>
    </div>
  );
}

/** Inspector for the current selection: selected joints get connection/BOM
 * details; selected members get size, length or bend details, and delete. */
export function SelectionPanel() {
  const design = useAppStore((s) => s.current);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selectedJointId = useEditorStore((s) => s.selectedJointId);
  const member = design && selectedIds[0] ? memberById(design, selectedIds[0]) : undefined;

  const display = design?.lengthDisplay;
  const straight = member?.kind === 'straight';
  const lengthM = design && straight ? memberLengthM(design, member) : 0;
  const [draft, setDraft] = useState('');

  // reflect the live length into the input whenever the selection or geometry
  // changes (e.g. after a drag), except while the field is being edited
  const drafted = lengthDraft(lengthM, display);
  useEffect(() => {
    setDraft(drafted);
  }, [drafted]);

  if (!design) return null;
  const selectedJoint = selectedJointId
    ? design.joints.find((joint) => joint.id === selectedJointId)
    : undefined;
  if (selectedJoint) return <JointInspector design={design} joint={selectedJoint} />;
  if (selectedIds.length > 1) return <MultiSelectionSummary design={design} ids={selectedIds} />;
  if (!member) return null;

  const commit = (e: FormEvent) => {
    e.preventDefault();
    const m = parseLength(draft, display);
    if (m !== null && m > 0) setMemberLength(member.id, m);
  };

  const formed = member.kind === 'formed' ? analyzeFormed(design, member) : null;
  // the joint this pipe is the MOVER of, if any (its mode — anchor / wrapped /
  // free — plus swap-receiver are configured here)
  const joint = design.joints.find((j) => j.mover === member.id);
  const canFree = !!joint; // free applies end-to-end and on-body (saddle eye bolt)
  const endpointConnections = [member.nodeA, member.nodeB].filter(
    (nodeId) => incidentMembers(design, nodeId).length > 1,
  );

  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
      <span className="text-xs font-medium text-foreground tabular-nums">
        {member.size} {member.kind === 'formed' ? 'Curve' : 'Pipe'}
      </span>
      <fieldset className="flex items-center gap-1" aria-label="Selected pipe size">
        {(['1/2"', '3/4"'] as const).map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={member.size === size}
            onClick={() => setMembersSize(selectedIds.length ? selectedIds : [member.id], size)}
            className={`min-h-10 rounded-md px-2 text-xs font-semibold tabular-nums ${
              member.size === size
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-muted-foreground hover:bg-accent'
            }`}
          >
            {size}
          </button>
        ))}
      </fieldset>
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
            <span className="text-muted-foreground text-xs">{lengthDisplayUnit(display)}</span>
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
              {formatLengthDisplay(formed?.developedLengthM ?? 0, display)}
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

      {endpointConnections.map((nodeId) => {
        const end = nodeId === member.nodeA ? 'A' : 'B';
        const endpointJoint = design.joints.find(
          (candidate) => candidate.nodeId === nodeId && candidate.mover === member.id,
        );
        return (
          <button
            key={nodeId}
            type="button"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              useEditorStore.getState().openJoinMenu({
                nodeId,
                moverId: member.id,
                x: rect.left,
                y: rect.bottom + 6,
              });
            }}
            className="flex min-h-10 items-center gap-2 rounded-md border border-border px-2 text-left text-xs hover:bg-accent"
          >
            <span className="font-semibold">End {end}</span>
            <span className="text-muted-foreground">
              {endpointJoint ? modeLabel(endpointJoint.mode) : 'Manufactured / anchor'}
            </span>
          </button>
        );
      })}

      <button
        type="button"
        aria-label="Delete pipe"
        onClick={() => {
          deleteMembers(selectedIds.length ? selectedIds : [member.id]);
          clearSelection();
        }}
        className="text-muted-foreground hover:text-destructive rounded-md p-1.5"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}
