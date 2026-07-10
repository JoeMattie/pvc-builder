import { AlertTriangle, Download, X } from 'lucide-react';
import { Fragment } from 'react';
import { bom, bomToCsv, cutSourceSummary, JOINT_HARDWARE, JOINT_LABEL } from '../design/bom';
import { suggestedFileName } from '../persistence/exportImport';
import { useAppStore } from '../state/appStore';
import { downloadFile } from './lib/download';
import { formatLengthDisplay } from './units';

const RAD2DEG = 180 / Math.PI;
const trim = (v: number, dp: number): string => String(Number(v.toFixed(dp)));

/** BOM / cut-list panel (planfile §8): per-pipe cut lengths, fitting counts,
 * totals, and a CSV download. */
export function BomPanel({
  hideHeader = false,
  onClose,
}: {
  hideHeader?: boolean;
  /** only used by the built-in header; optional when hideHeader */
  onClose?: () => void;
}) {
  const design = useAppStore((s) => s.current);
  if (!design) return null;
  const b = bom(design);
  const fmt = (m: number) => formatLengthDisplay(m, design.lengthDisplay);
  const angle = (rad: number) => `${trim(rad * RAD2DEG, 1)} deg`;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg bg-card/70">
      {!hideHeader && (
        <div className="flex items-center justify-between border-border border-b px-3 py-2">
          <span className="text-sm font-medium">Cut list</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() =>
                downloadFile(
                  suggestedFileName(design).replace(/\.pvc\.json$/, '.csv'),
                  bomToCsv(design),
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
      )}

      <div className="scrollbar-minimal min-h-0 flex-1 overflow-y-auto px-3 py-2 text-xs">
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
                {b.cuts.map((c, i) => {
                  const extra = c.wrapAllowanceM + c.endCapM;
                  const base = c.cutLengthM - extra;
                  const sources = cutSourceSummary(c);
                  const hasBends = (c.bendSchedule?.length ?? 0) > 0;
                  return (
                    <Fragment key={`${c.memberId}-${c.segment ?? 'x'}`}>
                      <tr>
                        <td
                          title={sources.length > 0 ? `Sources: ${sources.join('; ')}` : undefined}
                        >
                          P{i + 1}
                          {c.kind === 'formed' ? ' ·bent' : ''}
                          {c.segment !== undefined ? ' ·tee split' : ''}
                          {sources.length > 0 && (
                            <span aria-hidden className="text-muted-foreground">
                              *
                            </span>
                          )}
                        </td>
                        <td>{c.size}</td>
                        <td className="text-right">
                          {extra > 1e-6 ? (
                            // base + fabrication allowance = cut — write this on the pipe
                            <span title="pipe + wrap/end-cap allowance">
                              {fmt(base)} + {fmt(extra)} = <b>{fmt(c.cutLengthM)}</b>
                            </span>
                          ) : (
                            fmt(c.cutLengthM)
                          )}
                        </td>
                      </tr>
                      {hasBends && (
                        <tr>
                          <td colSpan={3} className="pb-2 text-muted-foreground">
                            <div className="mt-0.5 border-border border-l pl-2">
                              <span className="font-medium text-foreground">Bends:</span>{' '}
                              {c.bendSchedule!.map((bend) => (
                                <span
                                  key={bend.bend}
                                  className={bend.belowMin ? 'text-destructive' : undefined}
                                >
                                  B{bend.bend} {angle(bend.deflectionRad)}, twist{' '}
                                  {angle(bend.dihedralRad)}, R{' '}
                                  {bend.radiusM > 1e-9 ? fmt(bend.radiusM) : 'unspecified'}
                                  {bend.belowMin ? ` (min ${fmt(bend.minRadiusM)})` : ''}
                                  {bend.bend === c.bendSchedule!.length ? '' : '; '}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
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

            {b.joints.length > 0 && (
              <>
                <div className="mt-3 mb-1 font-medium text-muted-foreground uppercase text-[10.5px] tracking-wide">
                  Joints
                </div>
                {b.joints.map((j) => (
                  <div key={j.mode} className="flex justify-between">
                    <span>
                      {j.count}× {JOINT_LABEL[j.mode]}
                    </span>
                    <span className="text-muted-foreground">{JOINT_HARDWARE[j.mode]}</span>
                  </div>
                ))}
              </>
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

            {b.warnings.length > 0 && (
              <details className="mt-3 rounded-md border border-border bg-muted/40 px-2 py-1.5">
                <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wide hover:text-foreground [&::-webkit-details-marker]:hidden">
                  <AlertTriangle size={12} />
                  Assumptions ({b.warnings.length})
                </summary>
                <div className="mt-1.5 space-y-1 text-muted-foreground">
                  {b.warnings.map((w) => (
                    <div
                      key={w.key}
                      className={w.severity === 'fabrication' ? 'text-destructive' : undefined}
                    >
                      {w.message}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
