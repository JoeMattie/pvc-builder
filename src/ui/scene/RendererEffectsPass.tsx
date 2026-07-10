// The heavy postprocessing stack (N8AO + screen-space cavity + SMAA), split into
// its own lazy chunk so `postprocessing` stays out of the main bundle — effects
// default OFF, so most sessions never pay for it. Loaded via React.lazy in
// Scene.tsx and warmed by preloadRendererEffects() from the project list.
import { EffectComposer, EffectComposerContext, N8AO, SMAA } from '@react-three/postprocessing';
import type { NormalPass } from 'postprocessing';
import { useContext, useEffect, useMemo } from 'react';
import type { Material, Mesh, Object3D, Scene } from 'three';
import { CavityEffect } from './cavityEffect';

interface CavityProps {
  ridge?: number;
  valley?: number;
  offset?: number;
}

// The normal pass renders the scene with an override MeshNormalMaterial, which
// ignores transparency — invisible helpers (the 200 m pointer-target/shadow
// catcher, the grid, drag ghosts) become SOLID surfaces in the normal buffer and
// the cavity outlines them as phantom planes. Blender's cavity only samples
// opaque geometry; mirror that by hiding transparent materials for the pass.
function useOpaqueOnlyNormalPass(normalPass: NormalPass | null, scene: Scene) {
  useEffect(() => {
    if (!normalPass) return;
    const original = normalPass.render.bind(normalPass);
    normalPass.render = (...args: Parameters<NormalPass['render']>) => {
      const hidden: Object3D[] = [];
      scene.traverse((obj) => {
        if (!obj.visible) return;
        const material = (obj as Mesh).material as Material | Material[] | undefined;
        if (!material) return;
        const transparent = Array.isArray(material)
          ? material.some((m) => m.transparent)
          : material.transparent;
        if (transparent) {
          obj.visible = false;
          hidden.push(obj);
        }
      });
      original(...args);
      for (const obj of hidden) obj.visible = true;
    };
    return () => {
      normalPass.render = original;
    };
  }, [normalPass, scene]);
}

// Blender Workbench "cavity" (screen-space curvature): ridges brighten, valleys
// darken, driven by the composer's normal pass. See cavityEffect.ts.
function Cavity({ ridge, valley, offset }: CavityProps) {
  const { normalPass, scene } = useContext(EffectComposerContext);
  useOpaqueOnlyNormalPass(normalPass, scene);
  const effect = useMemo(() => {
    if (normalPass === null) {
      console.error('Cavity requires the EffectComposer normal pass (enableNormalPass).');
    }
    return new CavityEffect({ normalBuffer: normalPass?.texture ?? null, ridge, valley, offset });
  }, [normalPass, ridge, valley, offset]);
  useEffect(() => () => effect.dispose(), [effect]);
  return <primitive object={effect} dispose={null} />;
}

export default function RendererEffectsPass() {
  return (
    <EffectComposer multisampling={0} resolutionScale={1} depthBuffer enableNormalPass>
      <N8AO
        aoRadius={0.28}
        distanceFalloff={0.72}
        intensity={2.35}
        quality="high"
        aoSamples={16}
        denoiseSamples={8}
        denoiseRadius={8}
        depthAwareUpsampling
      />
      <Cavity ridge={1.0} valley={1.0} offset={1.0} />
      <SMAA />
    </EffectComposer>
  );
}
