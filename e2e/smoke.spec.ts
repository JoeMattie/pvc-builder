import { expect, test } from '@playwright/test';

// Scripted verification through window.__pvc (planfile §7/§11): assert state in
// one page.evaluate; no gesture driving.

test('draw → fittings → BOM → JSON round-trip → pivot, on the built app', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await page.getByPlaceholder('New design name…').fill('Smoke');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForFunction(() => (window as any).__pvc?.getDoc?.() !== null);

  // draw an L of 3/4" pipe → one 90° elbow, two cut items
  const drawn = await page.evaluate(() => {
    const p = (window as any).__pvc;
    const V = (x: number, z: number) => ({ x, y: 0, z });
    p.setTool('draw');
    p.setDrawSize('3/4"');
    p.draw(V(-0.3, 0));
    p.draw(V(0, 0));
    p.draw(V(0, 0.3));
    p.finishPath();
    p.setTool('select');
    const fit = p.getFittings();
    const b = p.getBom();
    return {
      members: p.getMembers().length,
      elbows: fit.fittings.filter((f: any) => f.type === 'elbow90').length,
      cuts: b.cuts.length,
    };
  });
  expect(drawn.members).toBe(2);
  expect(drawn.elbows).toBe(1);
  expect(drawn.cuts).toBe(2);

  // JSON export → import → geometry is identical (round-trips stably)
  const roundtrip = await page.evaluate(async () => {
    const p = (window as any).__pvc;
    const geom = (d: any) =>
      JSON.stringify({ nodes: d.nodes, members: d.members, pivots: d.pivots });
    const before = geom(p.getDoc());
    const json = p.exportJson();
    await p.importJson(json);
    return { before, after: geom(p.getDoc()) };
  });
  expect(roundtrip.after).toBe(roundtrip.before);

  // pivot: lock lengths, add a pivot at the corner, set an angle → 1-DOF pose
  const pivot = await page.evaluate(() => {
    const p = (window as any).__pvc;
    const mid = p.getDoc().members[0].nodeB;
    p.createPivotAt(mid);
    p.setLengthsLocked(true);
    const pv = p.getDoc().pivots[0];
    p.setPivotAngle(pv.id, Math.PI / 4);
    const s = p.getSolve();
    return { pivots: p.getDoc().pivots.length, dof: s.diagnostics.mobilityDof };
  });
  expect(pivot.pivots).toBe(1);
  expect(pivot.dof).toBe(1);

  expect(errors).toEqual([]);
});
