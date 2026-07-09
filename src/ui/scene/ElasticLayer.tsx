// Renders elastic bands (schema v8 `elastics`): a thin orange tube between the
// two attachment points, drawn at eased render positions so it tracks the pipes
// as they move / simulate. Selectable (click) → highlighted; a tension slider
// then edits its stiffness (EditorShell). A stretched band tints hotter.
import { memberById, nodeById } from '../../design/docOps';
import { add, length, scale, sub } from '../../geometry/math3';
import type { Attachment, Elastic, Vec3 } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { placeAxis } from './axis';

const BAND_COLOR = '#f76707';
const STRETCH_COLOR = '#ff2b2b';
const SELECT_BLUE = '#2a78d6';
const BAND_RADIUS_M = 0.004;

/** Lerp between two #rrggbb colours by t∈[0,1]. */
function mixHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i]! - v) * Math.max(0, Math.min(1, t))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function OneBand({ e, selected }: { e: Elastic; selected: boolean }) {
  const design = useAppStore.getState().current;
  if (!design) return null;
  // eased attachment position: a node's eased point, or a lerp along a member's
  // (eased) endpoints — so the band follows the pipes during a pose / sim
  const at = (att: Attachment): Vec3 | undefined => {
    if ('nodeId' in att) return easedPos(att.nodeId) ?? nodeById(design, att.nodeId)?.position;
    const m = memberById(design, att.memberId);
    if (!m) return undefined;
    const a = easedPos(m.nodeA) ?? nodeById(design, m.nodeA)?.position;
    const b = easedPos(m.nodeB) ?? nodeById(design, m.nodeB)?.position;
    if (!a || !b) return undefined;
    const t = Math.max(0, Math.min(1, att.t));
    return add(a, scale(sub(b, a), t));
  };
  const a = at(e.a);
  const b = at(e.b);
  if (!a || !b) return null;
  const placed = placeAxis(a, b);
  if (!placed) return null;

  const span = length(sub(b, a));
  // stretch ratio beyond rest length → hotter tint (0 = at rest, 1 = ≥2× rest)
  const stretch = e.restLengthM > 1e-6 ? (span - e.restLengthM) / e.restLengthM : 0;
  const color = selected ? SELECT_BLUE : mixHex(BAND_COLOR, STRETCH_COLOR, stretch);
  const r = selected ? BAND_RADIUS_M * 1.5 : BAND_RADIUS_M;
  const select = (ev: { stopPropagation: () => void }) => {
    ev.stopPropagation();
    useEditorStore.getState().selectElastic(e.id);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f <mesh> is a scene node, not a DOM element
    <mesh
      position={placed.mid}
      quaternion={placed.quat}
      onClick={select}
      onPointerDown={(ev) => ev.stopPropagation()}
    >
      <cylinderGeometry args={[r, r, placed.len, 10]} />
      <meshStandardMaterial
        color={color}
        roughness={0.6}
        metalness={0.05}
        emissive={color}
        emissiveIntensity={0.15}
      />
    </mesh>
  );
}

export function ElasticLayer() {
  useAnim((s) => s.v); // track eased positions
  useThemeStore((s) => s.night);
  const elastics = useAppStore((s) => s.current?.elastics);
  const selectedId = useEditorStore((s) => s.selectedElasticId);
  if (!elastics || elastics.length === 0) return null;
  return (
    <>
      {elastics.map((e) => (
        <OneBand key={e.id} e={e} selected={selectedId === e.id} />
      ))}
    </>
  );
}
