import { Check, Magnet } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import type { LengthDisplay } from '../schema';
import { useAppStore } from '../state/appStore';
import { useEditorStore } from '../state/editorStore';
import { formatLengthDisplay } from './units';

const IN = 0.0254;
// inch-aligned steps, 1/4" at the finest (finer grids fight the pipe ODs)
const IMPERIAL = [
  { label: 'Off', m: 0 },
  { label: '1/4"', m: IN / 4 },
  { label: '1/2"', m: IN / 2 },
  { label: '1"', m: IN },
  { label: '2"', m: IN * 2 },
];
const METRIC = [
  { label: 'Off', m: 0 },
  { label: '5', m: 0.005 },
  { label: '10', m: 0.01 },
  { label: '25', m: 0.025 },
  { label: '50', m: 0.05 },
];

/** Grid options follow the DISPLAY units (the units pill / `lengthDisplay`),
 * not the legacy document `unitsPreference` — inch mode offers inch-aligned
 * steps, mm/cm modes offer millimetre steps. */
function optionsFor(display: LengthDisplay) {
  return display === 'in' || display === 'in-frac' ? IMPERIAL : METRIC;
}

function ToggleRow({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
    >
      <span>{label}</span>
      <span
        className={`flex h-4 w-4 items-center justify-center rounded ${
          on ? 'bg-primary text-primary-foreground' : 'border border-border'
        }`}
      >
        {on && <Check size={12} />}
      </span>
    </button>
  );
}

/** Floating snapping-settings pill (planfile §6): grid increment (default
 * 1/4") plus point-snap and axis-inference toggles. Persisted workspace pref. */
export function SnapPill() {
  const snap = useEditorStore((s) => s.snap);
  const setSnap = useEditorStore((s) => s.setSnap);
  const display = useAppStore((s) => s.current?.lengthDisplay ?? 'in');
  const [open, setOpen] = useState(false);

  const inches = display === 'in' || display === 'in-frac';
  const opts = optionsFor(display);
  const current = opts.find((o) => Math.abs(o.m - snap.gridStepM) < 1e-9);
  const unitTag = inches ? '' : ' mm';
  const label =
    snap.gridStepM === 0
      ? 'No grid'
      : current
        ? `${current.label}${unitTag}`
        : // a step saved under the other unit system — show it converted, not raw metres
          formatLengthDisplay(snap.gridStepM, display);

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Snapping settings"
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
        >
          <Magnet
            size={14}
            className={snap.gridStepM > 0 ? 'text-primary' : 'text-muted-foreground'}
          />
          <span className="tabular-nums">{label}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[100] w-44 rounded-lg border border-border bg-card p-2 shadow-lg"
        >
          <div className="px-1 pb-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
            Grid {inches ? '(inch)' : '(mm)'}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {opts.map((o) => {
              const active = Math.abs(o.m - snap.gridStepM) < 1e-9;
              return (
                <button
                  key={o.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSnap({ gridStepM: o.m })}
                  className={`rounded-md px-1.5 py-1 text-xs tabular-nums ${
                    active
                      ? 'bg-accent text-accent-foreground ring-1 ring-ring/40'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          <div className="my-2 h-px bg-border" />
          <ToggleRow
            label="Snap to ends"
            on={snap.snapToEnds}
            onClick={() => setSnap({ snapToEnds: !snap.snapToEnds })}
          />
          <ToggleRow
            label="Snap along pipes"
            on={snap.snapToPipes}
            onClick={() => setSnap({ snapToPipes: !snap.snapToPipes })}
          />
          <ToggleRow
            label="Axis inference"
            on={snap.axisInference}
            onClick={() => setSnap({ axisInference: !snap.axisInference })}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
