import { createEmptyDesign, type Design, migrateToLatest, type UnitsPreference } from '../schema';
import { PvcDb, REVISION_LIMIT } from './db';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
}

export interface ProjectRevisionSummary {
  revId: number;
  projectId: string;
  savedAt: number;
  name: string;
}

/** All persistence goes through this store. Documents are validated (and
 * migrated, if written by an older app version) on every load — the DB is not
 * trusted more than an imported file. */
export class ProjectStore {
  constructor(private readonly db: PvcDb = new PvcDb()) {}

  async listProjects(): Promise<ProjectSummary[]> {
    const rows = await this.db.projects.orderBy('updatedAt').reverse().toArray();
    return rows.map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
  }

  async createProject(
    name: string,
    id: string = crypto.randomUUID(),
    units?: UnitsPreference,
  ): Promise<Design> {
    const doc = createEmptyDesign(id, name);
    if (units) doc.unitsPreference = units;
    await this.saveProject(doc);
    return doc;
  }

  async loadProject(id: string): Promise<Design | undefined> {
    const row = await this.db.projects.get(id);
    if (!row) return undefined;
    return migrateToLatest(row.doc);
  }

  /** Newest revId for a project (undefined if it has no revisions). Captured
   * by the app when a project opens, so undo-into-history can walk only the
   * revisions that predate the session. */
  async latestRevisionId(projectId: string): Promise<number | undefined> {
    const keys = (await this.db.revisions
      .where('projectId')
      .equals(projectId)
      .primaryKeys()) as number[];
    return keys.length > 0 ? Math.max(...keys) : undefined;
  }

  /** Read-only load of one revision's document (migrated, id normalized to the
   * project) — no save side-effects, unlike restoreRevision. */
  async loadRevisionDoc(projectId: string, revId: number): Promise<Design | undefined> {
    const row = await this.db.revisions.get(revId);
    if (!row || row.projectId !== projectId) return undefined;
    return { ...migrateToLatest(row.doc), id: projectId };
  }

  async listRevisions(projectId: string): Promise<ProjectRevisionSummary[]> {
    const rows = await this.db.revisions.where('projectId').equals(projectId).toArray();
    rows.sort((a, b) => (b.revId ?? 0) - (a.revId ?? 0));
    return rows.flatMap((row) =>
      typeof row.revId === 'number'
        ? [
            {
              revId: row.revId,
              projectId: row.projectId,
              savedAt: row.savedAt,
              name: migrateToLatest(row.doc).name,
            },
          ]
        : [],
    );
  }

  /** Persist the document and append a revision, trimming history to
   * REVISION_LIMIT. Used by both explicit saves and autosave. */
  async saveProject(doc: Design): Promise<void> {
    const savedAt = Date.now();
    await this.db.transaction('rw', this.db.projects, this.db.revisions, async () => {
      await this.db.projects.put({ id: doc.id, name: doc.name, updatedAt: savedAt, doc });
      await this.db.revisions.add({ projectId: doc.id, savedAt, doc } as never);
      const revIds = await this.db.revisions.where('projectId').equals(doc.id).sortBy('savedAt');
      const excess = revIds.length - REVISION_LIMIT;
      if (excess > 0) {
        await this.db.revisions.bulkDelete(revIds.slice(0, excess).map((r) => r.revId));
      }
    });
  }

  /** Persist the project row WITHOUT appending a revision. Used when the doc
   * being persisted IS an existing revision (undo stepping through history) —
   * minting a copy per step would spam and roll real history off the
   * REVISION_LIMIT window. */
  async putProject(doc: Design): Promise<void> {
    await this.db.projects.put({ id: doc.id, name: doc.name, updatedAt: Date.now(), doc });
  }

  async renameProject(id: string, name: string): Promise<void> {
    const doc = await this.loadProject(id);
    if (!doc) throw new Error(`no project ${id}`);
    await this.saveProject({ ...doc, name });
  }

  async duplicateProject(id: string, name?: string): Promise<Design> {
    const doc = await this.loadProject(id);
    if (!doc) throw new Error(`no project ${id}`);
    const copy: Design = { ...doc, id: crypto.randomUUID(), name: name ?? `${doc.name} copy` };
    await this.saveProject(copy);
    return copy;
  }

  async restoreRevision(projectId: string, revId: number): Promise<Design> {
    const doc = await this.loadRevisionDoc(projectId, revId);
    if (!doc) throw new Error(`no revision ${revId}`);
    await this.saveProject(doc);
    return doc;
  }

  async deleteProject(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.projects, this.db.revisions, async () => {
      await this.db.projects.delete(id);
      await this.db.revisions.where('projectId').equals(id).delete();
    });
  }

  close(): void {
    this.db.close();
  }
}
