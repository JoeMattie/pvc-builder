import { useEffect } from 'react';
import type { Vec3 } from '../../schema';
import { useAppStore } from '../../state/appStore';
import {
  cancelGuideDraft,
  clearGuides,
  clearSelection,
  copySelection,
  cutSelection,
  deleteElastic,
  deleteMeasurement,
  deleteMembers,
  exitGroup,
  finishFormed,
  finishPath,
  groupSelection,
  pasteClipboard,
  placeDrawAtDistance,
  placeGuide,
  placeGuideAtOffset,
  translateMembersBy,
  ungroupSelection,
} from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { recordPointerDebug, wasRightDrag } from '../scene/rightClickGesture';
import { parseLength } from '../units';

interface EditorHotkeyActions {
  undo(): void;
  redo(): void;
}

/** Global editor keyboard and pointer bindings. Keep this in sync with
 * HelpPanel and Pillbox shortcut labels. */
export function useEditorHotkeys({ undo, redo }: EditorHotkeyActions) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const editor = useEditorStore.getState();
      const typing =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      // Ctrl/Cmd+Space -> start/stop playback (physics simulation)
      if (mod && (e.key === ' ' || e.code === 'Space')) {
        e.preventDefault();
        editor.setSimulating(!editor.simulating);
        return;
      }
      if (typing) return;

      // Copy / cut / paste the selection (mod-gated, so it also beats the plain
      // C/V tool hotkeys below).
      if (mod && e.key.toLowerCase() === 'c') {
        if (copySelection()) e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === 'x') {
        if (cutSelection()) e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        if (pasteClipboard()) e.preventDefault();
        return;
      }

      // Arrow / numpad nudge of the selected pipe(s) by one grid step. Arrows
      // and numpad arrows move in the X/Z ground plane; Ctrl+Up/Down (or the
      // numpad Home/PgUp = up, End/PgDn = down) move vertically in Y.
      if (editor.selectedIds.length && !editor.drawingFromNodeId) {
        const s = editor.snap.gridStepM;
        const K = e.key;
        const C = e.code;
        let d: Vec3 | null = null;
        if (mod && K === 'ArrowUp') d = { x: 0, y: s, z: 0 };
        else if (mod && K === 'ArrowDown') d = { x: 0, y: -s, z: 0 };
        else if (K === 'Home' || K === 'PageUp' || C === 'Numpad7' || C === 'Numpad9')
          d = { x: 0, y: s, z: 0 };
        else if (K === 'End' || K === 'PageDown' || C === 'Numpad1' || C === 'Numpad3')
          d = { x: 0, y: -s, z: 0 };
        else if (K === 'ArrowLeft' || C === 'Numpad4') d = { x: -s, y: 0, z: 0 };
        else if (K === 'ArrowRight' || C === 'Numpad6') d = { x: s, y: 0, z: 0 };
        else if (K === 'ArrowUp' || C === 'Numpad8') d = { x: 0, y: 0, z: -s };
        else if (K === 'ArrowDown' || C === 'Numpad2') d = { x: 0, y: 0, z: s };
        if (d) {
          e.preventDefault();
          translateMembersBy(editor.selectedIds, d);
          return;
        }
      }

      // Typed-length entry: while a draw path is open, digits/units type into
      // the length pill; Enter commits the segment at that distance (must run
      // before tool hotkeys so e.g. "10cm" does not trigger the Curve tool).
      if (editor.tool === 'draw' && editor.drawingFromNodeId) {
        if (e.key === 'Enter' && editor.drawLength) {
          const doc = useAppStore.getState().current;
          const m = doc ? parseLength(editor.drawLength, doc.lengthDisplay) : null;
          if (m && m > 0 && placeDrawAtDistance(m)) {
            e.preventDefault();
            return;
          }
        } else if (e.key === 'Backspace' && editor.drawLength) {
          editor.setDrawLength(editor.drawLength.slice(0, -1));
          e.preventDefault();
          return;
        } else if (e.key === 'Escape' && editor.drawLength) {
          editor.setDrawLength('');
          e.preventDefault();
          return;
        } else if (e.key.length === 1 && /[0-9./'" a-z]/i.test(e.key)) {
          editor.setDrawLength(editor.drawLength + e.key);
          e.preventDefault();
          return;
        }
      }

      // Shift+Q clears every placed guide line (works in any tool / mid-draft).
      if (e.key === 'Q' && e.shiftKey) {
        clearGuides();
        e.preventDefault();
        return;
      }
      // Guide tool typed-offset entry: digits/units type into the guide length
      // pill; Enter commits the guide at that perpendicular offset.
      if (editor.tool === 'guide' && editor.guideDraft) {
        const cursor = editor.guideCursor;
        if (e.key === 'Enter' && cursor) {
          if (editor.guideLength) {
            const doc = useAppStore.getState().current;
            const m = doc ? parseLength(editor.guideLength, doc.lengthDisplay) : null;
            if (m && m > 0 && placeGuideAtOffset(cursor, m)) {
              e.preventDefault();
              return;
            }
          } else {
            placeGuide(cursor);
            e.preventDefault();
            return;
          }
        } else if (e.key === 'Backspace' && editor.guideLength) {
          editor.setGuideLength(editor.guideLength.slice(0, -1));
          e.preventDefault();
          return;
        } else if (e.key === 'Escape') {
          cancelGuideDraft();
          e.preventDefault();
          return;
        } else if (e.key.length === 1 && /[0-9./'" a-z]/i.test(e.key)) {
          editor.setGuideLength(editor.guideLength + e.key);
          e.preventDefault();
          return;
        }
      }

      if (e.key === 'Escape' || e.key === 'Enter') {
        if (editor.drawingFromNodeId) finishPath();
        else if (editor.formedPoints.length) finishFormed();
        else if (editor.measureFrom || editor.measureAdjustId) {
          editor.setMeasureFrom(null);
          editor.setMeasureAdjustId(null);
        } else if (editor.elasticFrom) editor.setElasticFrom(null);
        else if (e.key === 'Escape' && editor.enteredGroupId) exitGroup();
        else clearSelection();
      } else if (e.key === 'g' || e.key === 'G') {
        // G groups the selection; Shift+G ungroups it.
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
      } else if (e.key === ' ') {
        // Spacebar -> back to the select tool.
        e.preventDefault();
        editor.setTool('select');
      } else if (e.key === 'v' || e.key === 'V') {
        editor.setTool('select');
      } else if (e.key === 'd' || e.key === 'D') {
        editor.setTool('draw');
      } else if (e.key === 'm' || e.key === 'M') {
        editor.setTool('move');
      } else if (e.key === 'c' || e.key === 'C') {
        editor.setTool('formed');
      } else if (e.key === 'b' || e.key === 'B') {
        editor.setTool('bend');
      } else if (e.key === 't' || e.key === 'T') {
        editor.setTool('measure');
      } else if (e.key === 'e' || e.key === 'E') {
        editor.setTool('elastic');
      } else if (e.key === 'r' || e.key === 'R') {
        editor.setTool('rotate');
      } else if (e.key === 'p' || e.key === 'P') {
        editor.setTool('extend');
      } else if (e.key === 'q' || e.key === 'Q') {
        editor.setTool('guide');
      } else if (e.key === 'w' || e.key === 'W') {
        editor.toggleWireframe();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editor.selectedMeasurementId) deleteMeasurement(editor.selectedMeasurementId);
        else if (editor.selectedElasticId) deleteElastic(editor.selectedElasticId);
        else if (editor.selectedIds.length) {
          deleteMembers(editor.selectedIds);
          clearSelection();
        }
      }
    };

    // Right button ends any path in progress (and never opens a context menu).
    // Fires on RELEASE, gated by the shared right-click gesture module: a
    // right-DRAG (cursor orbit) must NOT abort the path — only a plain
    // right-CLICK does. Scene's capture-phase pointerup has already closed the
    // gesture by the time this bubble listener runs, so `wasRightDrag` sees
    // the just-finished gesture's moved flag.
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 2) return;
      const s = useEditorStore.getState();
      if (!s.drawingFromNodeId && !s.formedPoints.length) return;
      const moved = wasRightDrag(e.pointerId);
      recordPointerDebug(moved ? 'path-end-suppressed' : 'path-end', {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        moved,
      });
      if (moved) return;
      if (s.drawingFromNodeId) finishPath();
      else finishFormed();
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, [undo, redo]);
}
