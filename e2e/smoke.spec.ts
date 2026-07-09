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

  // elastic band: place a pre-tensioned band between the L's two far ends via the
  // two-click seams, retune its tension, then simulate and confirm it pulls them
  // together (positions stay finite)
  const band = await page.evaluate(async () => {
    const p = (window as any).__pvc;
    const doc = p.getDoc();
    const nA = doc.nodes.find((n: any) => n.id === doc.members[0].nodeA);
    const nB = doc.nodes.find((n: any) => n.id === doc.members[1].nodeB);
    p.setLengthsLocked(false);
    p.setTool('elastic');
    p.placeElastic({ x: nA.position.x, y: nA.position.y, z: nA.position.z });
    p.placeElastic({ x: nB.position.x, y: nB.position.y, z: nB.position.z });
    const els = p.getElastics();
    const id = els[0]?.id;
    p.setElasticTension(id, 300);
    const dist = (r: any) =>
      Math.hypot(
        r[nA.id].x - r[nB.id].x,
        r[nA.id].y - r[nB.id].y,
        r[nA.id].z - r[nB.id].z,
      );
    p.setSimulating(true);
    await new Promise((res) => setTimeout(res, 200));
    const g0 = dist(p.getPhysics());
    await new Promise((res) => setTimeout(res, 900));
    const g1 = dist(p.getPhysics());
    p.setSimulating(false);
    return {
      count: els.length,
      tension: p.getElastics()[0]?.stiffnessNPerM,
      g0,
      g1,
      finite: Number.isFinite(g1),
    };
  });
  expect(band.count).toBe(1);
  expect(band.tension).toBe(300);
  expect(band.finite).toBe(true);
  expect(band.g1).toBeLessThan(band.g0); // the band pulled the ends together

  expect(errors).toEqual([]);
});
