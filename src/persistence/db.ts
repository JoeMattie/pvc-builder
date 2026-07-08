import Dexie, { type EntityTable } from 'dexie';
import type { Design } from '../schema';

/** Rolling revision history kept per project. */
export const REVISION_LIMIT = 20;

export interface ProjectRow {
  id: string;
  name: string;
  updatedAt: number;
  doc: Design;
}

export interface RevisionRow {
  revId: number;
  projectId: string;
  savedAt: number;
  doc: Design;
}

export class PvcDb extends Dexie {
  projects!: EntityTable<ProjectRow, 'id'>;
  revisions!: EntityTable<RevisionRow, 'revId'>;

  constructor(name = 'pvc-builder') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt',
      revisions: '++revId, projectId, savedAt',
    });
  }
}
