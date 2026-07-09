// User-facing changelog, shown on the project-list (main) page. Newest first.
// EVERY commit-to-main-and-push bumps the version: add/extend the top entry here,
// bump package.json, and tag the commit `v<version>` (see DECISIONS.md → versioning).

export interface ChangelogEntry {
  version: string;
  /** ISO date (YYYY-MM-DD) */
  date: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.1.13',
    date: '2026-07-08',
    changes: [
      'Copy (Ctrl+C), cut (Ctrl+X), and paste (Ctrl+V) the selection — the pasted copy is offset so it clears the original and comes in selected',
    ],
  },
  {
    version: '0.1.12',
    date: '2026-07-08',
    changes: [
      'Cut list splits a run into separate pieces where a manufactured tee is inserted mid-run (shown as “·tee split”)',
    ],
  },
  {
    version: '0.1.11',
    date: '2026-07-08',
    changes: [
      'Instanced rendering now covers wrapped pivots, auto-resolved fittings, conflict markers, and pipe-end details too — every dense model (incl. the random-wrapped T-rex) is now a handful of draw calls',
    ],
  },
  {
    version: '0.1.10',
    date: '2026-07-08',
    changes: [
      'New “T-rex (random wrapped)” example — a random mix of wrapped swivel pivots and rigid joints',
      'All T-rex examples pruned of substantially-overlapping pipes (541 → 520)',
    ],
  },
  {
    version: '0.1.9',
    date: '2026-07-08',
    changes: [
      'Physics debug overlay (bug icon while simulating): see the rigid bodies and joint constraints from CrashCat',
      'Leaner physics read path and tunable solver iterations for faster simulation',
    ],
  },
  {
    version: '0.1.8',
    date: '2026-07-08',
    changes: ['Main page shows a “Built with” panel listing the technology stack'],
  },
  {
    version: '0.1.7',
    date: '2026-07-08',
    changes: [
      'Much faster rendering on dense articulated models (e.g. T-rex universal pivots): pipes and ball-joint hubs now draw as instanced meshes with per-frame updates — ~97% fewer draw calls, no per-frame React churn',
    ],
  },
  {
    version: '0.1.6',
    date: '2026-07-08',
    changes: ['Dark mode is the default; day/night toggle added to the main screen'],
  },
  {
    version: '0.1.5',
    date: '2026-07-08',
    changes: ['Backfilled the changelog with the full pre-0.1 version history'],
  },
  {
    version: '0.1.4',
    date: '2026-07-08',
    changes: [
      'Bend tool: drag a bent pipe’s tube to re-bend it — lock-length now works on already-bent pipes (a fresh bend that holds the cut length); a plain click still adds a control point',
    ],
  },
  {
    version: '0.1.3',
    date: '2026-07-08',
    changes: [
      'Removed the Plane tool — Shift-lock while drawing now covers 3D (draw up any axis, including Y)',
    ],
  },
  {
    version: '0.1.2',
    date: '2026-07-08',
    changes: [
      'Bent pipes are simulated as dynamic rigid bodies — they fall & collide like straight pipes, keeping their shape (no longer fixed in place)',
    ],
  },
  {
    version: '0.1.1',
    date: '2026-07-08',
    changes: [
      'Ground gridlines are darker than the ground in both themes, aligned to integer inches (4" minor / 1 ft major)',
      'Endpoint-drag modifiers follow the HELD key — hold Shift to axis-lock, hold Ctrl to detach (release reverts)',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-07-08',
    changes: [
      '3D drawing: hold Shift to lock to the Y axis as well as X and Z',
      'Draw and endpoint-drag snap onto pipes/nodes at any height (screen-space)',
      'Length arrows resize along the pipe axis — now works on vertical pipes',
      'Bend tool: “lock length” mode, and click a bent pipe to add a control point',
      'Bent pipes are editable (endpoint handles) and selectable like straight ones',
      'Wrapped pivots slide along the pipe they wrap, with friction (Play mode)',
      'Bent pipes behave as static rigid bodies while simulating',
      'Arrow keys / numpad nudge the selection; Ctrl+Up/Down (or Home/End) move in Y',
      'Ctrl/Shift are toggleable mid-drag (press to switch modes without holding)',
      'New 3-way (corner) elbow fitting; free ball-joint hubs for any number of pipes',
      'T-rex examples rebuilt as detailed quad wireframes',
    ],
  },
  {
    version: '0.0.3',
    date: '2026-07-08',
    changes: [
      'Deployed to the web (Cloudflare Pages)',
      'Display units pill: mm / cm / decimal & fractional inch, with length parsing',
      'Right-click menus: pick a join type at a junction, switch pipe size on a run',
      'Multi-select move/rotate gizmos; Ctrl-drag to break a union',
      'Camera view presets; the document remembers its camera, tool, and units',
      'Draw-mode snap indicators + type an exact length while drawing',
      'Tape-measure tool; new Bend tool to curve existing pipes; draw-on-a-plane tool',
      'Manufactured joints (snap to a standard elbow/coupling); BOM wrap + end-cap allowances',
      'Free pivots articulate as true 3-DOF ball joints inside closed loops',
      'Bundled T-rex example models',
    ],
  },
  {
    version: '0.0.2',
    date: '2026-07-07',
    changes: [
      'Move (M) and Rotate tools with 3-axis gizmos',
      'Marquee (rubber-band) select with CAD window/crossing semantics',
      'Click-and-drag drawing; 3D drawing with Shift-lock to any axis',
      'View-aware endpoint dragging — floating nodes keep their height',
      'Real hollow pipe ends; heat-wrapped tees / molded saddle fittings',
      'Closed-loop kinematics — squares articulate with lengths preserved',
      'Velocity-aware, cursor-anchored zoom; snap-settings pill',
    ],
  },
  {
    version: '0.0.1',
    date: '2026-07-07',
    changes: [
      'Initial build — a 3D-first PVC design studio (SketchUp-for-PVC)',
      'Draw straight pipe with snapping/inference, PBR render at true OD, editable lengths',
      'SCH 40 fittings inferred and drawn automatically, with conflicts flagged',
      'Heat-formed (bent) pipe as smooth splines with a bend schedule + min-radius check',
      'Pivots with a deterministic kinematic solver: sliders + drag-to-rotate, lengths preserved',
      'BOM / cut-list with socket take-offs + CSV; JSON export/import; example models',
      'Rigid-body physics simulation (Play mode)',
    ],
  },
];

/** The current app version (matches the newest changelog entry + the git tag). */
export const APP_VERSION = CHANGELOG[0]?.version ?? '0.0.0';
