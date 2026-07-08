import { z } from 'zod';
import { idSchema, nominalSizeSchema, unitsPreferenceSchema, vec3Schema } from './common';

/** Bump on every schema change and add a migration keyed by the version it
 * upgrades FROM (planfile §3, enforced by migrations.test). v1 is the first
 * release: nodes + straight members. Formed members (Phase 3) and pivots
 * (Phase 4) each land as a version bump + migration. */
export const SCHEMA_VERSION = 1;

/** A junction where pipe ends meet. Position is SI metres. */
export const nodeSchema = z.object({
  id: idSchema,
  position: vec3Schema,
});

/** A rigid straight length of pipe between two nodes. Its length is DERIVED
 * from the node positions in design mode (or held rigid in locked mode); it is
 * never stored. */
export const straightMemberSchema = z.object({
  id: idSchema,
  kind: z.literal('straight'),
  nodeA: idSchema,
  nodeB: idSchema,
  size: nominalSizeSchema,
});

/** Discriminated union on `kind`. v1 has only straight members; `formed`
 * (heat-bent spline) is added in Phase 3 as a new variant + migration. */
export const memberSchema = z.discriminatedUnion('kind', [straightMemberSchema]);

/** The top-level design document — the single source of truth for the file
 * format. Resolved fittings are NOT stored (planfile §3): they are a pure
 * function of the design, recomputed continuously. */
export const designSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: idSchema,
  name: z.string().min(1),
  unitsPreference: unitsPreferenceSchema,
  /** which nominal sizes the pillbox offers (planfile §1) */
  enabledSizes: z.array(nominalSizeSchema),
  /** global "lock lengths" toggle: when true, only heat-formed pivots move
   * (planfile §1 physics); v1 stores the flag, the solver arrives in Phase 4 */
  lengthsLocked: z.boolean(),
  nodes: z.array(nodeSchema),
  members: z.array(memberSchema),
});

export type Node = z.infer<typeof nodeSchema>;
export type StraightMember = z.infer<typeof straightMemberSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Design = z.infer<typeof designSchema>;

export function createEmptyDesign(id: string, name: string): Design {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    unitsPreference: 'imperial',
    enabledSizes: ['1/2"', '3/4"'],
    lengthsLocked: false,
    nodes: [],
    members: [],
  };
}
