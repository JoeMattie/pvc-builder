// Blender Workbench-style screen-space cavity (curvature ridge/valley) effect.
// Port of Blender's workbench_effect_cavity.glsl (patch D3617): sample the
// view-space normal buffer at 4 texel offsets, difference the x/y components,
// soft-clamp, and multiply the color by (1 + curvature) so ridges brighten and
// valleys darken. Pure `postprocessing` Effect — no React in this module; the
// R3F wiring (normal-pass texture) lives in RendererEffectsPass.tsx.
import { Effect } from 'postprocessing';
import type { Texture } from 'three';
import { Uniform } from 'three';

const fragmentShader = /* glsl */ `
  uniform sampler2D normalBuffer;
  uniform float ridge;
  uniform float valley;
  uniform float sampleOffset;

  float curvatureSoftClamp(const in float curvature, const in float control) {
    if (curvature < 0.5 / control) {
      return curvature * (1.0 - curvature * control);
    }
    return 0.25 / control;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 offset = texelSize * sampleOffset;
    float normalUp = texture2D(normalBuffer, uv + vec2(0.0, offset.y)).g;
    float normalDown = texture2D(normalBuffer, uv - vec2(0.0, offset.y)).g;
    float normalRight = texture2D(normalBuffer, uv + vec2(offset.x, 0.0)).r;
    float normalLeft = texture2D(normalBuffer, uv - vec2(offset.x, 0.0)).r;
    // The normal pass packs view-space normals as n * 0.5 + 0.5; the bias
    // cancels in the differences, leaving a decode factor of 2.
    float normalDiff = ((normalUp - normalDown) + (normalRight - normalLeft)) * 2.0;
    float curvature = normalDiff < 0.0
      ? -2.0 * curvatureSoftClamp(-normalDiff, valley)
      : 2.0 * curvatureSoftClamp(normalDiff, ridge);
    outputColor = vec4(inputColor.rgb * (1.0 + curvature), inputColor.a);
  }
`;

// Blender converts the UI factors (0..2) into the shader's clamp controls:
// ridge = 0.5 / max(f^2, 1e-4), valley = 0.7 / max(f^2, 1e-4). Smaller control
// means a stronger maximum effect (max |curvature| = 0.5 / control).
const ridgeControl = (factor: number) => 0.5 / Math.max(factor * factor, 1e-4);
const valleyControl = (factor: number) => 0.7 / Math.max(factor * factor, 1e-4);

export interface CavityEffectOptions {
  /** View-space normal buffer (the composer's NormalPass texture). */
  normalBuffer?: Texture | null;
  /** Ridge (brighten) strength, Blender UI scale 0..2. */
  ridge?: number;
  /** Valley (darken) strength, Blender UI scale 0..2. */
  valley?: number;
  /** Normal-buffer sampling offset in texels (Blender uses 1). */
  offset?: number;
}

export class CavityEffect extends Effect {
  constructor({
    normalBuffer = null,
    ridge = 1.0,
    valley = 1.0,
    offset = 1.0,
  }: CavityEffectOptions = {}) {
    super('CavityEffect', fragmentShader, {
      uniforms: new Map<string, Uniform>([
        ['normalBuffer', new Uniform(normalBuffer)],
        ['ridge', new Uniform(ridgeControl(ridge))],
        ['valley', new Uniform(valleyControl(valley))],
        ['sampleOffset', new Uniform(offset)],
      ]),
    });
  }

  set normalBuffer(value: Texture | null) {
    const uniform = this.uniforms.get('normalBuffer');
    if (uniform) uniform.value = value;
  }

  /** Ridge strength on Blender's 0..2 UI scale. */
  set ridge(factor: number) {
    const uniform = this.uniforms.get('ridge');
    if (uniform) uniform.value = ridgeControl(factor);
  }

  /** Valley strength on Blender's 0..2 UI scale. */
  set valley(factor: number) {
    const uniform = this.uniforms.get('valley');
    if (uniform) uniform.value = valleyControl(factor);
  }

  /** Sampling offset in texels. */
  set offset(texels: number) {
    const uniform = this.uniforms.get('sampleOffset');
    if (uniform) uniform.value = texels;
  }
}
