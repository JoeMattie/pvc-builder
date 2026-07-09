// Dev-only browser half of the PVC bridge (see vite/pvcBridgePlugin.ts). Loaded
// only under `import.meta.env.DEV` via a dynamic import in main.tsx, so it is
// tree-shaken out of production builds — production stays static/no-network
// (CLAUDE.md invariant). It (1) executes RPC commands against `window.__pvc`
// exactly as the pointer tools would, (2) answers a synthetic `__state` command
// with the FULL state dump the individual seams don't give in one shot, and
// (3) streams throttled store-change events so an external watcher can tail the
// session live. See src/dev/CONTEXT.md.

import { bom } from '../design/bom';
import { resolveFittings } from '../design/fittings';
import { solve } from '../solver';
import { useAppStore } from '../state/appStore';
import { getCameraPose, getPoseVersion } from '../state/cameraStore';
import { jointOrientationsOf, pivotAnglesOf } from '../state/editorActions';
import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/themeStore';

type PvcHook = Record<string, (...args: unknown[]) => unknown>;

function hook(): PvcHook | undefined {
  return (window as unknown as { __pvc?: PvcHook }).__pvc;
}

/** Everything an external debugger might want, assembled from the live stores so
 * nothing the piecemeal seams omit is lost (full editor state, undo depth,
 * camera pose, and the derived fittings/solve/bom). Derived pieces are guarded
 * so one throwing computation never sinks the whole dump. */
function buildStateDump(): unknown {
  const app = useAppStore.getState();
  const current = app.current;
  const temporal = useAppStore.temporal.getState();

  const rawEditor = useEditorStore.getState() as unknown as Record<string, unknown>;
  const editor = Object.fromEntries(
    Object.entries(rawEditor).filter(([, v]) => typeof v !== 'function'),
  );

  const guard = <T>(fn: () => T): T | { error: string } => {
    try {
      return fn();
    } catch (e) {
      return { error: (e as Error).message };
    }
  };

  return {
    app: {
      saveState: app.saveState,
      projectCount: app.projects.length,
      current, // the whole Design (or null), schema v9
    },
    history: {
      undoDepth: temporal.pastStates.length,
      redoDepth: temporal.futureStates.length,
    },
    editor,
    theme: { night: useThemeStore.getState().night },
    camera: { ...getCameraPose(), poseVersion: getPoseVersion() },
    derived: current
      ? {
          fittings: guard(() => resolveFittings(current)),
          solve: guard(() =>
            solve(
              current,
              {
                lengthsLocked: current.lengthsLocked,
                pivotAngles: pivotAnglesOf(current),
                jointOrientations: jointOrientationsOf(current),
              },
              'pose',
            ),
          ),
          bom: guard(() => bom(current)),
        }
      : null,
  };
}

async function execute(method: string, args: unknown[]): Promise<unknown> {
  if (method === '__state') return buildStateDump();
  const h = hook();
  const fn = h?.[method];
  if (typeof fn !== 'function') {
    throw new Error(`no window.__pvc.${method}() — is a design open?`);
  }
  return await fn(...args);
}

async function post(path: string, body: unknown): Promise<void> {
  try {
    await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    /* bridge not listening — ignore */
  }
}

/** JSON-safe: drops values that can't serialize (undefined/functions) rather
 * than throwing, so setter seams that return undefined still round-trip. */
function safe(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return { unserializable: true };
  }
}

function connectCommands(): void {
  const es = new EventSource('/__pvc/commands');
  es.onmessage = (ev) => {
    let cmd: { id: number; method: string; args: unknown[] };
    try {
      cmd = JSON.parse(ev.data);
    } catch {
      return;
    }
    void execute(cmd.method, cmd.args ?? [])
      .then((result) => post('/__pvc/result', { id: cmd.id, ok: true, result: safe(result) }))
      .catch((e: Error) => post('/__pvc/result', { id: cmd.id, ok: false, error: e.message }));
  };
  // EventSource reconnects on its own; nothing to do on error.
}

/** Trailing throttle that also drops identical consecutive payloads, so a burst
 * of store writes during a drag becomes at most one event per window. */
function makePublisher(type: string, snapshot: () => unknown, windowMs = 150): () => void {
  let last = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const payload = JSON.stringify(safe(snapshot()));
      if (payload === last) return;
      last = payload;
      void post('/__pvc/event', { type, ...JSON.parse(payload) });
    }, windowMs);
  };
}

function connectEvents(): void {
  const publishDoc = makePublisher('doc', () => {
    const app = useAppStore.getState();
    const d = app.current;
    let conflictCount = 0;
    try {
      conflictCount = d ? resolveFittings(d).conflicts.length : 0;
    } catch {
      /* ignore */
    }
    return {
      saveState: app.saveState,
      projectId: d?.id ?? null,
      lengthsLocked: d?.lengthsLocked ?? false,
      nodeCount: d?.nodes.length ?? 0,
      memberCount: d?.members.length ?? 0,
      jointCount: d?.joints.length ?? 0,
      conflictCount,
    };
  });

  const publishEditor = makePublisher('editor', () => {
    const s = useEditorStore.getState();
    return {
      tool: s.tool,
      projection: s.projection,
      selectedIds: s.selectedIds,
      selectedJointId: s.selectedJointId,
      selectedMeasurementId: s.selectedMeasurementId,
      selectedElasticId: s.selectedElasticId,
      drawingFromNodeId: s.drawingFromNodeId,
      simulating: s.simulating,
      enteredGroupId: s.enteredGroupId,
    };
  });

  useAppStore.subscribe(publishDoc);
  useEditorStore.subscribe(publishEditor);
}

function install(): void {
  const w = window as unknown as { __pvcBridge?: boolean };
  if (w.__pvcBridge) return; // guard HMR / double-import
  w.__pvcBridge = true;
  connectCommands();
  connectEvents();
  console.info('[pvc-bridge] connected to dev bridge (/__pvc/*)');
}

install();
