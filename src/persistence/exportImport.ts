import { type Design, designSchema, migrateToLatest } from '../schema';

/** Serialize a design for file export. Validates on the way out so a bug can't
 * write an unloadable file. */
export function exportDesignJson(doc: Design): string {
  return JSON.stringify(designSchema.parse(doc), null, 2);
}

/** Parse an exported file: JSON → migrate (old versions welcome) → validate. */
export function importDesignJson(text: string): Design {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('not a JSON file');
  }
  return migrateToLatest(raw);
}

/** `<slug>.pvc.json` (planfile §7). */
export function suggestedFileName(doc: Design): string {
  const slug = doc.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'design'}.pvc.json`;
}
