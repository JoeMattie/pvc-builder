import { Keyboard, X } from 'lucide-react';

// A self-contained help / keyboard-shortcut reference. NO network required — the
// content stands alone (the GitHub link is an optional convenience anchor). Used
// in two places: a `?` button in the editor toolbar (EditorShell) and a "Guide"
// button on the project-list page (ProjectList). Both render <HelpPanel open …/>
// as a modal overlay. Keep the shortcut list in sync with EditorShell's keydown
// handler and the Pillbox tool list.

/** One keyboard-shortcut row: the keys (rendered as <kbd>) and what they do. */
interface Shortcut {
  keys: string[];
  label: string;
}

const SHORTCUT_GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Tools',
    items: [
      { keys: ['V'], label: 'Select tool' },
      { keys: ['D'], label: 'Draw straight pipe' },
      { keys: ['P'], label: 'Extend / push a pipe out of an end' },
      { keys: ['C'], label: 'Curve (heat-formed spline)' },
      { keys: ['M'], label: 'Move tool (3-axis gizmo)' },
      { keys: ['R'], label: 'Rotate tool (ring gizmo)' },
      { keys: ['B'], label: 'Bend an existing pipe' },
      { keys: ['T'], label: 'Measure / tape' },
      { keys: ['Q'], label: 'Guide line' },
      { keys: ['E'], label: 'Elastic band' },
      { keys: ['Space'], label: 'Back to the Select tool' },
    ],
  },
  {
    title: 'Editing',
    items: [
      { keys: ['G'], label: 'Group the selection' },
      { keys: ['Shift', 'G'], label: 'Ungroup' },
      { keys: ['Delete'], label: 'Delete pipe / band / measurement' },
      { keys: ['Ctrl', 'C'], label: 'Copy the selection' },
      { keys: ['Ctrl', 'X'], label: 'Cut the selection' },
      { keys: ['Ctrl', 'V'], label: 'Paste (offset + selected)' },
      { keys: ['Ctrl', 'Z'], label: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], label: 'Redo (or Ctrl+Y)' },
    ],
  },
  {
    title: 'Nudge the selection',
    items: [
      { keys: ['←', '→', '↑', '↓'], label: 'Move one grid step in the X / Z plane' },
      { keys: ['Ctrl', '↑', '↓'], label: 'Move up / down in Y' },
      { keys: ['Home', 'End'], label: 'Move up / down in Y' },
    ],
  },
  {
    title: 'Drawing',
    items: [
      { keys: ['0–9', 'Enter'], label: 'Type an exact length, then commit the segment' },
      { keys: ['Shift'], label: 'Lock to an axis (X / Y / Z) while drawing or dragging' },
      { keys: ['Ctrl'], label: 'Detach / re-weld while dragging an endpoint' },
      { keys: ['Esc', 'Enter'], label: 'Finish the current path / cancel / clear selection' },
    ],
  },
  {
    title: 'Guides',
    items: [
      { keys: ['Q'], label: 'Guide tool — click a pipe, then place a parallel line' },
      { keys: ['Shift', 'Q'], label: 'Clear all guide lines' },
    ],
  },
  {
    title: 'Simulate & view',
    items: [
      { keys: ['Ctrl', 'Space'], label: 'Play / stop the physics simulation' },
      { keys: ['W'], label: 'Wireframe view (lines + junction dots)' },
      { keys: ['Right-click'], label: 'Open the join / size menu at a junction or pipe' },
    ],
  },
];

/** A short "how it works" explainer for each major concept. */
const CONCEPTS: { title: string; body: string }[] = [
  {
    title: 'Tools',
    body: 'Draw (D) lays straight SCH 40 pipe; click to place points, or click-drag for one segment. Extend (P) shows push-cylinders on a pipe end — click one to draw a new pipe locked to that direction. Curve (C) draws heat-formed splines. Move (M) and Rotate (R) translate/spin the selection with a gizmo. Bend (B) drags a bend into an existing pipe. Measure (T) drops a tape dimension. Band (E) adds an elastic. Toggle Wireframe (W) for a lines-and-dots skeleton.',
  },
  {
    title: 'Object tree',
    body: 'The panel on the left lists every pipe and group. Click to select (Ctrl-click to multi-select); clicking a grouped object enters its group and greys out the rest. Each group carries a subtle colour cast set from its swatch; grouping controls live in the main tool toolbar.',
  },
  {
    title: 'Guide lines',
    body: 'With the Guide tool (Q), click a pipe then move the mouse to drop an infinite construction line parallel to it (snapped to the nearest axis); type a distance for an exact offset, click or Enter to place, Shift+Q to clear all. While guides exist, drawing tools snap to where a guide crosses a pipe (shown as "Guide intersection").',
  },
  {
    title: 'Joints',
    body: 'Right-click where pipes meet to choose how they connect: Anchor (rigid coupling or a flattened/screwed tee), Wrapped pivot (swivels about the receiving pipe, 1-DOF), Free hub (an eye-bolt + cord ball joint, 3-DOF — many pipes can share one hub), or a Manufactured joint (snap to a standard elbow/coupling).',
  },
  {
    title: 'Groups',
    body: 'Press G to group the selection and Shift+G to ungroup. Clicking any grouped pipe selects the whole group; double-click to enter a group (the rest fade + go inert) and Esc to exit. Snapping to a grouped object from outside works but defers its union until the group is dissolved.',
  },
  {
    title: 'Elastic bands',
    body: 'With the Band tool (E), click two attachment points — a pipe end or a point along a pipe — to add a pre-tensioned spring. Select a band for its tension slider. In Play, bands pull their ends together and tint hotter the more they stretch.',
  },
  {
    title: 'Simulate (Play)',
    body: 'Toggle the Drag lock in the tool bar to hold every member length, then pose wrapped pivots with the sliders or drag free hubs directly. Press Play (Ctrl+Space) to run rigid-body physics; the bug icon overlays the live bodies + constraints. The BOM / cut list gives take-offs, allowances, and a CSV export.',
  },
];

function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {keys.map((k, i) => (
        <span key={k} className="flex items-center gap-1">
          {i > 0 && <span className="text-muted-foreground text-[10px]">+</span>}
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none text-foreground">
            {k}
          </kbd>
        </span>
      ))}
    </span>
  );
}

/** Modal help / shortcut reference. Self-contained (no network). Rendered by the
 * editor `?` button and the project-list Guide button. */
export function HelpPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* click-away backdrop */}
      <button
        type="button"
        aria-label="Close help"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-border border-b px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Keyboard size={16} /> PVC Builder — help &amp; shortcuts
          </span>
          <button
            type="button"
            aria-label="Close help"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-6 overflow-y-auto px-4 py-4 md:grid-cols-2">
          {/* left: shortcut tables */}
          <div className="flex flex-col gap-4">
            {SHORTCUT_GROUPS.map((g) => (
              <section key={g.title} className="flex flex-col gap-1.5">
                <h3 className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                  {g.title}
                </h3>
                <div className="flex flex-col gap-1">
                  {g.items.map((s) => (
                    <div key={s.label} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-foreground">{s.label}</span>
                      <KeyCombo keys={s.keys} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* right: how-it-works */}
          <div className="flex flex-col gap-4">
            {CONCEPTS.map((c) => (
              <section key={c.title} className="flex flex-col gap-1">
                <h3 className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                  {c.title}
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">{c.body}</p>
              </section>
            ))}
            <p className="text-[11px] text-muted-foreground">
              The full walkthrough — with screenshots — lives in{' '}
              <span className="font-mono text-foreground">docs/USER-GUIDE.md</span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
