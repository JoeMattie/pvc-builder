import { Html, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useRef, useState } from 'react';
import { nodeById } from '../../design/docOps';
import type { SnapResult } from '../../design/snapping';
import { length, sub } from '../../geometry/math3';
import { pipeSpec } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { clearSelection, placeDrawPoint, snapDrawPoint } from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { formatLength } from '../units';
import { placeAxis } from './axis';
import { rayToGround } from './ground';

// A click and an orbit-drag both start with a pointerdown on the ground; only
// treat a pointerup as a "click" if the pointer barely moved.
const CLICK_SLOP_PX = 6;

const AXIS_COLOR = { x: '#d64545', y: '#3d9950', z: '#2a78d6' } as const;

export function DrawController() {
  const tool = useEditorStore((s) => s.tool);
  const drawSize = useEditorStore((s) => s.drawSize);
  const drawingFromNodeId = useEditorStore((s) => s.drawingFromNodeId);
  const design = useAppStore((s) => s.current);
  const night = useThemeStore((s) => s.night);
  const [preview, setPreview] = useState<SnapResult | null>(null);
  const down = useRef<{ x: number; y: number } | null>(null);

  const fromPos =
    design && drawingFromNodeId ? nodeById(design, drawingFromNodeId)?.position : undefined;
  const odR = pipeSpec(drawSize).odM / 2;
  const units = design?.unitsPreference ?? 'imperial';

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (tool !== 'draw') return;
    const g = rayToGround(e.ray);
    if (g) setPreview(snapDrawPoint(g));
  };

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    down.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
  };

  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const d = down.current;
    down.current = null;
    if (!d) return;
    const moved = Math.hypot(e.nativeEvent.clientX - d.x, e.nativeEvent.clientY - d.y);
    if (moved > CLICK_SLOP_PX) return; // an orbit drag, not a place-point click
    const g = rayToGround(e.ray);
    if (!g) return;
    if (tool === 'draw') setPreview(placeDrawPoint(g));
    else clearSelection();
  };

  const showPreview = tool === 'draw' && preview;
  const p = preview?.position;
  const guide = preview?.guide;
  const segLen = fromPos && p ? length(sub(p, fromPos)) : 0;
  const ghost = fromPos && p ? placeAxis(fromPos, p) : null;

  return (
    <>
      {/* full-bleed ground plane: catches shadows and is the pointer target */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerUp={onUp}
      >
        <planeGeometry args={[200, 200]} />
        <shadowMaterial transparent opacity={night ? 0.35 : 0.2} />
      </mesh>

      {showPreview && p && (
        <>
          {/* pen marker */}
          <mesh position={[p.x, p.y, p.z]}>
            <sphereGeometry args={[Math.max(odR * 1.2, 0.012), 16, 12]} />
            <meshBasicMaterial color="#2a78d6" transparent opacity={0.85} />
          </mesh>

          {/* ghost of the segment about to be drawn + its length label */}
          {ghost && (
            <>
              <mesh position={ghost.mid} quaternion={ghost.quat}>
                <cylinderGeometry args={[odR, odR, ghost.len, 16]} />
                <meshStandardMaterial color="#2a78d6" transparent opacity={0.3} roughness={0.5} />
              </mesh>
              {/* fixed screen-size label pinned to the segment midpoint — NO
                  distanceFactor, so it stays readable at any zoom (that scale
                  makes it balloon when zoomed in) */}
              <Html
                position={[ghost.mid.x, ghost.mid.y, ghost.mid.z]}
                center
                zIndexRange={[100, 0]}
              >
                <div
                  style={{
                    padding: '2px 6px',
                    borderRadius: 6,
                    font: "500 12px 'IBM Plex Mono', monospace",
                    background: night ? '#1e2128' : '#fff',
                    color: night ? '#e8eaf0' : '#1a1d24',
                    border: `1px solid ${night ? '#33363f' : '#e4e4e7'}`,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    transform: 'translateY(-14px)',
                  }}
                >
                  {formatLength(segLen, units)}
                </div>
              </Html>
            </>
          )}

          {/* axis inference guide */}
          {guide && (
            <Line
              points={[
                [guide.from.x, guide.from.y, guide.from.z] as [number, number, number],
                [guide.to.x, guide.to.y, guide.to.z] as [number, number, number],
              ]}
              color={AXIS_COLOR[guide.axis]}
              lineWidth={1.5}
              dashed
              dashSize={0.03}
              gapSize={0.02}
            />
          )}
        </>
      )}
    </>
  );
}
