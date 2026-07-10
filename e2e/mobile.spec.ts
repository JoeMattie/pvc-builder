import { expect, type Page, test } from '@playwright/test';

async function openDesign(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('New design name').fill(name);
  await page.getByRole('button', { name: /Create/ }).click();
  await page.waitForFunction(() => !!(window as any).__pvc?.screenOf);
}

test('compact editor owns its viewport and exposes touch-sized commands', async ({ page }) => {
  await openDesign(page, `Mobile layout ${test.info().project.name}`);

  const layout = await page.evaluate(() => (window as any).__pvc.getResponsiveLayout());
  const viewport = page.viewportSize()!;
  expect(layout.compactWidth).toBe(viewport.width < 640);
  expect(layout.veryNarrow).toBe(viewport.width < 360);
  expect(layout.shortViewport).toBe(viewport.height < 720);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport.width,
  );
  const outside = await page.locator('[data-viewport-occluder], [data-floating-island]').evaluateAll(
    (elements) =>
      elements
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            (rect.left < -1 ||
              rect.top < -1 ||
              rect.right > window.innerWidth + 1 ||
              rect.bottom > window.innerHeight + 1)
          );
        })
        .map((element) => (element as HTMLElement).dataset.floatingIsland ?? element.tagName),
  );
  expect(outside).toEqual([]);

  if (viewport.width < 640) {
    const primary = page.locator('[data-mobile-primary-tools] button');
    if (viewport.width < 360 || viewport.height < 720) {
      await expect(primary).toHaveCount(5);
      for (const button of await primary.all()) {
        const box = await button.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
    }

    await page.getByLabel('Mobile commands').click();
    await expect(page.getByRole('dialog', { name: 'Commands' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export design' })).toBeAttached();
    await page.keyboard.press('Escape');
  }
});

test('touch draws an exact-length pipe and navigation does not mutate the document', async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 999) >= 640, 'phone compact controls');
  await openDesign(page, `Mobile touch ${test.info().project.name}`);

  const bottomStrip = page.locator('[data-mobile-primary-tools]');
  if (await bottomStrip.isVisible())
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
  else await page.evaluate(() => (window as any).__pvc.setTool('draw'));

  const start = await page.evaluate(() => (window as any).__pvc.screenOf({ x: 0, y: 0, z: 0 }));
  const aim = await page.evaluate(() => (window as any).__pvc.screenOf({ x: 0.3, y: 0, z: 0 }));
  await page.touchscreen.tap(start.x, start.y);
  await page.mouse.move(aim.x, aim.y);
  await page.getByRole('button', { name: 'Exact length' }).click();
  await page.getByLabel('Exact pipe length').fill('12"');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const result = await page.evaluate(() => {
    const pvc = (window as any).__pvc;
    return { count: pvc.getMembers().length, length: pvc.getMembers()[0]?.lengthM };
  });
  expect(result.count).toBe(1);
  expect(result.length).toBeCloseTo(0.3048, 4);

  const before = await page.evaluate(() => JSON.stringify((window as any).__pvc.getDoc()));
  await page.getByRole('button', { name: 'Orbit', exact: true }).click();
  await page.touchscreen.tap(aim.x, aim.y);
  const after = await page.evaluate(() => JSON.stringify((window as any).__pvc.getDoc()));
  expect(after).toBe(before);

  await page.evaluate(() => {
    const pvc = (window as any).__pvc;
    pvc.setMobileMultiSelect(true);
    pvc.setNavigationMode('edit');
  });
  expect(await page.evaluate(() => (window as any).__pvc.getEditor().mobileMultiSelect)).toBe(true);
});
