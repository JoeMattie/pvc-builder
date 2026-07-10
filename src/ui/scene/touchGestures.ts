import { useEditorStore } from '../../state/editorStore';

const activeTouches = new Set<number>();
let cancellationEpoch = 0;

export function activeTouchCount(): number {
  return activeTouches.size;
}

export function touchCancellationEpoch(): number {
  return cancellationEpoch;
}

export function trackTouchPointerDown(event: PointerEvent): void {
  if (event.pointerType !== 'touch') return;
  activeTouches.add(event.pointerId);
  if (activeTouches.size < 2) return;
  cancellationEpoch++;
  const editor = useEditorStore.getState();
  editor.setMarquee(null);
  editor.setDrawDirection(null);
  editor.setDrawLength('');
  editor.clearFormedPoints();
  editor.closeJoinMenu();
  editor.closeSizeMenu();
}

export function trackTouchPointerEnd(event: PointerEvent): void {
  if (event.pointerType === 'touch') activeTouches.delete(event.pointerId);
}

export function touchCanEdit(event: PointerEvent): boolean {
  if (event.pointerType !== 'touch') return true;
  return useEditorStore.getState().navigationMode === 'edit' && activeTouches.size <= 1;
}
