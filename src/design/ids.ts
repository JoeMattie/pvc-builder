/** Short unique id with a type prefix (e.g. `n-3f2a…` for nodes, `m-…` for
 * members). crypto.randomUUID is available in the browser and Node ≥ 19. */
export function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}
