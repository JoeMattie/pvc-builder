import { Check, Magnet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { UnitsPreference } from '../schema';
import { useAppStore } from '../state/appStore';
import { useEditorStore } from '../state/editorStore';

const IN = 0.0254;
const IMPERIAL = [
  { label: 'Off', m: 0 },
  { label: '1/8"', m: IN / 8 },
  { label: '1/4"', m: IN / 4 },
  { label: '1/2"', m: IN / 2 },
  { label: '1"', m: IN },
];
const METRIC = [
  { label: 'Off', m: 0 },
  { label: '5', m: 0.005 },
  { label: '10', m: 0.01 },
  { label: '25', m: 0.025 },
  { label: '50', m: 0.05 },
];

function optionsFor(units: UnitsPreference) {
  return units === 'imperial' ? IMPERIAL : METRIC;
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
  const units = useAppStore((s) => s.current?.unitsPreference ?? 'imperial');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const opts = optionsFor(units);
  const current = opts.find((o) => Math.abs(o.m - snap.gridStepM) < 1e-9);
  const unitTag = units === 'imperial' ? '' : ' mm';
  const label =
    snap.gridStepM === 0
      ? 'No grid'
      : `${current?.label ?? snap.gridStepM}${current ? unitTag : ''}`;

  return (
    <div ref={ref} className="relative">
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-44 rounded-xl border border-border bg-card p-2 shadow-md">
          <div className="px-1 pb-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
            Grid {units === 'imperial' ? '(inch)' : '(mm)'}
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
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Snapping settings"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm"
      >
        <Magnet
          size={14}
          className={snap.gridStepM > 0 ? 'text-primary' : 'text-muted-foreground'}
        />
        <span className="tabular-nums">{label}</span>
      </button>
    </div>
  );
}
