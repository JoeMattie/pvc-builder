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
];

/** The current app version (matches the newest changelog entry + the git tag). */
export const APP_VERSION = CHANGELOG[0]?.version ?? '0.0.0';
