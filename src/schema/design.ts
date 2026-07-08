import { z } from 'zod';
import { idSchema, nominalSizeSchema, unitsPreferenceSchema, vec3Schema } from './common';

/** Bump on every schema change and add a migration keyed by the version it
 * upgrades FROM (planfile §3, enforced by migrations.test).
 * v1: nodes + straight members.
 * v2: `formed` (heat-bent spline) member variant.
 * v3: `pivots` (heat-formed revolute joints). */
export const SCHEMA_VERSION = 3;

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

/** A heat-bent pipe (planfile §3): a smooth spline swept through
 * nodeA → controlPoints → nodeB (Catmull-Rom). Each control point is a bend
 * vertex; `filletRadiiM[i]` is the bend radius at controlPoints[i] (absent =
 * sharp / not yet specified), used for developed-length + min-bend-radius. */
export const formedMemberSchema = z.object({
  id: idSchema,
  kind: z.literal('formed'),
  nodeA: idSchema,
  nodeB: idSchema,
  controlPoints: z.array(vec3Schema),
  size: nominalSizeSchema,
  filletRadiiM: z.array(z.number().nonnegative()).optional(),
});

/** Discriminated union on `kind` (straight | formed). */
export const memberSchema = z.discriminatedUnion('kind', [
  straightMemberSchema,
  formedMemberSchema,
]);

/** A heat-formed wrapping pivot (planfile §3): a revolute joint between two
 * members that share `nodeId`, rotating about `axis` (design-space unit
 * vector). `angleRad` is the current/target rotation from the design rest pose
 * (read/written by both drag and the angle slider). */
export const pivotSchema = z.object({
  id: idSchema,
  nodeId: idSchema,
  memberA: idSchema,
  memberB: idSchema,
  axis: vec3Schema,
  angleRad: z.number().optional(),
  limits: z.object({ minRad: z.number(), maxRad: z.number() }).optional(),
});

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
  /** global "lock lengths" toggle: when true, all lengths + non-pivot joints
   * freeze and only pivots move (planfile §1 physics / §5 solver) */
  lengthsLocked: z.boolean(),
  nodes: z.array(nodeSchema),
  members: z.array(memberSchema),
  /** heat-formed revolute joints */
  pivots: z.array(pivotSchema),
});

export type Node = z.infer<typeof nodeSchema>;
export type StraightMember = z.infer<typeof straightMemberSchema>;
export type FormedMember = z.infer<typeof formedMemberSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Pivot = z.infer<typeof pivotSchema>;
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
    pivots: [],
  };
}
