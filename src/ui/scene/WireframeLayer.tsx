// Wireframe view: every pipe drawn as a 5px fat line and every junction as a
// 14px round dot. Replaces the solid pipe/fitting/joint layers while active (a
// diagnostic "skeleton" view). Fat lines need Line2/LineMaterial (raw GL_LINES
// caps at 1px), which drei's <Segments> batches into a single draw call.
import { Segment, Segments } from '@react-three/drei';
import { useMemo } from 'react';
import { CanvasTexture } from 'three';
import { groupColorOf, memberGroupKey, nodeById } from '../../design/docOps';
import type { Vec3 } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { formedCurve } from './FormedLayer';

const SELECT_BLUE = '#2a78d6';
const LINE_PX = 5;
const DOT_PX = 14;
/** Formed pipes are sampled into this many segments for the wireframe chord. */
const FORMED_SEGS = 20;

/** A soft round alpha texture so PointsMaterial dots render as circles, not
 * squares. Built once. */
function useDotTexture(): CanvasTexture {
  return useMemo(() => {
    const s = 64;
    const cv = document.createElement('canvas');
    cv.width = s;
    cv.height = s;
    const ctx = cv.getContext('2d')!;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    const tex = new CanvasTexture(cv);
    tex.needsUpdate = true;
    return tex;
  }, []);
}

export function WireframeLayer() {
  const wireframe = useEditorStore((s) => s.wireframe);
  const design = useAppStore((s) => s.current);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const night = useThemeStore((s) => s.night);
  const dotTex = useDotTexture();

  const fg = night ? '#e8eaf0' : '#1a1d24';

  // segment list (each pipe → one or more coloured segments) + node dot buffer
  const { segments, dots } = useMemo(() => {
    const segs: { a: Vec3; b: Vec3; color: string }[] = [];
    const dotArr: number[] = [];
    if (!design) return { segments: segs, dots: new Float32Array(0) };
    const selected = new Set(selectedIds);
    const at = (id: string): Vec3 | undefined => nodeById(design, id)?.position;
    const colorOf = (memberId: string): string => {
      if (selected.has(memberId)) return SELECT_BLUE;
      const gk = memberGroupKey(design, memberId);
      return gk ? groupColorOf(design, gk) : fg;
    };
    for (const m of design.members) {
      const color = colorOf(m.id);
      if (m.kind === 'straight') {
        const a = at(m.nodeA);
        const b = at(m.nodeB);
        if (a && b) segs.push({ a, b, color });
      } else {
        const curve = formedCurve(m, at);
        if (!curve) continue;
        const pts = curve.getPoints(FORMED_SEGS);
        for (let i = 0; i < pts.length - 1; i++) {
          const p = pts[i]!;
          const q = pts[i + 1]!;
          segs.push({ a: { x: p.x, y: p.y, z: p.z }, b: { x: q.x, y: q.y, z: q.z }, color });
        }
      }
    }
    for (const n of design.nodes) dotArr.push(n.position.x, n.position.y, n.position.z);
    return { segments: segs, dots: new Float32Array(dotArr) };
  }, [design, selectedIds, fg]);

  if (!wireframe || !design || segments.length === 0) return null;

  return (
    <group>
      <Segments lineWidth={LINE_PX} limit={Math.max(segments.length, 1)}>
        {segments.map((s, i) => (
          <Segment
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional, order is stable per render
            key={i}
            start={[s.a.x, s.a.y, s.a.z]}
            end={[s.b.x, s.b.y, s.b.z]}
            color={s.color}
          />
        ))}
      </Segments>
      <NodeDots dots={dots} tex={dotTex} color={fg} />
    </group>
  );
}

/** Junction dots as one Points draw call: pixel-sized (no distance attenuation),
 * round via the alpha texture. */
function NodeDots({ dots, tex, color }: { dots: Float32Array; tex: CanvasTexture; color: string }) {
  if (dots.length === 0) return null;
  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[dots, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={DOT_PX}
        sizeAttenuation={false}
        map={tex}
        alphaMap={tex}
        transparent
        depthWrite={false}
        color={color}
      />
    </points>
  );
}
