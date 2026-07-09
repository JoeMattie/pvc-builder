import { z } from 'zod';
import {
  idSchema,
  lengthDisplaySchema,
  nominalSizeSchema,
  quaternionSchema,
  unitsPreferenceSchema,
  vec3Schema,
} from './common';

/** Bump on every schema change and add a migration keyed by the version it
 * upgrades FROM (planfile §3, enforced by migrations.test).
 * v1: nodes + straight members.
 * v2: `formed` (heat-bent spline) member variant.
 * v3: `pivots` (heat-formed revolute joints).
 * v4: `wraps` (heat-wrapped tee connections onto a pipe body).
 * v5: unified `joints` — every non-default pipe connection (wrapped pivot, free
 *     ball-joint pivot, or intact-run screwed tee) is ONE joint record; the old
 *     `pivots` and `wraps` arrays are folded into it.
 * v6: doc-stored UI state (`viewport`, `lengthDisplay`), persistent tape-measure
 *     objects (`measurements`), and `joint.manufactured` (render as off-the-shelf
 *     fitting). All additive/optional except `measurements` (defaults to []).
 * v7: `groups` — named sets of members that move/select/copy as a unit and defer
 *     unions across their boundary. Defaults to [].
 * v8: `elastics` — spring "bands" between two attachment points (a pipe END node
 *     or a point ALONG a member) that pull together in the physics sim. Defaults
 *     to [].
 * v9: optional `mannequin` (show/collide against a static human body in Play) +
 *     optional `jointDamping` (global friction/drag multiplier for the sim).
 *     Both optional → no required data; old docs migrate untouched. */
export const SCHEMA_VERSION = 9;

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

/** How two pipes connect at a joint (planfile §4/§5). Every non-default
 * connection is ONE `joint` record; a plain rigid end-to-end coupling/elbow is
 * the DEFAULT and carries no record (it's inferred by `resolveFittings`).
 *  • `anchor`  — rigid/welded. Only stored for an on-body joint (an intact-run
 *                screwed tee: the branch is flattened + screwed to the run,
 *                which is NOT cut). End-to-end anchors are the default → no record.
 *  • `wrapped` — the `mover` pipe wraps the `receiver` and swivels about the
 *                receiver's own axis (a revolute pivot; axis is DERIVED from the
 *                receiver direction, never stored — "always around the receiving
 *                pipe"). `angleRad` is the rotation from the drawn rest pose.
 *  • `free`    — a ball joint pivoting in ANY direction: two pipe ends butt at
 *                `nodeId` with eye bolts + a knotted cord + a ball, or (on-body)
 *                the branch ball-joints to a saddle eye bolt clamped on the run.
 *                `orientation` is the 3-DOF rotation of the `mover` relative to
 *                the `receiver` (identity = as drawn). */
export const jointModeSchema = z.enum(['anchor', 'wrapped', 'free']);

export const jointSchema = z.object({
  id: idSchema,
  /** the connection point: the shared end node (end-to-end) or, for `onBody`,
   * the `mover`'s end node sitting on the `receiver`'s intact span */
  nodeId: idSchema,
  /** the pipe that stays put — the one wrapped/butted against */
  receiver: idSchema,
  /** the pipe that pivots (or, for an on-body joint, the branch) */
  mover: idSchema,
  /** mover's end lies on receiver's SPAN (intact run) vs both ends meet at nodeId */
  onBody: z.boolean(),
  mode: jointModeSchema,
  /** wrapped: revolute rotation about the receiver axis (0 = as drawn) */
  angleRad: z.number().optional(),
  /** free: 3-DOF orientation of mover vs receiver (identity = as drawn) */
  orientation: quaternionSchema.optional(),
  /** wrapped: optional revolute travel limits */
  limits: z.object({ minRad: z.number(), maxRad: z.number() }).optional(),
  /** v6: render this joint as an off-the-shelf manufactured fitting (the mover
   * pipe has been bent so its approach angle matches a standard elbow/tee) */
  manufactured: z.boolean().optional(),
});

/** v6: a persistent tape-measure. Each end is either pinned to a node
 * (`{nodeId}`) or a free point (`{position}`). `offsetM` is the perpendicular
 * distance of the drawn dimension line from the measured axis (0 = on-axis). */
export const measurementEndSchema = z.union([
  z.object({ nodeId: idSchema }),
  z.object({ position: vec3Schema }),
]);
export const measurementSchema = z.object({
  id: idSchema,
  a: measurementEndSchema,
  b: measurementEndSchema,
  offsetM: z.number(),
});

/** v6: doc-stored viewport/UI state, restored when the document is opened so a
 * project reopens exactly as it was saved (planfile: states stored in the doc,
 * not carried over from the previous document). All fields optional. Camera and
 * tool are written outside undo history (see appStore). */
export const cameraPoseSchema = z.object({
  position: vec3Schema,
  target: vec3Schema,
  zoom: z.number(),
});
export const viewportSchema = z.object({
  camera: cameraPoseSchema.optional(),
  /** 'orthographic' | 'perspective' — kept as a loose string so adding view
   * modes never forces a schema bump */
  projection: z.string().optional(),
  /** last active tool id (loose string for the same forward-compat reason) */
  tool: z.string().optional(),
  drawSize: nominalSizeSchema.optional(),
});

/** v7: a group — a named set of members that select / move / copy as a unit.
 * A member belongs to at most one group. Snapping to a grouped member from
 * outside works but defers the union until the group is dissolved. */
export const groupSchema = z.object({
  id: idSchema,
  memberIds: z.array(idSchema),
});

/** v8: one end of an elastic band. Either pinned to a node (`{nodeId}`, a pipe
 * END or junction) or a point ALONG a straight member (`{memberId, t}` with
 * `t∈[0,1]` the fraction from the member's nodeA to nodeB). */
export const attachmentSchema = z.union([
  z.object({ nodeId: idSchema }),
  z.object({ memberId: idSchema, t: z.number() }),
]);

/** v8: an elastic band — a spring between two attachment points. In the physics
 * sim it applies an axial spring force pulling the two ends together once the
 * span exceeds `restLengthM` (bands are pre-tensioned, so this is essentially
 * always). `stiffnessNPerM` is the spring constant (real N/m; scaled into the
 * sim). Purely additive/optional to the rest of the document. */
export const elasticSchema = z.object({
  id: idSchema,
  a: attachmentSchema,
  b: attachmentSchema,
  restLengthM: z.number().nonnegative(),
  stiffnessNPerM: z.number().nonnegative(),
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
  /** non-default pipe connections: wrapped/free pivots + intact-run screwed tees */
  joints: z.array(jointSchema),
  /** v6: persistent tape-measure annotations (default []) */
  measurements: z.array(measurementSchema),
  /** v7: member groups (default []) */
  groups: z.array(groupSchema),
  /** v8: elastic bands — springs between two attachment points (default []) */
  elastics: z.array(elasticSchema),
  /** v6: display-only length format (undefined = decimal inches) */
  lengthDisplay: lengthDisplaySchema.optional(),
  /** v6: doc-stored camera + tool state, restored on open */
  viewport: viewportSchema.optional(),
  /** v9: show + collide against a static human mannequin in Play (undefined = off) */
  mannequin: z.boolean().optional(),
  /** v9: global joint/elastic friction-drag multiplier for the sim (undefined = 1) */
  jointDamping: z.number().positive().optional(),
});

export type Node = z.infer<typeof nodeSchema>;
export type StraightMember = z.infer<typeof straightMemberSchema>;
export type FormedMember = z.infer<typeof formedMemberSchema>;
export type Member = z.infer<typeof memberSchema>;
export type JointMode = z.infer<typeof jointModeSchema>;
export type Joint = z.infer<typeof jointSchema>;
export type MeasurementEnd = z.infer<typeof measurementEndSchema>;
export type Measurement = z.infer<typeof measurementSchema>;
export type Group = z.infer<typeof groupSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type Elastic = z.infer<typeof elasticSchema>;
export type CameraPose = z.infer<typeof cameraPoseSchema>;
export type Viewport = z.infer<typeof viewportSchema>;
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
    joints: [],
    measurements: [],
    groups: [],
    elastics: [],
  };
}
