import { type Design, designSchema, SCHEMA_VERSION } from './design';

/** Migration from version N to N+1. Operates on plain JSON — never import app
 * code here; old documents must migrate forever (planfile §3). Copied runner
 * pattern from riglab. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version the migration upgrades FROM; every SCHEMA_VERSION bump
 * adds an entry (enforced by migrations.test). */
export const migrations: Record<number, Migration> = {
  // v1 → v2: added the `formed` member variant. Existing v1 documents (straight
  // members only) are already valid v2 documents — stamp only.
  1: (doc) => doc,
  // v2 → v3: added `pivots` (revolute joints); old docs get an empty array.
  2: (doc) => ({ ...doc, pivots: Array.isArray(doc.pivots) ? doc.pivots : [] }),
  // v3 → v4: added `wraps` (heat-wrapped tees); old docs get an empty array.
  3: (doc) => ({ ...doc, wraps: Array.isArray(doc.wraps) ? doc.wraps : [] }),
  // v4 → v5: fold `pivots` + `wraps` into a single `joints` array.
  //   • pivot {nodeId, memberA, memberB, angleRad, limits}
  //       → joint {receiver: memberA, mover: memberB, onBody:false, mode:'wrapped'}
  //         (old pivots were end-to-end revolute joints, already drawn as a wrap
  //          collar; the axis is now derived from the receiver, so it's dropped)
  //   • wrap {throughMember, branchNode, rigid, angleRad}
  //       → joint {receiver: throughMember, mover:<branch member>, onBody:true,
  //         mode: rigid ? 'anchor' : 'wrapped'} (an intact-run screwed tee or swivel)
  4: (doc) => {
    const members = Array.isArray(doc.members) ? (doc.members as Record<string, unknown>[]) : [];
    const oldPivots = Array.isArray(doc.pivots) ? (doc.pivots as Record<string, unknown>[]) : [];
    const oldWraps = Array.isArray(doc.wraps) ? (doc.wraps as Record<string, unknown>[]) : [];
    const joints: Record<string, unknown>[] = [];

    for (const p of oldPivots) {
      joints.push({
        id: p.id,
        nodeId: p.nodeId,
        receiver: p.memberA,
        mover: p.memberB,
        onBody: false,
        mode: 'wrapped',
        ...(typeof p.angleRad === 'number' ? { angleRad: p.angleRad } : {}),
        ...(p.limits && typeof p.limits === 'object' ? { limits: p.limits } : {}),
      });
    }

    for (const w of oldWraps) {
      // the branch is the member ending at branchNode that ISN'T the through run
      const branch = members.find(
        (m) => m.id !== w.throughMember && (m.nodeA === w.branchNode || m.nodeB === w.branchNode),
      );
      if (!branch) continue; // can't reconstruct the mover → drop the orphaned wrap
      joints.push({
        id: w.id,
        nodeId: w.branchNode,
        receiver: w.throughMember,
        mover: branch.id,
        onBody: true,
        mode: w.rigid ? 'anchor' : 'wrapped',
        ...(typeof w.angleRad === 'number' ? { angleRad: w.angleRad } : {}),
      });
    }

    const { pivots: _pivots, wraps: _wraps, ...rest } = doc;
    return { ...rest, joints };
  },
  // v5 → v6: doc-stored UI state + persistent measurements. Only `measurements`
  // is required by the schema; give old docs an empty array. `viewport`,
  // `lengthDisplay`, and `joint.manufactured` are optional → nothing to add.
  5: (doc) => ({
    ...doc,
    measurements: Array.isArray(doc.measurements) ? doc.measurements : [],
  }),
  // v6 → v7: added member `groups`; old docs get an empty array.
  6: (doc) => ({ ...doc, groups: Array.isArray(doc.groups) ? doc.groups : [] }),
  // v7 → v8: added `elastics` (spring bands); old docs get an empty array.
  7: (doc) => ({ ...doc, elastics: Array.isArray(doc.elastics) ? doc.elastics : [] }),
  // v8 → v9: added optional `mannequin` + `jointDamping`. Both optional → an old
  // doc is already a valid v9 doc; stamp only.
  8: (doc) => doc,
  // v9 → v10: added optional `group.color`. Optional → an old doc is already a
  // valid v10 doc; stamp only.
  9: (doc) => doc,
};

export class MigrationError extends Error {}

/** Heal referential-integrity corruption that Zod can't catch (ids are just
 * strings, so a member pointing at a deleted node still validates). Runs on
 * EVERY load — DB and import — after the version migrations. Pure JSON, no app
 * imports (same rule as the migrations), so it stays version-agnostic forever.
 *
 * Drops any member whose endpoint node no longer exists, then cascades: joints,
 * elastics, groups, and measurements that reference a removed member/node are
 * pruned too (mirroring `deleteMember`'s own cascade). Idempotent on clean
 * documents. */
export function healIntegrity(doc: Record<string, unknown>): Record<string, unknown> {
  const nodes = Array.isArray(doc.nodes) ? (doc.nodes as Record<string, unknown>[]) : null;
  const members = Array.isArray(doc.members) ? (doc.members as Record<string, unknown>[]) : null;
  if (!nodes || !members) return doc;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const keptMembers = members.filter((m) => nodeIds.has(m.nodeA) && nodeIds.has(m.nodeB));
  if (keptMembers.length === members.length) return doc; // nothing dangling → no-op

  const memberIds = new Set(keptMembers.map((m) => m.id));
  const out: Record<string, unknown> = { ...doc, members: keptMembers };

  if (Array.isArray(doc.joints)) {
    out.joints = (doc.joints as Record<string, unknown>[]).filter(
      (j) => memberIds.has(j.receiver) && memberIds.has(j.mover) && nodeIds.has(j.nodeId),
    );
  }
  const attachAlive = (att: unknown): boolean => {
    if (!att || typeof att !== 'object') return false;
    const a = att as Record<string, unknown>;
    return 'nodeId' in a ? nodeIds.has(a.nodeId) : memberIds.has(a.memberId);
  };
  if (Array.isArray(doc.elastics)) {
    out.elastics = (doc.elastics as Record<string, unknown>[]).filter(
      (e) => attachAlive(e.a) && attachAlive(e.b),
    );
  }
  if (Array.isArray(doc.groups)) {
    out.groups = (doc.groups as Record<string, unknown>[])
      .map((g) => ({
        ...g,
        memberIds: (Array.isArray(g.memberIds) ? g.memberIds : []).filter((id) =>
          memberIds.has(id),
        ),
      }))
      .filter((g) => (g.memberIds as unknown[]).length > 0);
  }
  const endAlive = (end: unknown): boolean => {
    if (!end || typeof end !== 'object') return false;
    const e = end as Record<string, unknown>;
    return 'nodeId' in e ? nodeIds.has(e.nodeId) : true; // a free {position} end is fine
  };
  if (Array.isArray(doc.measurements)) {
    out.measurements = (doc.measurements as Record<string, unknown>[]).filter(
      (m) => endAlive(m.a) && endAlive(m.b),
    );
  }
  return out;
}

/** Run the migration chain from `from` (exclusive of `to`), stamping the new
 * schemaVersion after each step. Exported so chaining/stamping/missing-step
 * behavior stays testable while the registry is still empty. */
export function applyMigrations(
  doc: Record<string, unknown>,
  from: number,
  to: number,
  registry: Record<number, Migration>,
): Record<string, unknown> {
  let out = doc;
  for (let v = from; v < to; v++) {
    const step = registry[v];
    if (!step) throw new MigrationError(`no migration from schemaVersion ${v}`);
    out = { ...step(out), schemaVersion: v + 1 };
  }
  return out;
}

/** Upgrade an arbitrary parsed JSON document to the current schema and
 * validate it. Accepts documents written by any released schema version. */
export function migrateToLatest(
  raw: unknown,
  registry: Record<number, Migration> = migrations,
): Design {
  if (typeof raw !== 'object' || raw === null) {
    throw new MigrationError('design file is not an object');
  }
  let doc = raw as Record<string, unknown>;
  const version = doc.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new MigrationError(`invalid schemaVersion: ${String(version)}`);
  }
  if (version > SCHEMA_VERSION) {
    throw new MigrationError(
      `design was written by a newer app (schemaVersion ${version} > ${SCHEMA_VERSION})`,
    );
  }
  doc = applyMigrations(doc, version, SCHEMA_VERSION, registry);
  doc = healIntegrity(doc);
  const parsed = designSchema.safeParse(doc);
  if (!parsed.success) {
    throw new MigrationError(`design failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}
