// Day/night theming. The shadcn chrome tokens live in index.css and flip on
// the `.dark` class; applyTheme() just toggles that class before first paint
// and on every theme change (main.tsx wires it to the theme store).
//
// three.js materials/renderers can't resolve CSS variables, so the few
// legibility-critical scene colors (viewport background, ground grid, PVC
// tube) are literals here, keyed by day/night, and re-read off the store's
// `night` flag when it changes.
export type ThemeName = 'day' | 'night';

/** The visible ground is a finite square (not infinite) — 20 ft across is plenty
 * for PVC-scale designs. Metres = 20 · 0.3048. */
export const GROUND_SIZE_M = 20 * 0.3048;

const SCENE = {
  day: {
    viewport: '#f6f7f9',
    // a mid-gray ground, distinct from the sky and darker than the pipes
    ground: '#c6cad3',
    gridCell: '#d9dbe2',
    gridSection: '#b9bcc7',
    pvc: '#e7e9ee',
    fitting: '#c6cad3',
    conflict: '#d64545',
    accent: '#2a78d6',
  },
  night: {
    viewport: '#101218',
    // dark gray: lighter than the near-black sky, but darker than the light pipes
    ground: '#2b2f38',
    gridCell: '#2a2d38',
    gridSection: '#3a3f4b',
    pvc: '#c6cbd7',
    fitting: '#9aa0ad',
    conflict: '#e0554a',
    accent: '#3d8ae0',
  },
} as const satisfies Record<ThemeName, Record<string, string>>;

export function scenePalette(night: boolean) {
  return SCENE[night ? 'night' : 'day'];
}

/** Toggle the `.dark` class the shadcn tokens key off. Idempotent; safe to
 * call before render. */
export function applyTheme(name: ThemeName): void {
  document.documentElement.classList.toggle('dark', name === 'night');
}
