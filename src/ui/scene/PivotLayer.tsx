// Renders heat-formed pivots as a small hinge glyph along the pivot axis, and —
// while the pivot tool is active — clickable markers on every eligible junction
// (a 2-member node) to create one.
import type { ThreeEvent } from '@react-three/fiber';
import { canPivot, nodeById } from '../../design/docOps';
import type { Vec3 } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { createPivotAt } from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { orientY } from './axis';

export function PivotLayer() {
  useAnim((s) => s.v);
  const design = useAppStore((s) => s.current);
  const tool = useEditorStore((s) => s.tool);
  const night = useThemeStore((s) => s.night);
  if (!design) return null;
  const accent = scenePalette(night).accent;
  const at = (id: string): Vec3 | undefined => easedPos(id) ?? nodeById(design, id)?.position;

  return (
    <>
      {design.pivots.map((pv) => {
        const p = at(pv.nodeId);
        if (!p) return null;
        return (
          <mesh key={pv.id} position={[p.x, p.y, p.z]} quaternion={orientY(pv.axis)}>
            <cylinderGeometry args={[0.017, 0.017, 0.055, 18]} />
            <meshStandardMaterial color={accent} roughness={0.4} metalness={0.1} />
          </mesh>
        );
      })}

      {tool === 'pivot' &&
        design.nodes
          .filter((n) => canPivot(design, n.id))
          .map((n) => {
            const p = at(n.id);
            if (!p) return null;
            const click = (e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              createPivotAt(n.id);
            };
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: r3f <mesh> is a three.js scene node, not a DOM element
              <mesh key={n.id} position={[p.x, p.y, p.z]} onClick={click}>
                <sphereGeometry args={[0.022, 16, 12]} />
                <meshBasicMaterial color={accent} transparent opacity={0.55} />
              </mesh>
            );
          })}
    </>
  );
}
