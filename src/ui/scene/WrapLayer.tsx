// Renders heat-wrapped tees (planfile §4): the branch's flattened PVC strip
// wrapped ONCE, smoothly, around the intact through pipe (see wrapMesh + the
// shared WrapStrip). Rigid wraps get steel screw discs; a pivot wrap is tinted
// the accent (the hinge barrel about the run). Placed at eased render positions
// so it glides; clicking it selects the branch (its inspector carries the
// rigid/pivot toggle).
import type { ThreeEvent } from '@react-three/fiber';
import { memberById, nodeById } from '../../design/docOps';
import { normalize, sub } from '../../geometry/math3';
import { pipeSpec, type Vec3, type Wrap } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { selectMember } from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { WrapStrip } from './WrapStrip';
import { buildWrapMesh } from './wrapMesh';

/** Skip past this many members (matches the fitting layer). */
const MAX_WRAP_MEMBERS = 200;

function WrapMeshView({
  wrap,
  selectable,
  selected,
}: {
  wrap: Wrap;
  selectable: boolean;
  selected: boolean;
}) {
  const design = useAppStore.getState().current;
  if (!design) return null;
  const eased = (id: string): Vec3 =>
    easedPos(id) ?? nodeById(design, id)?.position ?? { x: 0, y: 0, z: 0 };

  const through = memberById(design, wrap.throughMember);
  if (through?.kind !== 'straight') return null;
  const branch = design.members.find(
    (m) => m.nodeA === wrap.branchNode || m.nodeB === wrap.branchNode,
  );
  if (!branch) return null; // lone wrap node (branch not drawn yet)
  const far = branch.nodeA === wrap.branchNode ? branch.nodeB : branch.nodeA;

  const mesh = buildWrapMesh({
    through: { a: eased(through.nodeA), b: eased(through.nodeB), odM: pipeSpec(through.size).odM },
    wrapPoint: eased(wrap.branchNode),
    branchDir: normalize(sub(eased(far), eased(wrap.branchNode))),
    branchODM: pipeSpec(branch.size).odM,
    rigid: wrap.rigid,
  });
  if (!mesh) return null;

  const pal = scenePalette(useThemeStore.getState().night);
  const onSelect = selectable
    ? (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        selectMember(branch.id);
      }
    : undefined;
  // rigid = white PVC + screws; pivot = accent-tinted hinge barrel, no screws
  return (
    <WrapStrip
      mesh={mesh}
      color={wrap.rigid ? pal.pvc : pal.accent}
      selected={selected}
      onClick={onSelect}
    />
  );
}

export function WrapLayer() {
  useAnim((s) => s.v); // re-render while easing so wraps track the pipe
  const design = useAppStore((s) => s.current);
  const tool = useEditorStore((s) => s.tool);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  if (!design || design.members.length > MAX_WRAP_MEMBERS) return null;
  const selectable = tool === 'select';
  const isSelected = (w: Wrap) => {
    const branch = design.members.find((m) => m.nodeA === w.branchNode || m.nodeB === w.branchNode);
    return !!branch && selectedIds.includes(branch.id);
  };
  return (
    <>
      {design.wraps.map((w) => (
        <WrapMeshView key={w.id} wrap={w} selectable={selectable} selected={isSelected(w)} />
      ))}
    </>
  );
}
