#!/usr/bin/env node
// MCP front-end for the PVC Builder dev bridge. Exposes the running browser
// session's state + every `window.__pvc` seam to Claude Code as tools, by
// proxying to the dev-server relay hub (vite/pvcBridgePlugin.ts) over HTTP.
// Launched by Claude Code from .mcp.json. Stdout is reserved for the MCP
// stdio transport — all diagnostics go to stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.PVC_BRIDGE_URL ?? 'http://localhost:5173').replace(/\/$/, '');

async function bridgeFetch(path, init) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch (e) {
    throw new Error(
      `cannot reach the PVC dev server at ${BASE} — is \`npm run dev\` running with the app open? (${e.message})`,
    );
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || (body && body.ok === false)) {
    throw new Error(body?.error || `bridge returned HTTP ${res.status}`);
  }
  return body;
}

/** Invoke a `window.__pvc` seam in the live browser and return its result. */
async function bridgeCall(method, args = []) {
  const body = await bridgeFetch('/__pvc/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args }),
  });
  return body.result;
}

function textResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text: text ?? 'null' }] };
}

function errorResult(message) {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

const server = new McpServer({ name: 'pvc-builder', version: '0.1.0' });

/** Register a tool whose handler returns raw data; wrap success/errors uniformly. */
function tool(name, description, inputSchema, run) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      return textResult(await run(args ?? {}));
    } catch (e) {
      return errorResult(e.message);
    }
  });
}

const TOOLS = ['select', 'draw', 'formed', 'move', 'rotate', 'measure', 'bend', 'elastic'];

// ── state (read) ───────────────────────────────────────────────────────────
tool(
  'pvc_get_state',
  'Full snapshot of the running PVC Builder session: the whole document (nodes/members/joints), all transient editor state (tool, every selection kind, draw session), undo/redo depth, theme, camera pose, and derived fittings/conflicts/solve/BOM. Start here.',
  {},
  () => bridgeCall('__state'),
);
tool('pvc_get_doc', 'The current Design document (nodes, members, joints, schema v9).', {}, () =>
  bridgeCall('getDoc'),
);
tool(
  'pvc_get_editor',
  'Transient editor state exposed by the existing getEditor seam (tool, projection, selection, drawSize, snap, night).',
  {},
  () => bridgeCall('getEditor'),
);
tool(
  'pvc_get_fittings',
  'Resolved fittings and conflicts for the current design ({ fittings, conflicts }).',
  {},
  () => bridgeCall('getFittings'),
);
tool('pvc_get_solve', 'Kinematic solve result for the current design (pose mode).', {}, () =>
  bridgeCall('getSolve'),
);
tool('pvc_get_bom', 'Bill of materials / cut list for the current design.', {}, () =>
  bridgeCall('getBom'),
);
tool('pvc_get_members', 'Members with derived centre-to-centre length (metres).', {}, () =>
  bridgeCall('getMembers'),
);
tool('pvc_get_joints', 'Joint records (anchor / wrapped / free).', {}, () =>
  bridgeCall('getJoints'),
);

// ── actions (drive the app) ─────────────────────────────────────────────────
tool('pvc_set_tool', 'Switch the active editing tool.', { tool: z.enum(TOOLS) }, ({ tool: t }) =>
  bridgeCall('setTool', [t]).then(() => `tool set to ${t}`),
);
tool(
  'pvc_set_lengths_locked',
  'Set the global lengths-locked flag (true freezes lengths so only pivots move).',
  { locked: z.boolean() },
  ({ locked }) => bridgeCall('setLengthsLocked', [locked]).then(() => `lengthsLocked=${locked}`),
);
tool(
  'pvc_set_pivot_angle',
  'Set a wrapped joint (pivot) angle in radians.',
  { jointId: z.string(), angleRad: z.number() },
  ({ jointId, angleRad }) => bridgeCall('setPivotAngle', [jointId, angleRad]).then(() => 'ok'),
);
tool(
  'pvc_select',
  'Set the selection: pass ids to select members, or jointId to select a joint.',
  { ids: z.array(z.string()).optional(), jointId: z.string().optional() },
  ({ ids, jointId }) =>
    jointId
      ? bridgeCall('selectJoint', [jointId]).then(() => `selected joint ${jointId}`)
      : bridgeCall('setSelection', [ids ?? []]).then(
          () => `selected ${(ids ?? []).length} member(s)`,
        ),
);
tool('pvc_delete', 'Delete members by id.', { ids: z.array(z.string()) }, ({ ids }) =>
  bridgeCall('deleteMembers', [ids]).then(() => `deleted ${ids.length} member(s)`),
);
tool('pvc_export_json', 'Export the current design as a JSON string.', {}, () =>
  bridgeCall('exportJson'),
);
tool(
  'pvc_import_json',
  'Import a design JSON string as a new project and open it.',
  { text: z.string() },
  ({ text }) => bridgeCall('importJson', [text]).then(() => 'imported'),
);

// ── escape hatch + live watch ────────────────────────────────────────────────
tool(
  'pvc_call',
  'Call ANY window.__pvc seam by name (escape hatch for seams without a dedicated tool). e.g. method="draw", args=[{x,y,z}].',
  { method: z.string(), args: z.array(z.any()).optional() },
  ({ method, args }) => bridgeCall(method, args ?? []),
);
tool(
  'pvc_recent_events',
  'Drain buffered live store-change events since a sequence number (pull-style watch). Returns { lastSeq, events }. For real-time tailing, run a shell monitor on `curl -N ' +
    BASE +
    '/__pvc/stream`.',
  { since: z.number().optional() },
  ({ since }) => bridgeFetch(`/__pvc/events?since=${since ?? 0}`),
);
tool(
  'pvc_health',
  'Bridge connection health: whether a browser session is connected, watcher/pending counts, last event seq.',
  {},
  () => bridgeFetch('/__pvc/health'),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[pvc-mcp] connected; bridging to ${BASE}`);
