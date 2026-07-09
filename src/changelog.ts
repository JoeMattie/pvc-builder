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
    version: '0.3.3',
    date: '2026-07-09',
    changes: [
      'The editor now works on phones and small tablets: below 640 px the tool palette becomes an icons-only rail docked under the left panels, the Objects list starts collapsed, the document bar condenses to one row, and the Simulate/Cut-list panels move to the bottom-right so the workflow switcher stays reachable. Desktop layout is unchanged.',
    ],
  },
  {
    version: '0.3.2',
    date: '2026-07-09',
    changes: [
      'Fixed the hover popup flickering like crazy over pipes: the popup itself was intercepting the pointer (it anchors at the pipe midpoint, right under your cursor), which knocked the hover off the pipe and unmounted the popup in a ~110 ms loop. Labels are now fully click-through.',
      'Landing page: example cards are compact single rows (icon, name, description, stats), and on phones the tagline wraps to its own line under the title.',
    ],
  },
  {
    version: '0.3.1',
    date: '2026-07-09',
    changes: [
      'Cleaner default workspace: the document panel is pinned top-left and now holds the workspace-reset button plus the autosave and warning chips; the workflow switcher is a compact one-row pill; panels stack with consistent measured spacing after a reset instead of fixed offsets.',
      'Panels overlap freely now — the automatic dodging is gone (edge snapping while dragging stays), and the Document, Workflow, Snap, and View panels no longer collapse.',
      'The tool bar always shows every tool — no more resizing or hidden buttons — and can flip vertical. The length lock moved out of Simulate into the tool bar as “Drag lock” (it governs editing drags, not simulation).',
      'Push (Extend) polish: direction stubs stay visible during an active push, and you can click-drag from a stub to place the new pipe in one gesture.',
      'Fabricate: the cut list leads with the cuts — sourcing/assumption notes are a collapsed disclosure — and pipe labels no longer draw over bars or menus. Fixed the display-units menu not opening.',
      'Faster first load: the heavy renderer-effects pass is split out of the main bundle (~300 kB) and loads in the background; toggling effects fades through a brief blur instead of hitching.',
      'Landing page: example cards are equal-sized with readable names and their stats moved below the description.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-07-09',
    changes: [
      'Reworked the editor into clearer Design, Fabricate, and Simulate workflows: simulation now has its own compact control panel, fabrication/BOM stays focused on shop output, and the status chrome makes the active geometry state easier to read.',
      'Improved fabrication confidence with richer cut-list detail, pipe labels that match BOM rows, bend schedules, source/assumption notes, and clearer fitting/joint diagnostics.',
      'Added resettable, draggable, and resizable workspace panels: the tool palette, object list, and BOM can be resized, floating panels use left-side drag rails, panel positions/sizes are remembered, and the top-left reset icon restores the default layout.',
      'Polished editor chrome with minimal scrollbars, responsive pillboxes, automatic overlap avoidance, and fixes that keep Extend active until another tool is explicitly selected.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-07-09',
    changes: [
      'Fixed a bug where moving or rotating a group skewed the parts inside it (a node shared by two grouped pipes was being transformed twice) — groups now move and spin as one rigid body. Corrupt models with a broken pipe reference are also auto-repaired on load.',
      'New Object tree on the left lists every pipe and group: click to select, Ctrl-click to multi-select, and clicking a grouped part enters its group and greys out the rest. Each group gets a subtle colour cast you can change with its colour swatch, plus Group / Ungroup buttons.',
      'Groups now lock their contents: you can only move/rotate a group as a whole until you double-click to enter it. Rotate is now its own tool (R).',
      'New Extend tool (P): hover a pipe end to see push-cylinders in every open direction, then click one to draw a new pipe locked to that axis.',
      'New Guide lines (Q): click a pipe to drop an endless construction line parallel to it; type an exact offset, then click to place. Drawing snaps to where guides cross pipes; Shift+Q clears them.',
      'New Wireframe view (W): see the whole model as clean lines and junction dots.',
      'For developers: a dev-only bridge now exposes the running app’s window.__pvc automation hook to external tools over HTTP/SSE, with an MCP server (tools/pvc-mcp) so an agent can query and drive a live editing session. It never ships in production builds.',
    ],
  },
  {
    version: '0.1.19',
    date: '2026-07-09',
    changes: [
      'Project Raptor templates (2 of 2): the full five-phase set — “Raptor · + legs”, “+ neck”, and the balance-tuned “Raptor · full costume” (head + jaw). Load any of them, enable the mannequin, and press Play: the costume hangs on the wearer with the tail counterbalancing the neck+head so it settles roughly level.',
      'Each phase builds on the last (harness frame → tail → legs → neck → head), with wrapped/free flex joints and elastic suspension bands. Pose them freely by dragging in the editor; tune the settle with the Damping slider in Play.',
    ],
  },
  {
    version: '0.1.18',
    date: '2026-07-09',
    changes: [
      'Project Raptor templates (1 of 2): load “Raptor · harness frame” and “Raptor · + tail” from the examples list — a PVC hip/shoulder frame that hangs on the mannequin (enable it in Play), plus a segmented counterweight tail with wrapped flex joints and elastic suspension bands.',
      'Tip: open a Raptor example, turn on the mannequin, and press Play to watch it rest and settle on the wearer.',
    ],
  },
  {
    version: '0.1.17',
    date: '2026-07-09',
    changes: [
      'Mannequin: toggle a static human body (the person icon in the toolbar) that your design rests and hangs on in Play instead of falling to the floor — sized to a ~1.75 m wearer standing at the origin.',
      'Damping slider (shown in Play): a global friction/drag multiplier so joints and elastic bands settle correctly. 1× keeps the previous feel; raise it for more drag.',
    ],
  },
  {
    version: '0.1.16',
    date: '2026-07-09',
    changes: [
      'Documentation + in-app help: a full illustrated user guide (docs/USER-GUIDE.md), plus a “?” help button in the editor toolbar and a “Guide” button on this page that open a keyboard-shortcut + how-it-works reference.',
    ],
  },
  {
    version: '0.1.15',
    date: '2026-07-08',
    changes: [
      'Elastic bands (press E): click two attachment points — a pipe end or a point along a pipe — to add a pre-tensioned spring band that pulls them together in the physics simulation (Play).',
      'Select a band to show a tension slider; Delete removes it. Bands follow the pipes as they move and tint hotter the more they stretch.',
    ],
  },
  {
    version: '0.1.14',
    date: '2026-07-08',
    changes: [
      'Groups: press G to group the selection, Shift+G to ungroup. Clicking any grouped pipe selects the whole group; double-click to enter a group (others fade + go inert), Esc to exit.',
      'Snapping to a grouped object from outside works but defers its union until the group is dissolved (auto-solved on ungroup).',
    ],
  },
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
