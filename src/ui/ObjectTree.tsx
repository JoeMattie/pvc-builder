import {
  ChevronDown,
  ChevronRight,
  Group as GroupIcon,
  ListTree,
  LogIn,
  LogOut,
  Minus,
  Spline,
  Ungroup,
} from 'lucide-react';
import { useState } from 'react';
import { groupColorOf, groupOfMember } from '../design/docOps';
import { useAppStore } from '../state/appStore';
import {
  enterGroup,
  exitGroup,
  groupSelection,
  selectTreeGroup,
  selectTreeMember,
  setGroupColor,
  ungroupSelection,
} from '../state/editorActions';
import { useEditorStore } from '../state/editorStore';

/** Max ungrouped rows rendered before collapsing the tail (huge models). */
const MAX_ROWS = 300;

/** A left-side tree of every object (pipe) and group. Clicking selects; a
 * grouped object auto-enters its group (siblings grey out); each group carries a
 * subtle colour cast set from an inline colour picker. Ctrl/⌘-click multi-selects.
 *
 * Subscribes only to a STRUCTURAL signature of the doc (ids + sizes + group
 * membership + colour), not positions — so a per-frame drag doesn't re-render
 * the whole list. */
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
    return out;
  });
  const selectedIds = useEditorStore((s) => s.selectedIds);
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

  return (
    <div className="pointer-events-auto w-56 rounded-xl border border-border bg-card shadow-md">
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
        <div className="max-h-[52vh] overflow-y-auto p-1">
          {design.members.length === 0 && (
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
        </div>
      )}
    </div>
  );
}
