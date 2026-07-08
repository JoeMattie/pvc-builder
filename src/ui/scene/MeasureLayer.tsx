// Renders persistent tape measures (schema v6 `measurements`): a dimension line
// offset perpendicular from the measured span, extension lines back to the two
// measured points, end ticks, and a length label in the current display units.
// Selectable (click the label) → highlighted; Delete removes it (EditorShell).
import { Html, Line } from '@react-three/drei';
import { measurementLengthM, measurePerp, nodeById } from '../../design/docOps';
import { add, scale, sub } from '../../geometry/math3';
import type { Measurement, Vec3 } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { formatLengthDisplay } from '../units';

const DIM_COLOR = '#e08a00';
const SELECT_BLUE = '#2a78d6';
const P = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

function OneMeasure({ m, selected }: { m: Measurement; selected: boolean }) {
  const design = useAppStore.getState().current;
  if (!design) return null;
  // node-pinned ends track the (eased) node; free ends are stored points
  const endPos = (e: Measurement['a']): Vec3 | undefined =>
    'nodeId' in e ? (easedPos(e.nodeId) ?? nodeById(design, e.nodeId)?.position) : e.position;
  const a = endPos(m.a);
  const b = endPos(m.b);
  if (!a || !b) return null;

  const perp = measurePerp(a, b);
  const off = scale(perp, m.offsetM);
  const a2 = add(a, off);
  const b2 = add(b, off);
  const mid = { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2, z: (a2.z + b2.z) / 2 };
  const tick = scale(perp, 0.02);
  const color = selected ? SELECT_BLUE : DIM_COLOR;
  const units = design.lengthDisplay;
  const select = () => useEditorStore.getState().selectMeasurement(m.id);

  return (
    <group>
      {/* dimension line */}
      <Line points={[P(a2), P(b2)]} color={color} lineWidth={selected ? 2.5 : 1.75} />
      {/* extension lines from the measured points out to the dimension line */}
      {m.offsetM !== 0 && (
        <>
          <Line points={[P(a), P(a2)]} color={color} lineWidth={1} opacity={0.6} transparent />
          <Line points={[P(b), P(b2)]} color={color} lineWidth={1} opacity={0.6} transparent />
        </>
      )}
      {/* end ticks */}
      <Line points={[P(sub(a2, tick)), P(add(a2, tick))]} color={color} lineWidth={1.75} />
      <Line points={[P(sub(b2, tick)), P(add(b2, tick))]} color={color} lineWidth={1.75} />
      {/* length label (click to select) */}
      <Html position={P(mid)} center zIndexRange={[90, 0]}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            select();
          }}
          style={{
            padding: '1px 6px',
            borderRadius: 6,
            font: "600 11px 'IBM Plex Mono', monospace",
            background: color,
            color: '#fff',
            border: 'none',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
        >
          {formatLengthDisplay(measurementLengthM(design, m), units)}
        </button>
      </Html>
    </group>
  );
}

export function MeasureLayer() {
  useAnim((s) => s.v); // track eased node positions
  useThemeStore((s) => s.night);
  const measurements = useAppStore((s) => s.current?.measurements);
  const selectedId = useEditorStore((s) => s.selectedMeasurementId);
  if (!measurements || measurements.length === 0) return null;
  return (
    <>
      {measurements.map((m) => (
        <OneMeasure key={m.id} m={m} selected={selectedId === m.id} />
      ))}
    </>
  );
}
