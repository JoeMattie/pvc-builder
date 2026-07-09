// Placed construction guide lines (the Q tool) — long dashed axis-coloured
// lines that persist across tools as snapping aids. Transient (editor state),
// never in the document.
import { Line } from '@react-three/drei';
import { guideDrawSpan } from '../../design/guides';
import { useEditorStore } from '../../state/editorStore';

const AXIS_COLOR = { x: '#d64545', y: '#3d9950', z: '#2a78d6' } as const;

function axisOf(dir: { x: number; y: number; z: number }): 'x' | 'y' | 'z' {
  const ax = Math.abs(dir.x);
  const ay = Math.abs(dir.y);
  const az = Math.abs(dir.z);
  if (ax >= ay && ax >= az) return 'x';
  return ay >= az ? 'y' : 'z';
}

export function GuideLayer() {
  const guides = useEditorStore((s) => s.guides);
  if (!guides.length) return null;
  return (
    <group>
      {guides.map((g) => {
        const [a, b] = guideDrawSpan(g);
        return (
          <Line
            key={g.id}
            points={[
              [a.x, a.y, a.z],
              [b.x, b.y, b.z],
            ]}
            color={AXIS_COLOR[axisOf(g.dir)]}
            lineWidth={1}
            dashed
            dashSize={0.05}
            gapSize={0.045}
            transparent
            opacity={0.55}
          />
        );
      })}
    </group>
  );
}
