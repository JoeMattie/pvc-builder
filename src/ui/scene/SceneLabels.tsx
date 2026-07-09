import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { type Group, Vector3 } from 'three';
import { bom, type CutItem } from '../../design/bom';
import { memberById, memberLengthM, nodeById } from '../../design/docOps';
import { type FittingType, resolveFittings } from '../../design/fittings';
import { add, dot, scale, sub } from '../../geometry/math3';
import type { Design, Joint, Member, Vec3 } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { type HoveredSceneItem, useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { formatLengthDisplay } from '../units';

const MAX_CUT_LABELS = 220;
const UI_OCCLUDERS =
  '[data-floating-island], [data-viewport-occluder], [role="menu"], [data-radix-popper-content-wrapper]';

type LabelTone = 'cut' | 'member' | 'joint' | 'fitting' | 'warning';

type LabelAnchor =
  | { kind: 'member'; memberId: string; t0?: number; t1?: number }
  | { kind: 'node'; nodeId: string };

interface LabelSpec {
  key: string;
  tone: LabelTone;
  anchor: LabelAnchor;
  main: string;
  sub?: string;
  compact?: boolean;
}

const FITTING_LABEL: Record<FittingType, string> = {
  coupling: 'coupling',
  reducer: 'reducer',
  elbow45: '45 deg elbow',
  elbow90: '90 deg elbow',
  elbow3way: '3-way elbow',
  tee: 'tee',
  cross: 'cross',
};

const JOINT_LABEL: Record<Joint['mode'], string> = {
  anchor: 'rigid anchor',
  wrapped: 'wrapped pivot',
  free: 'free joint',
};

function splitTsByMember(design: Design): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const j of design.joints) {
    if (!j.manufactured || !j.onBody) continue;
    const recv = memberById(design, j.receiver);
    if (recv?.kind !== 'straight') continue;
    const a = nodeById(design, recv.nodeA)?.position;
    const b = nodeById(design, recv.nodeB)?.position;
    const p = nodeById(design, j.nodeId)?.position;
    if (!a || !b || !p) continue;
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    if (l2 < 1e-9) continue;
    const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
    if (t <= 1e-4 || t >= 1 - 1e-4) continue;
    const list = out.get(recv.id) ?? [];
    list.push(t);
    out.set(recv.id, list);
  }
  for (const [id, list] of out) {
    out.set(
      id,
      [...new Set(list.map((t) => Number(t.toFixed(6))))].sort((a, b) => a - b),
    );
  }
  return out;
}

function cutIdsByMember(cuts: CutItem[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  cuts.forEach((c, i) => {
    const list = out.get(c.memberId) ?? [];
    list.push(`P${i + 1}`);
    out.set(c.memberId, list);
  });
  return out;
}

function cutLabels(design: Design, cuts: CutItem[], semanticMembers: Set<string>): LabelSpec[] {
  if (cuts.length > MAX_CUT_LABELS) return [];
  const splitTs = splitTsByMember(design);
  return cuts
    .map((c, i): LabelSpec | null => {
      if (semanticMembers.has(c.memberId)) return null;
      const ts = splitTs.get(c.memberId);
      const t0 = c.segment !== undefined ? (ts ? [0, ...ts, 1][c.segment] : undefined) : undefined;
      const t1 =
        c.segment !== undefined ? (ts ? [0, ...ts, 1][c.segment + 1] : undefined) : undefined;
      return {
        key: `cut-${c.memberId}-${c.segment ?? 'whole'}-${i}`,
        tone: 'cut',
        anchor: { kind: 'member', memberId: c.memberId, t0, t1 },
        main: `P${i + 1}`,
        compact: true,
      };
    })
    .filter((l): l is LabelSpec => !!l);
}

function memberLabel(design: Design, member: Member, cutIds: string[], reason: string): LabelSpec {
  const len = memberLengthM(design, member);
  const pipeKind = member.kind === 'formed' ? 'formed pipe' : 'pipe';
  const idText = cutIds.length ? `${cutIds.join(', ')} - ` : '';
  return {
    key: `member-${reason}-${member.id}`,
    tone: 'member',
    anchor: { kind: 'member', memberId: member.id },
    main: `${pipeKind} ${member.size}`,
    sub: `${idText}${formatLengthDisplay(len, design.lengthDisplay)}`,
  };
}

function jointLabel(joint: Joint, reason: string): LabelSpec {
  const fabrication =
    joint.manufactured === true
      ? 'manufactured fitting'
      : joint.mode === 'wrapped' || joint.mode === 'anchor'
        ? 'fabricated hardware'
        : 'joint hardware';
  const placement = joint.onBody ? 'on-body' : 'end-to-end';
  return {
    key: `joint-${reason}-${joint.id}`,
    tone: 'joint',
    anchor: { kind: 'node', nodeId: joint.nodeId },
    main: JOINT_LABEL[joint.mode],
    sub: `${placement} - ${fabrication}`,
  };
}

function hoverLabel(design: Design, hovered: HoveredSceneItem, cutIds: Map<string, string[]>) {
  if (!hovered) return null;
  if (hovered.kind === 'member') {
    const member = memberById(design, hovered.id);
    return member ? memberLabel(design, member, cutIds.get(member.id) ?? [], 'hover') : null;
  }
  if (hovered.kind === 'joint') {
    const joint = design.joints.find((j) => j.id === hovered.id);
    return joint ? jointLabel(joint, 'hover') : null;
  }
  const resolved = resolveFittings(design);
  const fitting = resolved.fittings.find((f) => f.nodeId === hovered.id);
  if (fitting) {
    const sizes = [...new Set(fitting.ends.map((e) => e.size))].join(', ');
    return {
      key: `fitting-hover-${fitting.nodeId}`,
      tone: 'fitting' as const,
      anchor: { kind: 'node' as const, nodeId: fitting.nodeId },
      main: `${FITTING_LABEL[fitting.type]}${fitting.reducing ? ' reducer' : ''}`,
      sub: sizes,
    };
  }
  const conflict = resolved.conflicts.find((c) => c.nodeId === hovered.id);
  return conflict
    ? {
        key: `fitting-conflict-hover-${conflict.nodeId}`,
        tone: 'warning' as const,
        anchor: { kind: 'node' as const, nodeId: conflict.nodeId },
        main: 'fitting conflict',
        sub: conflict.reason,
      }
    : null;
}

function buildLabels({
  design,
  showCutIds,
  selectedIds,
  selectedJointId,
  hovered,
}: {
  design: Design;
  showCutIds: boolean;
  selectedIds: string[];
  selectedJointId: string | null;
  hovered: HoveredSceneItem;
}): LabelSpec[] {
  const labels = new Map<string, LabelSpec>();
  const b = bom(design);
  const cuts = cutIdsByMember(b.cuts);
  const semanticMembers = new Set(selectedIds);
  if (hovered?.kind === 'member') semanticMembers.add(hovered.id);

  for (const id of selectedIds) {
    const member = memberById(design, id);
    if (member)
      labels.set(
        `member-${member.id}`,
        memberLabel(design, member, cuts.get(id) ?? [], 'selected'),
      );
  }
  if (selectedJointId) {
    const joint = design.joints.find((j) => j.id === selectedJointId);
    if (joint) labels.set(`joint-${joint.id}`, jointLabel(joint, 'selected'));
  }
  const hover = hoverLabel(design, hovered, cuts);
  const duplicateHover =
    (hovered?.kind === 'member' && selectedIds.includes(hovered.id)) ||
    (hovered?.kind === 'joint' && hovered.id === selectedJointId);
  if (hover && !duplicateHover) labels.set(hover.key, hover);
  if (showCutIds) {
    for (const label of cutLabels(design, b.cuts, semanticMembers)) labels.set(label.key, label);
  }
  return [...labels.values()];
}

function memberPosition(design: Design, memberId: string, t0?: number, t1?: number): Vec3 | null {
  const member = memberById(design, memberId);
  if (!member) return null;
  const a = easedPos(member.nodeA) ?? nodeById(design, member.nodeA)?.position;
  const b = easedPos(member.nodeB) ?? nodeById(design, member.nodeB)?.position;
  if (!a || !b) return null;
  if (member.kind === 'straight') {
    const t = t0 !== undefined && t1 !== undefined ? (t0 + t1) / 2 : 0.5;
    return add(a, scale(sub(b, a), t));
  }
  const pts = [a, ...member.controlPoints, b];
  const sum = pts.reduce((acc, p) => add(acc, p), { x: 0, y: 0, z: 0 });
  return scale(sum, 1 / pts.length);
}

function labelPosition(design: Design, anchor: LabelAnchor): Vec3 | null {
  if (anchor.kind === 'node') {
    return easedPos(anchor.nodeId) ?? nodeById(design, anchor.nodeId)?.position ?? null;
  }
  const p = memberPosition(design, anchor.memberId, anchor.t0, anchor.t1);
  if (!p) return null;
  const member = memberById(design, anchor.memberId);
  const lift = member ? Math.max(0.026, memberLengthM(design, member) * 0.012) : 0.026;
  return { x: p.x, y: p.y + Math.min(lift, 0.07), z: p.z };
}

function initialPosition(design: Design, anchor: LabelAnchor): [number, number, number] {
  const p = labelPosition(design, anchor) ?? { x: 0, y: 0, z: 0 };
  return [p.x, p.y, p.z];
}

function visibleUiRects(): DOMRect[] {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll<HTMLElement>(UI_OCCLUDERS))
    .filter((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      );
    })
    .map((el) => el.getBoundingClientRect());
}

function isPointInRects(point: { x: number; y: number }, rects: DOMRect[]): boolean {
  return rects.some(
    (rect) =>
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom,
  );
}

function toneStyle(tone: LabelTone, night: boolean) {
  if (tone === 'cut') {
    return {
      background: night ? '#172033' : '#ffffff',
      color: night ? '#e8f0ff' : '#1d3557',
      border: night ? '#36588c' : '#9db7de',
    };
  }
  if (tone === 'joint') {
    return {
      background: night ? '#10261a' : '#effaf2',
      color: night ? '#dbf7e4' : '#1f6f3d',
      border: night ? '#2d7747' : '#8fd0a2',
    };
  }
  if (tone === 'fitting') {
    return {
      background: night ? '#262426' : '#fff7ed',
      color: night ? '#fce8d0' : '#8a4b12',
      border: night ? '#7a5b35' : '#e4b074',
    };
  }
  if (tone === 'warning') {
    return {
      background: night ? '#321414' : '#fff1f2',
      color: night ? '#ffd9dd' : '#9f1239',
      border: night ? '#8b3039' : '#f0a0aa',
    };
  }
  return {
    background: night ? '#1e2128' : '#ffffff',
    color: night ? '#e8eaf0' : '#1a1d24',
    border: night ? '#454954' : '#cfd4dc',
  };
}

function LabelPill({ label, night }: { label: LabelSpec; night: boolean }) {
  const colors = toneStyle(label.tone, night);
  const font = label.compact
    ? "700 11px 'IBM Plex Mono', monospace"
    : "600 11px 'IBM Plex Sans', sans-serif";
  return (
    <Html center zIndexRange={[18, 0]}>
      <div
        style={{
          minWidth: label.compact ? 24 : 64,
          maxWidth: 180,
          padding: label.compact ? '2px 6px' : '4px 7px',
          borderRadius: 6,
          border: `1px solid ${colors.border}`,
          background: colors.background,
          color: colors.color,
          boxShadow: night ? '0 4px 12px rgba(0,0,0,0.28)' : '0 3px 10px rgba(15,23,42,0.14)',
          font,
          lineHeight: 1.1,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          transform: label.compact ? 'translateY(-10px)' : 'translateY(-18px)',
        }}
      >
        <div>{label.main}</div>
        {label.sub && (
          <div
            style={{
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              font: "500 10px 'IBM Plex Sans', sans-serif",
              opacity: 0.82,
            }}
          >
            {label.sub}
          </div>
        )}
      </div>
    </Html>
  );
}

export function SceneLabels() {
  const design = useAppStore((s) => s.current);
  const sceneStatus = useEditorStore((s) => s.sceneStatus);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selectedJointId = useEditorStore((s) => s.selectedJointId);
  const hovered = useEditorStore((s) => s.hoveredSceneItem);
  const night = useThemeStore((s) => s.night);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const refs = useRef<Array<Group | null>>([]);
  const lastV = useRef(-1);
  const screen = useRef(new Vector3()).current;

  const labels = useMemo(
    () =>
      design
        ? buildLabels({
            design,
            showCutIds: sceneStatus === 'fabricate',
            selectedIds,
            selectedJointId,
            hovered,
          })
        : [],
    [design, sceneStatus, selectedIds, selectedJointId, hovered],
  );

  useEffect(() => {
    lastV.current = -1;
  });

  useFrame(() => {
    if (!design) return;
    const v = useAnim.getState().v;
    const hideUnderUi = sceneStatus === 'fabricate';
    if (!hideUnderUi && v === lastV.current) return;
    lastV.current = v;
    const canvasRect = hideUnderUi ? gl.domElement.getBoundingClientRect() : null;
    const rects = hideUnderUi ? visibleUiRects() : [];
    for (let i = 0; i < labels.length; i++) {
      const group = refs.current[i];
      const label = labels[i];
      if (!group || !label) continue;
      const p = labelPosition(design, label.anchor);
      let occluded = false;
      if (p && canvasRect) {
        screen.set(p.x, p.y, p.z).project(camera);
        occluded = isPointInRects(
          {
            x: canvasRect.left + (screen.x * 0.5 + 0.5) * canvasRect.width,
            y: canvasRect.top + (-screen.y * 0.5 + 0.5) * canvasRect.height,
          },
          rects,
        );
      }
      group.visible = !!p && !occluded;
      if (p) group.position.set(p.x, p.y, p.z);
    }
  });

  if (!design || labels.length === 0) return null;

  return (
    <>
      {labels.map((label, i) => (
        <group
          key={label.key}
          ref={(el) => {
            refs.current[i] = el;
          }}
          position={initialPosition(design, label.anchor)}
        >
          <LabelPill label={label} night={night} />
        </group>
      ))}
    </>
  );
}
