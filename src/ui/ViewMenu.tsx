import { Box } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
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

/** A compact portal-backed "Views" dropdown in the top-right toolbar. */
export function ViewMenu() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          title="Camera views"
          className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
        >
          <Box size={13} /> Views
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[100] w-44 rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          {GROUPS.map((g) => (
            <div key={g.label}>
              <DropdownMenu.Label className="px-2 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {g.label}
              </DropdownMenu.Label>
              <div className="mb-1 flex flex-wrap gap-1 px-1">
                {g.views.map((v) => (
                  <DropdownMenu.Item
                    key={v.name}
                    onSelect={() => setView(v.name)}
                    className="cursor-pointer rounded-md border border-border px-2 py-1 text-xs text-foreground outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                  >
                    {v.label}
                  </DropdownMenu.Item>
                ))}
              </div>
            </div>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
