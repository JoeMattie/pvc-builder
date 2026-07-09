import { resolveFittings } from '../../design/fittings';
import { analyzeFormed } from '../../design/formed';
import { intersectingMembers } from '../../design/intersections';
import type { Design } from '../../schema';

export interface EditorWarningSummary {
  total: number;
  fittingConflicts: number;
  overlaps: number;
  tightBends: number;
}

/** Editor-level warning count for persistent chrome. Keep this broad and cheap
 * enough for a status surface; detailed diagnostics stay in their panels. */
export function summarizeEditorWarnings(design: Design | null | undefined): EditorWarningSummary {
  if (!design) return { total: 0, fittingConflicts: 0, overlaps: 0, tightBends: 0 };

  const fittingConflicts = resolveFittings(design).conflicts.length;
  const overlaps = intersectingMembers(design).size;
  let tightBends = 0;
  for (const member of design.members) {
    if (member.kind !== 'formed') continue;
    if (analyzeFormed(design, member)?.hasTightBend) tightBends++;
  }

  return {
    total: fittingConflicts + overlaps + tightBends,
    fittingConflicts,
    overlaps,
    tightBends,
  };
}
