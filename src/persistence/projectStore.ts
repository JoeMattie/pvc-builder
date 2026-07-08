import { createEmptyDesign, type Design, migrateToLatest, type UnitsPreference } from '../schema';
import { PvcDb, REVISION_LIMIT } from './db';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
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

  async renameProject(id: string, name: string): Promise<void> {
    const doc = await this.loadProject(id);
    if (!doc) throw new Error(`no project ${id}`);
    await this.saveProject({ ...doc, name });
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
