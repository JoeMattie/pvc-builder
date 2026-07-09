import {
  Activity,
  ChevronDown,
  ChevronRight,
  Circle,
  Group as GroupIcon,
  ListTree,
  Lock,
  LogIn,
  LogOut,
  Minus,
  Rotate3d,
  Ruler,
  Spline,
  Ungroup,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { groupColorOf, groupOfMember } from '../design/docOps';
import { useAppStore } from '../state/appStore';
import {
  enterGroup,
  exitGroup,
  groupSelection,
  selectTreeElastic,
  selectTreeGroup,
  selectTreeJoint,
  selectTreeMeasurement,
  selectTreeMember,
  setGroupColor,
  ungroupSelection,
} from '../state/editorActions';
import { useEditorStore } from '../state/editorStore';

/** Max ungrouped rows rendered before collapsing the tail (huge models). */
const MAX_ROWS = 300;

/** A left-side tree of every object: pipes/groups plus inspectable joints,
 * measurements, and elastics. Clicking selects; a grouped object auto-enters its
 * group (siblings grey out); each group carries a subtle colour cast set from an
 * inline colour picker. Ctrl/⌘-click multi-selects member rows.
 *
 * Subscribes only to a STRUCTURAL signature of the doc (ids + sizes + group
 * membership + colour + non-pipe object ids), not positions — so a per-frame
 * drag doesn't re-render the whole list. */
export function ObjectTree() {
  // structural signature: unchanged string ⇒ zustand skips the re-render, so a
  // drag (which rewrites positions every frame) never churns the tree
  const sig = useAppStore((s) => {
    const d = s.current;
    if (!d) return '';
    let out = '';
    for (const m of d.members) out += `${m.id}${m.kind[0]}${m.size};`;
    out += '|';
    for (const g of d.groups) out += `${g.id}:${g.color ?? ''}:${g.memberIds.join('.')};`;
    out += '|';
    for (const j of d.joints) {
      out += `${j.id}:${j.nodeId}:${j.receiver}:${j.mover}:${j.mode}:${j.onBody ? 1 : 0}:${
        j.manufactured ? 1 : 0
      };`;
    }
    out += '|';
    for (const m of d.measurements) out += `${m.id};`;
    out += '|';
    for (const e of d.elastics) out += `${e.id};`;
    return out;
  });
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selectedJointId = useEditorStore((s) => s.selectedJointId);
  const selectedMeasurementId = useEditorStore((s) => s.selectedMeasurementId);
  const selectedElasticId = useEditorStore((s) => s.selectedElasticId);
  const enteredGroupId = useEditorStore((s) => s.enteredGroupId);
  const [open, setOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const design = useAppStore.getState().current;
  if (!design) return null;
  void sig; // referenced to keep the subscription; data read fresh from getState

  const selected = new Set(selectedIds);
  const memberIndex = new Map(design.members.map((m, i) => [m.id, i]));
  const label = (id: string): string => {
    const m = design.members.find((x) => x.id === id);
    const n = (memberIndex.get(id) ?? 0) + 1;
    return m?.kind === 'formed' ? `Curve ${n}` : `Pipe ${n}`;
  };
  const grouped = new Set(design.groups.flatMap((g) => g.memberIds));
  const ungrouped = design.members.filter((m) => !grouped.has(m.id));
  const hasObjects =
    design.members.length > 0 ||
    design.joints.length > 0 ||
    design.measurements.length > 0 ||
    design.elastics.length > 0;

  // a grouped member is bright only INSIDE its own group; an ungrouped member is
  // dimmed while you're focused inside some group (planfile: grey out the rest)
  const memberDim = (groupId: string | null): boolean =>
    groupId ? groupId !== enteredGroupId : enteredGroupId != null;

  const toggleCollapse = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const canGroup = selectedIds.length >= 1;
  const canUngroup =
    !!enteredGroupId || selectedIds.some((id) => groupOfMember(design, id) !== undefined);

  const rowBtn = (active: boolean, dim: boolean): string =>
    `flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs ${
      active
        ? 'bg-primary/15 text-foreground'
        : dim
          ? 'text-muted-foreground/50 hover:bg-accent/60'
          : 'text-foreground hover:bg-accent'
    }`;

  const section = (id: string, title: string, count: number, icon: ReactNode) => {
    const isCollapsed = collapsed.has(id);
    return (
      <button
        type="button"
        onClick={() => toggleCollapse(id)}
        aria-label={isCollapsed ? `Expand ${title}` : `Collapse ${title}`}
        className="mt-1 flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground hover:bg-accent"
      >
        {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        {icon}
        <span>{title}</span>
        <span className="ml-auto text-[10px] tabular-nums">{count}</span>
      </button>
    );
  };

  const jointIcon = (mode: string) => {
    if (mode === 'wrapped')
      return <Rotate3d size={12} className="shrink-0 text-muted-foreground" />;
    if (mode === 'free') return <Circle size={12} className="shrink-0 text-muted-foreground" />;
    return <Lock size={12} className="shrink-0 text-muted-foreground" />;
  };

  const jointModeLabel = (mode: string) => {
    if (mode === 'wrapped') return 'Wrapped';
    if (mode === 'free') return 'Free';
    return 'Anchor';
  };

  return (
    <div className="pointer-events-auto w-full rounded-xl border border-border bg-card shadow-md">
      {/* header */}
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          <ListTree size={13} />
          Objects
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            disabled={!canGroup}
            onClick={() => groupSelection()}
            title="Group selection (G)"
            aria-label="Group selection"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-30"
          >
            <GroupIcon size={14} />
          </button>
          <button
            type="button"
            disabled={!canUngroup}
            onClick={() => ungroupSelection()}
            title="Ungroup / explode (Shift+G)"
            aria-label="Ungroup selection"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-30"
          >
            <Ungroup size={14} />
          </button>
        </div>
      </div>

      {open && (
        <div className="scrollbar-minimal max-h-[52vh] overflow-y-auto p-1">
          {!hasObjects && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">No objects yet.</p>
          )}

          {/* groups */}
          {design.groups.map((g, gi) => {
            const color = groupColorOf(design, g.id);
            const isEntered = enteredGroupId === g.id;
            const wholeSelected =
              g.memberIds.length > 0 && g.memberIds.every((id) => selected.has(id));
            const isCollapsed = collapsed.has(g.id);
            const headerDim = enteredGroupId != null && !isEntered;
            return (
              <div key={g.id}>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(g.id)}
                    aria-label={isCollapsed ? 'Expand group' : 'Collapse group'}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                  >
                    {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  </button>
                  {/* colour swatch = inline colour picker */}
                  <label
                    className="relative flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-black/10"
                    style={{ background: color }}
                    title="Group colour"
                  >
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setGroupColor(g.id, e.target.value)}
                      className="absolute inset-0 cursor-pointer opacity-0"
                      aria-label={`Group ${gi + 1} colour`}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => selectTreeGroup(g.id)}
                    onDoubleClick={() => enterGroup(g.id)}
                    className={rowBtn(wholeSelected, headerDim)}
                  >
                    <span className="truncate font-medium">Group {gi + 1}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {g.memberIds.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => (isEntered ? exitGroup() : enterGroup(g.id))}
                    title={isEntered ? 'Exit group (Esc)' : 'Enter group'}
                    aria-label={isEntered ? 'Exit group' : 'Enter group'}
                    className={`rounded p-1 hover:bg-accent ${isEntered ? 'text-primary' : 'text-muted-foreground'}`}
                  >
                    {isEntered ? <LogOut size={12} /> : <LogIn size={12} />}
                  </button>
                </div>
                {!isCollapsed &&
                  g.memberIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={(e) => selectTreeMember(id, e.ctrlKey || e.metaKey)}
                      className={`${rowBtn(selected.has(id), memberDim(g.id))} pl-7`}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: color }}
                      />
                      <span className="truncate">{label(id)}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                        {design.members.find((m) => m.id === id)?.size}
                      </span>
                    </button>
                  ))}
              </div>
            );
          })}

          {/* ungrouped members */}
          {ungrouped.slice(0, MAX_ROWS).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={(e) => selectTreeMember(m.id, e.ctrlKey || e.metaKey)}
              className={rowBtn(selected.has(m.id), memberDim(null))}
            >
              {m.kind === 'formed' ? (
                <Spline size={12} className="shrink-0 text-muted-foreground" />
              ) : (
                <Minus size={12} className="shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{label(m.id)}</span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{m.size}</span>
            </button>
          ))}
          {ungrouped.length > MAX_ROWS && (
            <p className="px-2 py-1 text-[10px] text-muted-foreground">
              +{ungrouped.length - MAX_ROWS} more…
            </p>
          )}

          {design.joints.length > 0 && (
            <>
              {section(
                'section:joints',
                'Joints',
                design.joints.length,
                <Rotate3d size={12} className="shrink-0" />,
              )}
              {!collapsed.has('section:joints') &&
                design.joints.map((j, i) => (
                  <button
                    key={j.id}
                    type="button"
                    onClick={() => selectTreeJoint(j.id)}
                    className={rowBtn(selectedJointId === j.id, false)}
                  >
                    {jointIcon(j.mode)}
                    <span className="truncate">
                      {jointModeLabel(j.mode)} {i + 1}
                    </span>
                    <span className="ml-auto max-w-24 shrink-0 truncate text-[10px] text-muted-foreground">
                      {j.onBody ? 'on-body' : 'end'} {j.manufactured ? 'mfg' : ''}
                    </span>
                  </button>
                ))}
            </>
          )}

          {design.measurements.length > 0 && (
            <>
              {section(
                'section:measurements',
                'Measurements',
                design.measurements.length,
                <Ruler size={12} className="shrink-0" />,
              )}
              {!collapsed.has('section:measurements') &&
                design.measurements.map((m, i) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => selectTreeMeasurement(m.id)}
                    className={rowBtn(selectedMeasurementId === m.id, false)}
                  >
                    <Ruler size={12} className="shrink-0 text-muted-foreground" />
                    <span className="truncate">Measure {i + 1}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">tape</span>
                  </button>
                ))}
            </>
          )}

          {design.elastics.length > 0 && (
            <>
              {section(
                'section:elastics',
                'Elastics',
                design.elastics.length,
                <Activity size={12} className="shrink-0" />,
              )}
              {!collapsed.has('section:elastics') &&
                design.elastics.map((e, i) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => selectTreeElastic(e.id)}
                    className={rowBtn(selectedElasticId === e.id, false)}
                  >
                    <Activity size={12} className="shrink-0 text-muted-foreground" />
                    <span className="truncate">Elastic {i + 1}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">band</span>
                  </button>
                ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
