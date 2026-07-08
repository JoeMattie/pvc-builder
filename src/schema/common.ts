import { z } from 'zod';

// All stored quantities are SI: metres, radians (planfile §3). Unit conversion
// happens at the UI boundary only (src/ui/units.ts).

export const idSchema = z.string().min(1);

export const vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });
export const quaternionSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  w: z.number(),
});

export const unitsPreferenceSchema = z.enum(['imperial', 'metric']);

/** Display-only length format (schema v6). Independent of `unitsPreference`
 * (which still drives mass): only changes how lengths are shown/typed, never
 * what is stored (always SI metres). Default is decimal inches. */
export const lengthDisplaySchema = z.enum(['mm', 'cm', 'in', 'in-frac']);

/** The two nominal pipe sizes v1 supports (planfile §1, non-goals: no other
 * sizes). The dimensional data for each lives in the PipeSpec table
 * (src/schema/pipeSpec.ts), not in the document. */
export const nominalSizeSchema = z.enum(['1/2"', '3/4"']);

export type Vec3 = z.infer<typeof vec3Schema>;
export type Quaternion = z.infer<typeof quaternionSchema>;
export type UnitsPreference = z.infer<typeof unitsPreferenceSchema>;
export type LengthDisplay = z.infer<typeof lengthDisplaySchema>;
export type NominalSize = z.infer<typeof nominalSizeSchema>;
