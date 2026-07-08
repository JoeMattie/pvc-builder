import { Download, X } from 'lucide-react';
import { bom, bomToCsv } from '../design/bom';
import { suggestedFileName } from '../persistence/exportImport';
import { useAppStore } from '../state/appStore';
import { downloadFile } from './lib/download';
import { formatLength } from './units';

/** BOM / cut-list panel (planfile §8): per-pipe cut lengths, fitting counts,
 * totals, and a CSV download. */
export function BomPanel({ onClose }: { onClose: () => void }) {
  const design = useAppStore((s) => s.current);
  if (!design) return null;
  const b = bom(design);
  const units = design.unitsPreference;
  const fmt = (m: number) => formatLength(m, units);

  return (
    <div className="absolute top-16 right-4 flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg">
      <div className="flex items-center justify-between border-border border-b px-3 py-2">
        <span className="text-sm font-medium">Cut list</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              downloadFile(
                suggestedFileName(design).replace(/\.pvc\.json$/, '.csv'),
                bomToCsv(design, units),
                'text/csv',
              )
            }
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <Download size={13} /> CSV
          </button>
          <button
            type="button"
            aria-label="Close cut list"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="overflow-y-auto px-3 py-2 text-xs">
        {b.cuts.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground">
            Draw some pipe to see a cut list.
          </p>
        ) : (
          <>
            <table className="w-full tabular-nums">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left font-medium">Pipe</th>
                  <th className="text-left font-medium">Size</th>
                  <th className="text-right font-medium">Cut</th>
                </tr>
              </thead>
              <tbody>
                {b.cuts.map((c, i) => (
                  <tr key={c.memberId}>
                    <td>
                      P{i + 1}
                      {c.kind === 'formed' ? ' ·bent' : ''}
                    </td>
                    <td>{c.size}</td>
                    <td className="text-right">{fmt(c.cutLengthM)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-3 mb-1 font-medium text-muted-foreground uppercase text-[10.5px] tracking-wide">
              Fittings
            </div>
            {b.fittings.length === 0 ? (
              <p className="text-muted-foreground">None</p>
            ) : (
              b.fittings.map((f) => (
                <div
                  key={`${f.type}-${f.sizes.join()}-${f.reducing}`}
                  className="flex justify-between"
                >
                  <span>
                    {f.count}× {f.type}
                    {f.reducing ? ' (reducing)' : ''} {f.sizes.join(' × ')}
                  </span>
                </div>
              ))
            )}

            <div className="mt-3 mb-1 font-medium text-muted-foreground uppercase text-[10.5px] tracking-wide">
              Total pipe
            </div>
            {Object.entries(b.totalBySize).map(([size, total]) => (
              <div key={size} className="flex justify-between">
                <span>{size}</span>
                <span className="tabular-nums">{fmt(total ?? 0)}</span>
              </div>
            ))}
            {b.conflicts > 0 && (
              <div className="mt-2 text-destructive">
                {b.conflicts} joint conflict{b.conflicts === 1 ? '' : 's'}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
