// The heavy postprocessing stack (N8AO + SSAO + SMAA), split into its own lazy
// chunk so `postprocessing` stays out of the main bundle — effects default OFF,
// so most sessions never pay for it. Loaded via React.lazy in Scene.tsx and
// warmed by preloadRendererEffects() from the project list.
import { EffectComposer, N8AO, SMAA, SSAO } from '@react-three/postprocessing';

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
      <SSAO
        samples={18}
        rings={5}
        radius={0.055}
        intensity={9}
        luminanceInfluence={0.25}
        distanceThreshold={0.2}
        distanceFalloff={0.08}
        rangeThreshold={0.42}
        rangeFalloff={0.18}
        bias={0.025}
      />
      <SMAA />
    </EffectComposer>
  );
}
