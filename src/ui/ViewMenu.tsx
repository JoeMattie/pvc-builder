import { Box } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { setView, type ViewName } from '../state/cameraStore';

// Named camera views (schema-independent): four isometric corners + the six
// orthographic faces. Clicking snaps the camera (keeping target + distance).
const GROUPS: { label: string; views: { name: ViewName; label: string }[] }[] = [
  {
    label: 'Isometric',
    views: [
      { name: 'iso-ne', label: 'NE' },
      { name: 'iso-nw', label: 'NW' },
      { name: 'iso-se', label: 'SE' },
      { name: 'iso-sw', label: 'SW' },
    ],
  },
  {
    label: 'Ortho',
    views: [
      { name: 'top', label: 'Top' },
      { name: 'front', label: 'Front' },
      { name: 'back', label: 'Back' },
      { name: 'right', label: 'Right' },
      { name: 'left', label: 'Left' },
    ],
  },
];

/** A compact "Views" dropdown (in the top-right toolbar). */
export function ViewMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-pressed={open}
        title="Camera views"
        className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <Box size={13} /> Views
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-border bg-card p-1 shadow-lg">
          {GROUPS.map((g) => (
            <div key={g.label}>
              <div className="px-2 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {g.label}
              </div>
              <div className="mb-1 flex flex-wrap gap-1 px-1">
                {g.views.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    onClick={() => {
                      setView(v.name);
                      setOpen(false);
                    }}
                    className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
