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
  await page.keyboard.type('12in');
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
