import { expect, test } from '@playwright/test';

// Scripted verification through window.__pvc (planfile §7/§11): assert state in
// one page.evaluate; no gesture driving.

test('draw → fittings → BOM → JSON round-trip → joints, on the built app', async ({ page }) => {
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
      JSON.stringify({ nodes: d.nodes, members: d.members, joints: d.joints });
    const before = geom(p.getDoc());
    const json = p.exportJson();
    await p.importJson(json);
    return { before, after: geom(p.getDoc()) };
  });
  expect(roundtrip.after).toBe(roundtrip.before);

  // wrapped pivot: right-click join at the corner → 1-DOF revolute pose
  const wrapped = await page.evaluate(() => {
    const p = (window as any).__pvc;
    const doc = p.getDoc();
    const mid = doc.members[0].nodeB;
    p.setJoinMode(mid, doc.members[0].id, 'wrapped');
    p.setLengthsLocked(true);
    const j = p.getDoc().joints[0];
    p.setPivotAngle(j.id, Math.PI / 4);
    const s = p.getSolve();
    return { joints: p.getDoc().joints.length, mode: j.mode, dof: s.diagnostics.mobilityDof };
  });
  expect(wrapped.joints).toBe(1);
  expect(wrapped.mode).toBe('wrapped');
  expect(wrapped.dof).toBe(1);

  // switch the same join to a FREE ball joint → 3-DOF spherical pose
  const free = await page.evaluate(() => {
    const p = (window as any).__pvc;
    const doc = p.getDoc();
    const mid = doc.members[0].nodeB;
    p.setJoinMode(mid, doc.members[0].id, 'free');
    const j = p.getDoc().joints[0];
    const s = p.getSolve();
    return { mode: j.mode, dof: s.diagnostics.mobilityDof };
  });
  expect(free.mode).toBe('free');
  expect(free.dof).toBe(3);

  expect(errors).toEqual([]);
});
