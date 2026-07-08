// Renders formed (heat-bent) pipe as a smooth swept tube along a Catmull-Rom
// spline through nodeA → control points → nodeB (planfile §6), at true OD.
// Endpoints use eased render positions so the tube glides with the design.
import type { ThreeEvent } from '@react-three/fiber';
import { CatmullRomCurve3, Vector3 } from 'three';
import { nodeById } from '../../design/docOps';
import { type FormedMember, pipeSpec, type Vec3 } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { selectMember } from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';

const toV3 = (p: Vec3) => new Vector3(p.x, p.y, p.z);

/** Catmull-Rom curve through a formed member's eased points, or null. */
export function formedCurve(
  member: FormedMember,
  at: (id: string) => Vec3 | undefined,
): CatmullRomCurve3 | null {
  const a = at(member.nodeA);
  const b = at(member.nodeB);
  if (!a || !b) return null;
  const pts = [a, ...member.controlPoints, b].map(toV3);
  return new CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
}

export function FormedLayer() {
  useAnim((s) => s.v);
  const design = useAppStore((s) => s.current);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const tool = useEditorStore((s) => s.tool);
  const night = useThemeStore((s) => s.night);
  if (!design) return null;
  const formed = design.members.filter((m): m is FormedMember => m.kind === 'formed');
  if (!formed.length) return null;

  const color = scenePalette(night).pvc;
  const selected = new Set(selectedIds);
  const onSelect = tool === 'select' ? selectMember : undefined;
  const at = (id: string): Vec3 | undefined => easedPos(id) ?? nodeById(design, id)?.position;

  return (
    <>
      {formed.map((m) => {
        const curve = formedCurve(m, at);
        if (!curve) return null;
        const r = pipeSpec(m.size).odM / 2;
        const segs = Math.max(24, (m.controlPoints.length + 1) * 20);
        const isSel = selected.has(m.id);
        const click = onSelect
          ? (e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              onSelect(m.id);
            }
          : undefined;
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: r3f <mesh> is a three.js scene node, not a DOM element
          <mesh key={m.id} onClick={click} castShadow receiveShadow>
            <tubeGeometry args={[curve, segs, r, 14, false]} />
            <meshPhysicalMaterial
              color={color}
              roughness={0.38}
              metalness={0}
              clearcoat={0.6}
              clearcoatRoughness={0.35}
              emissive={isSel ? '#2a78d6' : '#000000'}
              emissiveIntensity={isSel ? 0.35 : 0}
            />
          </mesh>
        );
      })}
    </>
  );
}
