import { useEffect } from 'react';
import { bom } from '../../design/bom';
import { memberById, memberLengthM } from '../../design/docOps';
import { resolveFittings } from '../../design/fittings';
import { analyzeFormed } from '../../design/formed';
import { intersectingMembers } from '../../design/intersections';
import { exportDesignJson } from '../../persistence/exportImport';
import type { Vec3 } from '../../schema';
import { solve } from '../../solver';
import { physicsNodePositions, setPhysicsPrecision, setPhysicsTuning } from '../../solver/physics';
import { useAppStore } from '../../state/appStore';
import { setView, type ViewName } from '../../state/cameraStore';
import {
  bendMemberAt,
  clearSelection,
  copySelection,
  cutSelection,
  deleteElastic,
  deleteMeasurement,
  deleteMembers,
  detachMemberEnd,
  dragNodeTo,
  enterGroup,
  exitGroup,
  finishFormed,
  finishPath,
  groupSelection,
  hasClipboard,
  jointOrientationsOf,
  makeFreeHub,
  makeManufacturedJoint,
  moveFormedControlPoint,
  pasteClipboard,
  pivotAnglesOf,
  placeDrawPoint,
  placeElasticPoint,
  placeFormedPoint,
  placeMeasurePoint,
  rotateMemberBy,
  selectMember,
  setElasticTension,
  setJoinMode,
  setJointDamping,
  setLengthDisplay,
  setMannequin,
  setMemberLength,
  setMemberSize,
  setMembersSize,
  setPivotAngle,
  snapDrawPoint,
  swapJointReceiver,
  translateMemberBy,
  ungroupSelection,
  weldDroppedNode,
} from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';

/** Registers the public browser automation API used by smoke tests, scripted
 * checks, and the dev bridge. Methods are merged onto any existing hook object. */
export function PvcAutomationBridge() {
  useEffect(() => {
    const w = window as unknown as { __pvc?: Record<string, unknown> };
    if (!w.__pvc) w.__pvc = {};
    const hook = w.__pvc;

    hook.getDoc = () => useAppStore.getState().current;
    hook.getEditor = () => {
      const s = useEditorStore.getState();
      return {
        tool: s.tool,
        projection: s.projection,
        selectedIds: s.selectedIds,
        selectedJointId: s.selectedJointId,
        drawSize: s.drawSize,
        drawingFromNodeId: s.drawingFromNodeId,
        snap: s.snap,
        night: useThemeStore.getState().night,
      };
    };
    hook.setSnap = (patch: Record<string, unknown>) =>
      useEditorStore.getState().setSnap(patch as never);
    hook.getFittings = () => {
      const d = useAppStore.getState().current;
      return d ? resolveFittings(d) : { fittings: [], conflicts: [] };
    };
    hook.getMembers = () => {
      const d = useAppStore.getState().current;
      if (!d) return [];
      return d.members.map((m) => ({
        id: m.id,
        size: m.size,
        nodeA: m.nodeA,
        nodeB: m.nodeB,
        lengthM: memberLengthM(d, m),
      }));
    };
    hook.setTool = (
      tool:
        | 'select'
        | 'draw'
        | 'formed'
        | 'move'
        | 'rotate'
        | 'measure'
        | 'bend'
        | 'elastic'
        | 'extend'
        | 'guide',
    ) => useEditorStore.getState().setTool(tool);
    hook.setProjection = (p: 'ortho' | 'perspective') => useEditorStore.getState().setProjection(p);
    hook.setView = (name: ViewName) => setView(name);
    hook.setDrawSize = (size: '1/2"' | '3/4"') => useEditorStore.getState().setDrawSize(size);
    hook.setLengthsLocked = (locked: boolean) =>
      useAppStore.getState().updateCurrent((doc) => ({ ...doc, lengthsLocked: locked }));
    hook.setNight = (on: boolean) => useThemeStore.getState().setNight(on);

    // Drawing / editing seams (world ground points).
    hook.snap = (raw: Vec3, lockAxis?: boolean) => snapDrawPoint(raw, !!lockAxis);
    hook.draw = (raw: Vec3, lockAxis?: boolean) => placeDrawPoint(raw, !!lockAxis);
    hook.finishPath = () => finishPath();
    hook.drawFormed = (raw: Vec3) => placeFormedPoint(raw);
    hook.finishFormed = () => finishFormed();
    hook.measure = (raw: Vec3) => placeMeasurePoint(raw);
    hook.getMeasurements = () => useAppStore.getState().current?.measurements ?? [];
    hook.deleteMeasurement = (id: string) => deleteMeasurement(id);

    // Elastic-band seams (place two attachment points -> a spring band).
    hook.placeElastic = (raw: Vec3) => placeElasticPoint(raw);
    hook.getElastics = () => useAppStore.getState().current?.elastics ?? [];
    hook.setElasticTension = (id: string, stiffnessNPerM: number) =>
      setElasticTension(id, stiffnessNPerM);
    hook.selectElastic = (id: string | null) => useEditorStore.getState().selectElastic(id);
    hook.deleteElastic = (id: string) => deleteElastic(id);

    hook.bendMember = (
      memberId: string,
      t: number,
      perpOffset: Vec3,
      lengthRef?: { axisDir: Vec3; lengthM: number },
    ) => bendMemberAt(memberId, t, perpOffset, lengthRef);
    hook.setBendLengthLock = (on: boolean) => useEditorStore.getState().setBendLengthLock(on);
    hook.moveControlPoint = (memberId: string, index: number, raw: Vec3) =>
      moveFormedControlPoint(memberId, index, raw);
    hook.selectMember = (id: string) => selectMember(id);
    hook.setSelection = (ids: string[]) => useEditorStore.getState().setSelection(ids);
    hook.openJoinMenu = (menu: { nodeId: string; moverId: string; x: number; y: number }) =>
      useEditorStore.getState().openJoinMenu(menu);
    hook.copySelection = () => copySelection();
    hook.cutSelection = () => cutSelection();
    hook.pasteClipboard = () => pasteClipboard();
    hook.hasClipboard = () => hasClipboard();
    hook.groupSelection = () => groupSelection();
    hook.ungroupSelection = () => ungroupSelection();
    hook.enterGroup = (id: string) => enterGroup(id);
    hook.exitGroup = () => exitGroup();
    hook.getEnteredGroup = () => useEditorStore.getState().enteredGroupId;
    hook.selectJoint = (id: string | null) => useEditorStore.getState().selectJoint(id);
    hook.clearSelection = () => clearSelection();
    hook.deleteMembers = (ids: string[]) => deleteMembers(ids);
    hook.setMemberLength = (id: string, lengthM: number) => setMemberLength(id, lengthM);
    hook.setMemberSize = (id: string, size: '1/2"' | '3/4"') => setMemberSize(id, size);
    hook.setMembersSize = (ids: string[], size: '1/2"' | '3/4"') => setMembersSize(ids, size);
    hook.setLengthDisplay = (d: 'mm' | 'cm' | 'in' | 'in-frac') => setLengthDisplay(d);
    hook.detachMemberEnd = (memberId: string, nodeId: string) => detachMemberEnd(memberId, nodeId);
    hook.weldDroppedNode = (nodeId: string) => weldDroppedNode(nodeId);
    hook.dragNode = (id: string, raw: Vec3) => dragNodeTo(id, raw);
    hook.moveMember = (id: string, delta: Vec3) => translateMemberBy(id, delta);
    hook.rotateMember = (id: string, axis: Vec3, angleRad: number, pivot: Vec3) =>
      rotateMemberBy(id, axis, angleRad, pivot);
    hook.getIntersections = () => {
      const d = useAppStore.getState().current;
      return d ? [...intersectingMembers(d)] : [];
    };
    hook.getFormed = (id: string) => {
      const d = useAppStore.getState().current;
      const m = d ? memberById(d, id) : undefined;
      return d && m && m.kind === 'formed' ? analyzeFormed(d, m) : null;
    };

    // Joint seams (right-click a join -> anchor / wrapped / free).
    hook.getJoints = () => useAppStore.getState().current?.joints ?? [];
    hook.setJoinMode = (
      nodeId: string,
      moverId: string,
      mode: 'anchor' | 'wrapped' | 'free',
      receiverId?: string,
    ) => setJoinMode(nodeId, moverId, mode, receiverId);
    hook.swapJointReceiver = (jointId: string) => swapJointReceiver(jointId);
    hook.makeManufacturedJoint = (nodeId: string, moverId: string) =>
      makeManufacturedJoint(nodeId, moverId);
    hook.makeFreeHub = (nodeId: string) => makeFreeHub(nodeId);

    // Opt-in: logs what the draw cursor / a dragged endpoint snaps to.
    hook.setSnapDebug = (on: boolean) => {
      hook.snapDebug = on;
    };

    // Pivots / solver seams.
    hook.setPivotAngle = (jointId: string, angleRad: number) => setPivotAngle(jointId, angleRad);
    hook.getSolve = () => {
      const d = useAppStore.getState().current;
      if (!d) return null;
      return solve(
        d,
        {
          lengthsLocked: d.lengthsLocked,
          pivotAngles: pivotAnglesOf(d),
          jointOrientations: jointOrientationsOf(d),
        },
        'pose',
      );
    };

    // BOM + export/import seams.
    hook.getBom = () => {
      const d = useAppStore.getState().current;
      return d ? bom(d) : null;
    };
    hook.exportJson = () => {
      const d = useAppStore.getState().current;
      return d ? exportDesignJson(d) : null;
    };
    hook.importJson = (text: string) => useAppStore.getState().importAndOpen(text);

    // Physics seams.
    hook.setSimulating = (on: boolean) => useEditorStore.getState().setSimulating(on);
    hook.setPhysicsDebug = (on: boolean) => useEditorStore.getState().setPhysicsDebug(on);
    hook.setWireframe = (on: boolean) => useEditorStore.getState().setWireframe(on);
    hook.getPhysics = () => physicsNodePositions();

    // Mannequin (static human collision body) + global damping (friction/drag).
    hook.setMannequin = (on: boolean) => setMannequin(on);
    hook.setJointDamping = (mult: number) => setJointDamping(mult);

    // Perf-lever A/B seams (set before simulating; baked at world build).
    hook.setPhysicsPrecision = (o: { substeps?: boolean; ccd?: boolean; vcap?: boolean }) =>
      setPhysicsPrecision(o);
    hook.setPhysicsTuning = (o: {
      velocityIterations?: number;
      positionIterations?: number;
      allowSleeping?: boolean;
    }) => setPhysicsTuning(o);
  }, []);

  return null;
}
