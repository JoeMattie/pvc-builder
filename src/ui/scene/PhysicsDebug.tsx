// Dev overlay: the crashcat/three debug renderer draws the live physics world —
// every rigid body (wireframe) plus the pivot/weld CONSTRAINTS with their limits
// — batched, straight from `crashcat/three`. Gated on the `physicsDebug` toggle
// AND an active sim. The physics world runs in a ×PHYSICS_SCALE coordinate space,
// so the whole overlay group is scaled back by 1/PHYSICS_SCALE to line up with the
// rendered pipes. Update runs a frame behind the step (imperceptible for a dev
// overlay). See DECISIONS: instancing/physics passes.
import { useFrame, useThree } from '@react-three/fiber';
import { debugRenderer } from 'crashcat/three';
import { useEffect, useRef } from 'react';
import { PHYSICS_SCALE, physicsWorld } from '../../solver/physics';
import { useEditorStore } from '../../state/editorStore';

export function PhysicsDebug() {
  const debug = useEditorStore((s) => s.physicsDebug);
  const simulating = useEditorStore((s) => s.simulating);
  const scene = useThree((s) => s.scene);
  const stateRef = useRef<ReturnType<typeof debugRenderer.init> | null>(null);

  useEffect(() => {
    if (!debug || !simulating) return;
    const options = debugRenderer.createDefaultOptions();
    options.bodies.enabled = true;
    options.bodies.wireframe = true; // overlay, don't occlude the real pipes
    options.bodies.color = debugRenderer.BodyColorMode.MOTION_TYPE;
    options.constraints.enabled = true;
    options.constraints.drawLimits = true;
    options.constraints.size = 0.15 * PHYSICS_SCALE; // sized in the scaled world
    const state = debugRenderer.init(options);
    state.object3d.scale.setScalar(1 / PHYSICS_SCALE);
    scene.add(state.object3d);
    stateRef.current = state;
    return () => {
      scene.remove(state.object3d);
      debugRenderer.dispose(state);
      stateRef.current = null;
    };
  }, [debug, simulating, scene]);

  useFrame(() => {
    const world = physicsWorld();
    if (stateRef.current && world) debugRenderer.update(stateRef.current, world);
  });

  return null;
}
