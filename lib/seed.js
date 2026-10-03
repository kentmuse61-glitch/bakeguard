'use strict';
// Demo seeder — generates a plausible week of history so the COO brain has a baseline.
const { todayStr } = require('./store');
const { vStatus, variancePct } = require('./rules');

let _id = 0;
const uid = () => 'seed' + Date.now().toString(36) + (_id++).toString(36);

function dateOffset(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function rnd(min, max) { return min + Math.random() * (max - min); }

function addProd(state, date, site, bags, actuals) {
  const yieldPer = state.params.sites[site].yield;
  const per = bags / actuals.length;
  actuals.forEach((actual, i) => {
    const expected = per * yieldPer;
    const variance = expected - actual;
    const vp = variancePct(expected, actual);
    state.production.push({
      id: uid(), date, site, session: i + 1, bags: Math.round(per * 10) / 10,
      expected: Math.round(expected), actual, variance: Math.round(variance),
      variancePct: Math.round(vp * 10) / 10, status: vStatus(state, site, vp),
      reason: null, reasonTs: null, ts: new Date(date + 'T07:00:00Z').toISOString(),
    });
  });
}

function addTrip(state, date, driver, dispatched, forceGapPct) {
  const cash = Math.round(dispatched * rnd(0.68, 0.85));
  const ret = Math.max(0, Math.round(dispatched * rnd(0, 0.01)));
  let cr = dispatched - cash - ret; // fully accounted by default
  let gapPct = 0;
  if (forceGapPct != null) { cr = Math.max(0, cr - Math.round(dispatched * forceGapPct / 100)); gapPct = forceGapPct; }
  const short = dispatched - cash - cr - ret;
  state.trips.push({
    id: uid(), date, driver, trip: Math.floor(Math.random() * 2) + 1,
    dispatched, cashLoaves: cash, crLoaves: cr, retLoaves: ret,
    short, shortPct: Math.round(gapPct * 10) / 10,
    status: gapPct > 1 ? 'short' : 'ok',
    ts: new Date(date + 'T11:00:00Z').toISOString(),
  });
}

function seedDemo(state) {
  state.production = []; state.trips = []; state.stockLog = [];
  state.kioskDebt = []; state.alerts = []; state.log = [];
  state.params.sites.MAM.price = 1.5;
  state.params.sites.NKZ.price = 1.5;
  state.params.sites.TCH.price = 1.5;

  for (let off = 7; off >= 1; off--) {
    const date = dateOffset(off);
    // MAM: 80 bags / 2 sessions of 40
    const mam = [Math.round(4000 + rnd(-120, 90)), Math.round(4000 + rnd(-120, 90))];
    if (off === 3) mam[1] = Math.round(4000 * 0.93); // one critical day last week (resolved below)
    addProd(state, date, 'MAM', 80, mam);
    addProd(state, date, 'NKZ', 20, [Math.round(2000 + rnd(-90, 70))]);
    addProd(state, date, 'TCH', 20, [Math.round(2000 + rnd(-110, 80))]);

    const dispM = Math.round(7700 + rnd(-150, 150));
    const dispN = Math.round(1950 + rnd(-60, 60));
    const dispT = Math.round(1900 + rnd(-70, 70));
    addTrip(state, date, 'KSI', Math.round(dispM * 0.5));
    addTrip(state, date, 'KAN', dispM - Math.round(dispM * 0.5), off === 5 ? 3.5 : undefined); // one shortage day
    addTrip(state, date, 'AKU', dispN);
    addTrip(state, date, 'TET', dispT);

    state.stockLog.push(
      { date, site: 'MAM', bags: 250 - Math.round(off * 3), ts: new Date(date + 'T08:00:00Z').toISOString() },
      { date, site: 'NKZ', bags: 48 - Math.round(off * 1), ts: new Date(date + 'T08:00:00Z').toISOString() },
      { date, site: 'TCH', bags: 12, ts: new Date(date + 'T08:00:00Z').toISOString() },
    );
  }

  // Today: partial day (MAM session 1 baked, NKZ + TCH done, some trips in)
  const today = todayStr();
  addProd(state, today, 'MAM', 40, [Math.round(4000 + rnd(-80, 60))]);
  addProd(state, today, 'NKZ', 20, [Math.round(2000 + rnd(-70, 60))]);
  addProd(state, today, 'TCH', 20, [Math.round(2000 + rnd(-90, 70))]);
  addTrip(state, today, 'KSI', 3900);
  addTrip(state, today, 'AKU', 1980);
  addTrip(state, today, 'TET', 1930);
  state.stockLog.push(
    { date: today, site: 'MAM', bags: 240, ts: new Date().toISOString() },
    { date: today, site: 'NKZ', bags: 45, ts: new Date().toISOString() },
    { date: today, site: 'TCH', bags: 12, ts: new Date().toISOString() },
  );

  // Kiosk debt ledger — one overdue (4 days), one fresh
  state.kioskDebt.push(
    { kiosk: 'ADU KIOSK', issued: dateOffset(4), outstanding: 350, payments: [], ts: new Date().toISOString() },
    { kiosk: 'CIRCLE KIOSK', issued: dateOffset(2), outstanding: 180, payments: [{ amount: 120, date: dateOffset(1) }], ts: new Date().toISOString() },
    { kiosk: 'TECHI CENTRAL', issued: dateOffset(1), outstanding: 220, payments: [], ts: new Date().toISOString() },
  );

  // Regenerate consistent alerts: past variances (resolved with reasons), driver gap, low stock
  const reasons = ['Scale recalibrated after check.', 'Oven door seal worn — replaced.', 'New baker training loss, improving.'];
  let ri = 0;
  for (const p of state.production) {
    if (p.status !== 'ok' && p.date < today) {
      p.reason = reasons[ri++ % reasons.length];
      p.reasonTs = new Date(p.date + 'T09:00:00Z').toISOString();
      state.alerts.unshift({
        id: uid(), date: p.date, ts: p.reasonTs,
        level: p.status === 'critical' ? 'critical' : 'warn',
        type: 'variance',
        title: `${p.status === 'critical' ? '🚨 CRITICAL YIELD' : '⚠️ Minor loss'} — ${state.params.sites[p.site].name} S${p.session}`,
        body: `Expected ${p.expected}, actual ${p.actual} → ${p.variance} loaves (${p.variancePct}%).`,
        site: p.site, session: p.session, resolved: true, resolution: p.reason,
      });
    }
  }
  for (const t of state.trips) {
    if (t.status === 'short' && t.date < today) {
      state.alerts.unshift({
        id: uid(), date: t.date, ts: t.ts, level: 'critical', type: 'driver',
        title: `🚨 DRIVER SHORTAGE — ${t.driver}`,
        body: `Trip ${t.trip}: dispatched ${t.dispatched}, accounted ${t.dispatched - t.short} → short ${t.short}. Recount confirmed 6 returns not declared; driver briefed.`,
        driver: t.driver, resolved: true, resolution: 'Returns recount — driver briefed.',
      });
    }
  }
  state.alerts.unshift(
    { id: uid(), date: today, ts: new Date().toISOString(), level: 'critical', type: 'stock', title: '🚨 Flour low — TCH (12 bags)', body: 'Supplier: please deliver 30 bags of flour to Techiman (Bono East) this week. Current stock 12 bags ≈ 0.6 days of cover. — HOPE Special Bread', site: 'TCH', resolved: false },
    { id: uid(), date: today, ts: new Date().toISOString(), level: 'warn', type: 'stock', title: '⚠️ Flour low — NKZ (45 bags)', body: 'Supplier: please deliver 15 bags of flour to Nkoranza (Bono East) this week. Current stock 45 bags ≈ 2.2 days of cover. — HOPE Special Bread', site: 'NKZ', resolved: false },
  );
  return state;
}

module.exports = { seedDemo };
