import { Ruler } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LengthDisplay } from '../schema';
import { useAppStore } from '../state/appStore';
import { setLengthDisplay } from '../state/editorActions';

/** The units pill (bottom-right): pick how lengths are DISPLAYED — millimetres,
 * centimetres, decimal inches, or fractional inches. Display-only (schema v6
 * `lengthDisplay`); storage is always SI. Default (undefined) is decimal inches. */
const OPTIONS: { value: LengthDisplay; label: string; hint: string }[] = [
  { value: 'in', label: 'Inches', hint: 'decimal — 10.5"' },
  { value: 'in-frac', label: 'Inches', hint: 'fractional — 10 1/2"' },
  { value: 'mm', label: 'Millimetres', hint: 'mm' },
  { value: 'cm', label: 'Centimetres', hint: 'cm' },
];

const SHORT: Record<LengthDisplay, string> = {
  in: 'in',
  'in-frac': 'in ½',
  mm: 'mm',
  cm: 'cm',
};

export function UnitsPill() {
  const hasDesign = useAppStore((s) => s.current !== null);
  const display = useAppStore((s) => s.current?.lengthDisplay) ?? 'in';
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

  if (!hasDesign) return null;

  return (
    <div ref={ref} className="relative">
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-44 rounded-xl border border-border bg-card p-1 shadow-md">
          <div className="px-2 pt-1 pb-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
            Display units
          </div>
          {OPTIONS.map((o) => {
            const active = display === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setLengthDisplay(o.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                <span>{o.label}</span>
                <span className={`text-[10px] ${active ? 'opacity-80' : 'text-muted-foreground'}`}>
                  {o.hint}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <button
        type="button"
        aria-label="Display units"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-md hover:text-foreground"
      >
        <Ruler size={14} />
        <span className="tabular-nums">{SHORT[display]}</span>
      </button>
    </div>
  );
}
