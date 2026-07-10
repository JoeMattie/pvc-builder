import { expect, type Page, test } from '@playwright/test';

const IN = 0.0254;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function openNewDesign(page: Page, name: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByLabel('New design name').fill(name);
  await page.getByRole('button', { name: /Create/ }).click();
  await page.waitForFunction(() => {
    const p = (window as any).__pvc;
    return !!p?.getDoc?.() && !!p?.screenOf;
  });
  await expect(page.locator('canvas')).toBeVisible();
}

async function screenOf(page: Page, point: { x: number; y: number; z: number }) {
  return page.evaluate((p) => (window as any).__pvc.screenOf(p), point);
}

test('draws a pipe with real pointer flow and commits a typed exact length', async ({ page }) => {
  const errors = collectErrors(page);
  await openNewDesign(page, 'Interaction typed length');

  await page.keyboard.press('D');
  await page.waitForFunction(() => (window as any).__pvc.getEditor().tool === 'draw');

  const start = await screenOf(page, { x: 0, y: 0, z: 0 });
  const aim = await screenOf(page, { x: 0.35, y: 0, z: 0 });

  await page.mouse.click(start.x, start.y);
  await page.waitForFunction(() => !!(window as any).__pvc.getEditor().drawingFromNodeId);
  await page.mouse.move(aim.x, aim.y, { steps: 8 });
  // NOTE: unit letters other than m are hotkeys now — inches are typed as `"`
  // (or a bare number in the default display unit), never as "in"/"ft".
  await page.keyboard.type('12"');
  await page.keyboard.press('Enter');

  await page.waitForFunction(() => (window as any).__pvc.getMembers().length === 1);
  const drawn = await page.evaluate(() => {
    const p = (window as any).__pvc;
    return {
      editor: p.getEditor(),
      members: p.getMembers(),
    };
  });

  expect(drawn.editor.tool).toBe('draw');
  expect(drawn.editor.drawingFromNodeId).toBeTruthy();
  expect(drawn.members[0].lengthM).toBeCloseTo(12 * IN, 5);

  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).__pvc.getMembers().length)).toBe(1);
  expect(errors).toEqual([]);
});

test('draws ground-plane pipes in both +X and -X with real pointer flow', async ({ page }) => {
  const errors = collectErrors(page);
  await openNewDesign(page, 'Interaction signed X draw');

  await page.keyboard.press('D');
  const start = await screenOf(page, { x: 0, y: 0, z: 0 });
  const plus = await screenOf(page, { x: 0.35, y: 0, z: 0 });
  const minus = await screenOf(page, { x: -0.35, y: 0, z: 0 });

  await page.mouse.click(start.x, start.y);
  await page.mouse.click(plus.x, plus.y);
  await page.keyboard.press('Enter');
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(minus.x, minus.y);
  await page.keyboard.press('Enter');

  await page.waitForFunction(() => (window as any).__pvc.getMembers().length === 2);
  const spans = await page.evaluate(() => {
    const p = (window as any).__pvc;
    const doc = p.getDoc();
    return doc.members.map((m: any) => {
      const a = doc.nodes.find((n: any) => n.id === m.nodeA).position;
      const b = doc.nodes.find((n: any) => n.id === m.nodeB).position;
      return [a.x, b.x].sort((x, y) => x - y);
    });
  });
  expect(spans.some(([a, b]: number[]) => a < -0.3 && Math.abs(b) < 0.02)).toBe(true);
  expect(spans.some(([a, b]: number[]) => Math.abs(a) < 0.02 && b > 0.3)).toBe(true);
  expect(errors).toEqual([]);
});

test('view and snap menus are portal-backed and not clipped by floating chrome', async ({ page }) => {
  const errors = collectErrors(page);
  await openNewDesign(page, 'Interaction view menu');

  await page.getByRole('button', { name: /Views/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Snapping settings/ }).click();
  const snapMenu = page.getByRole('menu');
  await expect(snapMenu).toBeVisible();
  const snapBox = await snapMenu.boundingBox();
  expect(snapBox).not.toBeNull();
  expect(snapBox!.x).toBeGreaterThanOrEqual(0);
  expect(snapBox!.y).toBeGreaterThanOrEqual(0);
  expect(snapBox!.x + snapBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(snapBox!.y + snapBox!.height).toBeLessThanOrEqual(viewport!.height);
  expect(errors).toEqual([]);
});

test('document name edit keeps the document toolbar width stable', async ({ page }) => {
  const errors = collectErrors(page);
  await openNewDesign(page, 'Interaction name width');

  const documentBar = page.locator('[data-floating-island="document-controls"]');
  const before = await documentBar.boundingBox();
  await page.getByLabel('Edit design name').click();
  await expect(page.getByRole('textbox', { name: 'Design name' })).toBeVisible();
  const after = await documentBar.boundingBox();

  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.width - before!.width)).toBeLessThan(2);
  expect(errors).toEqual([]);
});

test('right-drag orbits around the cursor anchor', async ({ page }) => {
  const errors = collectErrors(page);
  await openNewDesign(page, 'Interaction cursor orbit');

  await page.evaluate(() => {
    const p = (window as any).__pvc;
    p.setTool('draw');
    p.draw({ x: -0.3, y: 0, z: 0 });
    p.draw({ x: 0.3, y: 0, z: 0 });
    p.finishPath();
    p.setTool('select');
  });
  const anchor = { x: 0, y: 0, z: 0 };
  const before = await screenOf(page, anchor);
  await page.mouse.move(before.x, before.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(before.x + 120, before.y + 24, { steps: 12 });
  await page.mouse.up({ button: 'right' });
  const after = await screenOf(page, anchor);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(5);
  expect(errors).toEqual([]);
});

test('right-drag orbit keeps an in-progress draw path alive; plain right-click ends it', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openNewDesign(page, 'Interaction orbit vs draw abort');

  await page.keyboard.press('D');
  await page.waitForFunction(() => (window as any).__pvc.getEditor().tool === 'draw');

  const start = await screenOf(page, { x: 0, y: 0, z: 0 });
  const next = await screenOf(page, { x: 0.35, y: 0, z: 0 });
  await page.mouse.click(start.x, start.y);
  await page.waitForFunction(() => !!(window as any).__pvc.getEditor().drawingFromNodeId);
  await page.mouse.click(next.x, next.y);
  await page.waitForFunction(() => (window as any).__pvc.getMembers().length === 1);

  // Right-DRAG well past the slop threshold to orbit — the path must survive.
  await page.mouse.move(next.x + 60, next.y + 60);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(next.x + 180, next.y + 120, { steps: 12 });
  await page.mouse.up({ button: 'right' });
  expect(
    await page.evaluate(() => (window as any).__pvc.getEditor().drawingFromNodeId),
  ).toBeTruthy();

  // Plain right-CLICK (no drag) ends the path as before.
  await page.mouse.click(next.x + 60, next.y + 60, { button: 'right' });
  await page.waitForFunction(() => !(window as any).__pvc.getEditor().drawingFromNodeId);
  expect(await page.evaluate(() => (window as any).__pvc.getMembers().length)).toBe(1);
  expect(errors).toEqual([]);
});

/** Draw one straight pipe along X, select it, and switch to the rotate tool.
 * Returns the pipe's node positions plus a screen point ON the Y ring (a point
 * unique to the Y ring: the X ring lives at x=0, the Z ring at z=0). */
async function setupRotateSelection(page: Page) {
  await page.evaluate(() => {
    const p = (window as any).__pvc;
    p.setTool('draw');
    p.draw({ x: -0.3, y: 0, z: 0 });
    p.draw({ x: 0.3, y: 0, z: 0 });
    p.finishPath();
    p.setTool('select');
    p.setSelection([p.getMembers()[0].id]);
  });
  await page.waitForFunction(() => (window as any).__pvc.getMembers().length === 1);
  await page.keyboard.press('R');
  await page.waitForFunction(() => (window as any).__pvc.getEditor().tool === 'rotate');

  const nodes = await memberNodePositions(page);
  // mirror RotateGizmo's ring sizing: centre + extent of the selection
  const cx = (nodes.a.x + nodes.b.x) / 2;
  const cz = (nodes.a.z + nodes.b.z) / 2;
  const extent = Math.hypot(nodes.b.x - nodes.a.x, nodes.b.z - nodes.a.z) / 2;
  const ringR = Math.max(0.08, Math.min(0.28, Math.max(extent * 1.1, 0.06)));
  const ringPoint = await screenOf(page, {
    x: cx + ringR * Math.SQRT1_2,
    y: 0,
    z: cz + ringR * Math.SQRT1_2,
  });
  return { nodes, ringPoint };
}

async function memberNodePositions(page: Page) {
  return page.evaluate(() => {
    const doc = (window as any).__pvc.getDoc();
    const m = doc.members[0];
    const at = (id: string) => doc.nodes.find((n: any) => n.id === id).position;
    return { a: at(m.nodeA), b: at(m.nodeB) };
  });
}

function yawDeg(n: { a: { x: number; z: number }; b: { x: number; z: number } }): number {
  return (Math.atan2(n.b.z - n.a.z, n.b.x - n.a.x) * 180) / Math.PI;
}

function angleBetweenDeg(before: Awaited<ReturnType<typeof memberNodePositions>>, after: Awaited<ReturnType<typeof memberNodePositions>>): number {
  let d = Math.abs(yawDeg(after) - yawDeg(before));
  if (d > 180) d = 360 - d;
  return d;
}

/** Plain-CLICK the ring until the typed-angle input opens (the gizmo can lag
 * the tool switch by a frame or two; a missed click is harmless — it neither
 * clears the selection nor edits the doc). */
async function openTypedAngle(page: Page, ringPoint: { x: number; y: number }) {
  const input = page.getByLabel('Rotation angle');
  await expect(async () => {
    await page.mouse.click(ringPoint.x, ringPoint.y);
    await expect(input).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  return input;
}

test('rotate tool: ring click opens a typed-angle input; Enter applies one undo entry', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openNewDesign(page, 'Interaction typed rotate');
  const { nodes: before, ringPoint } = await setupRotateSelection(page);

  // a plain CLICK (no drag) on the Y ring opens the angle input for that axis
  const input = await openTypedAngle(page, ringPoint);

  // typing live-previews the rotation before Enter
  await input.pressSequentially('45');
  await expect
    .poll(async () => angleBetweenDeg(before, await memberNodePositions(page)))
    .toBeCloseTo(45, 1);

  await input.press('Enter');
  await expect(input).toBeHidden();
  const after = await memberNodePositions(page);
  expect(angleBetweenDeg(before, after)).toBeCloseTo(45, 5);
  // rigid rotation: the pipe's length is preserved
  const lenOf = (n: typeof before) => Math.hypot(n.b.x - n.a.x, n.b.y - n.a.y, n.b.z - n.a.z);
  expect(lenOf(after)).toBeCloseTo(lenOf(before), 5);

  // the whole typed interaction is ONE undo entry
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => angleBetweenDeg(before, await memberNodePositions(page)))
    .toBeCloseTo(0, 5);
  expect(errors).toEqual([]);
});

test('rotate tool: Escape reverts a typed angle preview exactly', async ({ page }) => {
  const errors = collectErrors(page);
  await openNewDesign(page, 'Interaction typed rotate escape');
  const { nodes: before, ringPoint } = await setupRotateSelection(page);

  const input = await openTypedAngle(page, ringPoint);
  await input.pressSequentially('30');
  await expect
    .poll(async () => angleBetweenDeg(before, await memberNodePositions(page)))
    .toBeCloseTo(30, 1);

  await input.press('Escape');
  await expect(input).toBeHidden();
  // the pre-typed doc is restored verbatim — positions match EXACTLY
  const after = await memberNodePositions(page);
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});

// --- Numeric-entry allow-list: while a typed scene entry is capturing, only m
// --- (mm) is an accepted letter; any other letter, and Space, cancels the
// --- entry/operation AND fires the hotkey it is bound to.

test('typed draw-length entry: V cancels the entry AND switches to the select tool', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openNewDesign(page, 'Interaction entry letter hotkey');

  await page.keyboard.press('D');
  await page.waitForFunction(() => (window as any).__pvc.getEditor().tool === 'draw');
  const start = await screenOf(page, { x: 0, y: 0, z: 0 });
  const aim = await screenOf(page, { x: 0.35, y: 0, z: 0 });
  await page.mouse.click(start.x, start.y);
  await page.waitForFunction(() => !!(window as any).__pvc.getEditor().drawingFromNodeId);
  await page.mouse.move(aim.x, aim.y, { steps: 8 });

  // "1" starts the typed buffer; "m" (the mm unit) is the ONE letter that stays
  await page.keyboard.type('1m');
  await expect(page.getByText('1m▏')).toBeVisible();

  // any other letter cancels the entry + draw path and fires its hotkey
  await page.keyboard.press('v');
  await page.waitForFunction(() => {
    const ed = (window as any).__pvc.getEditor();
    return ed.tool === 'select' && !ed.drawingFromNodeId;
  });
  await expect(page.getByText('1m▏')).toBeHidden(); // typed buffer gone
  // nothing was committed by the cancelled entry
  expect(await page.evaluate(() => (window as any).__pvc.getMembers().length)).toBe(0);
  expect(errors).toEqual([]);
});

test('typed draw-length entry: Space cancels the entry and fires the Space hotkey (select tool)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openNewDesign(page, 'Interaction entry space hotkey');

  await page.keyboard.press('D');
  await page.waitForFunction(() => (window as any).__pvc.getEditor().tool === 'draw');
  const start = await screenOf(page, { x: 0, y: 0, z: 0 });
  const aim = await screenOf(page, { x: 0.35, y: 0, z: 0 });
  await page.mouse.click(start.x, start.y);
  await page.waitForFunction(() => !!(window as any).__pvc.getEditor().drawingFromNodeId);
  await page.mouse.move(aim.x, aim.y, { steps: 8 });

  await page.keyboard.type('12');
  await expect(page.getByText('12▏')).toBeVisible();

  // Space is bound to "back to the select tool" — it must fire, not type a space
  await page.keyboard.press(' ');
  await page.waitForFunction(() => {
    const ed = (window as any).__pvc.getEditor();
    return ed.tool === 'select' && !ed.drawingFromNodeId;
  });
  expect(await page.evaluate(() => (window as any).__pvc.getMembers().length)).toBe(0);
  expect(errors).toEqual([]);
});

test('rotate typed-angle input: D reverts the preview AND switches to the draw tool', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openNewDesign(page, 'Interaction entry rotate letter');
  const { nodes: before, ringPoint } = await setupRotateSelection(page);

  const input = await openTypedAngle(page, ringPoint);
  await input.pressSequentially('4');
  // the 4° live preview must be applied before we cancel it
  await expect
    .poll(async () => angleBetweenDeg(before, await memberNodePositions(page)))
    .toBeCloseTo(4, 1);

  // a disallowed letter closes+reverts the entry and its hotkey fires
  await input.press('d');
  await expect(input).toBeHidden();
  await page.waitForFunction(() => (window as any).__pvc.getEditor().tool === 'draw');
  // the pre-typed doc is restored verbatim — positions match EXACTLY
  const after = await memberNodePositions(page);
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});

test('opens the join menu with a real right-click and creates a wrapped pivot', async ({ page }) => {
  const errors = collectErrors(page);
  await openNewDesign(page, 'Interaction right-click join');

  await page.evaluate(() => {
    const p = (window as any).__pvc;
    const v = (x: number, z: number) => ({ x, y: 0, z });
    p.setTool('draw');
    p.draw(v(-0.3, 0));
    p.draw(v(0, 0));
    p.draw(v(0, 0.3));
    p.finishPath();
    p.setTool('select');
  });
  await page.waitForFunction(() => (window as any).__pvc.getMembers().length === 2);

  const nearCornerOnPipe = await screenOf(page, { x: -0.03, y: 0, z: 0 });
  await page.mouse.click(nearCornerOnPipe.x, nearCornerOnPipe.y, { button: 'right' });

  await expect(page.getByText('Pipe join')).toBeVisible();
  await page.getByRole('button', { name: /Wrapped pivot/ }).click();

  await page.waitForFunction(() =>
    (window as any).__pvc.getJoints().some((j: any) => j.mode === 'wrapped'),
  );
  const joined = await page.evaluate(() => {
    const p = (window as any).__pvc;
    const joints = p.getJoints();
    const fittings = p.getFittings();
    return {
      joints: joints.map((j: any) => ({
        mode: j.mode,
        onBody: j.onBody,
        receiver: j.receiver,
        mover: j.mover,
      })),
      conflicts: fittings.conflicts.length,
    };
  });

  expect(joined.joints).toHaveLength(1);
  expect(joined.joints[0].mode).toBe('wrapped');
  expect(joined.joints[0].onBody).toBe(false);
  expect(joined.conflicts).toBe(0);
  expect(errors).toEqual([]);
});
