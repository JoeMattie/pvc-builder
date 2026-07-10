import { Canvas } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Scene } from './Scene';
import { trackTouchPointerDown, trackTouchPointerEnd } from './touchGestures';

// The 3D viewport host (planfile §6): orthographic isometric by default,
// one-toggle perspective, free orbit/pan/zoom, an axis-triad gizmo, a ground
// grid, and PBR pipe. All scene contents live in <Scene/>.
export function Viewport() {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.addEventListener('pointerdown', trackTouchPointerDown, true);
    host.addEventListener('pointerup', trackTouchPointerEnd, true);
    host.addEventListener('pointercancel', trackTouchPointerEnd, true);
    return () => {
      host.removeEventListener('pointerdown', trackTouchPointerDown, true);
      host.removeEventListener('pointerup', trackTouchPointerEnd, true);
      host.removeEventListener('pointercancel', trackTouchPointerEnd, true);
    };
  }, []);
  return (
    <div ref={hostRef} className="absolute inset-0 touch-none">
      <Canvas
        // Variance shadows are the supported soft-shadow path in current three.
        shadows="variance"
        dpr={[1, 2]}
        gl={{ antialias: true }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
