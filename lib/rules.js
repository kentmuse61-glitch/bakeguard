'use strict';
// BakeGuard Golden Rules engine — the COO's brain.
const { todayStr } = require('./store');
const { parseMessage } = require('./parser');

let _id = 0;
const uid = () => Date.now().toString(36) + '-' + (_id++).toString(36);

const fmt = n => Math.round(n).toLocaleString('en-US');
const round1 = n => Math.round(n * 10) / 10;
const variancePct = (exp, act) => (exp > 0 ? ((exp - act) / exp) * 100 : 0);
// Thresholds are read from Admin-editable parameters (never hardcoded in the engine).
const vStatus = (state, code, p) => {
  const sites = state.params.sites || {};
  const s = code && sites[code] ? sites[code] : null;
  const codes = Object.keys(sites);
  const minor = s && s.varMinor != null ? s.varMinor : (codes.length ? Math.max(...codes.map(c => sites[c].varMinor ?? 2)) : 2);
  const crit = s && s.varCrit != null ? s.varCrit : (codes.length ? Math.max(...codes.map(c => sites[c].varCrit ?? 5)) : 5);
  return p <= minor ? 'ok' : p <= crit ? 'minor' : 'critical';
};

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

// The audit log IS the parameter history: replay changes made after `date` in reverse
// so every past day keeps the values it actually ran with (going-forward-only rule).
function paramsAsOf(state, date) {
  const log = state.paramLog || [];
  if (!date || !log.length) return state.params;
  const cutoff = Date.parse(date + 'T23:59:59.999Z');
  const p = JSON.parse(JSON.stringify(state.params));
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (Date.parse(e.ts) <= cutoff) break;
    if (e.scope === 'network') p.network[e.field] = e.old;
    else if (p.sites && p.sites[e.scope]) p.sites[e.scope][e.field] = e.old;
  }
  return p;
}
const asOfState = (state, date) => {
  const p = paramsAsOf(state, date);
  return p === state.params ? state : { ...state, params: p };
};

function siteStats(state, site, date) {
  const rows = state.production.filter(r => r.site === site && r.date === date);
  const bags = rows.reduce((s, r) => s + r.bags, 0);
  const expected = rows.reduce((s, r) => s + r.expected, 0);
  const actual = rows.reduce((s, r) => s + r.actual, 0);
  const variance = expected - actual;
  return { bags, expected, actual, variance, variancePct: variancePct(expected, actual), status: vStatus(state, site, variancePct(expected, actual)) };
}

function dayTrips(state, date) { return state.trips.filter(t => t.date === date); }

function siteStock(state, site) {
  const rows = state.stockLog.filter(r => r.site === site).sort((a, b) => a.ts.localeCompare(b.ts));
  return rows.length ? rows[rows.length - 1].bags : null;
}

function avgDailyBags(state, site, days = 7) {
  const byDate = {};
  for (const r of state.production) if (r.site === site) byDate[r.date] = (byDate[r.date] || 0) + r.bags;
  const dates = Object.keys(byDate).sort().slice(-days);
  if (!dates.length) return null;
  return dates.reduce((s, d) => s + byDate[d], 0) / dates.length;
}

function daysOfCover(state, site) {
  const stock = siteStock(state, site);
  if (stock == null) return null;
  const avg = avgDailyBags(state, site);
  if (!avg) return null;
  return stock / avg;
}

function lastNDates(state, n, end) {
  const set = new Set();
  const lim = end || todayStr();
  for (const r of state.production) if (r.date <= lim) set.add(r.date);
  for (const t of state.trips) if (t.date <= lim) set.add(t.date);
  return [...set].sort().slice(-n);
}

function carriedSurplus(state, date) {
  // Rolling buffer of unaccounted loaves from the last 7 days (conservative upper bound).
  const dates = lastNDates(state, 7, date).filter(d => d < date);
  let carry = 0;
  for (const d of dates) {
    const prod = Object.keys(state.params.sites).reduce((s, c) => s + siteStats(state, c, d).actual, 0);
    const disp = dayTrips(state, d).reduce((s, t) => s + t.dispatched, 0);
    carry += Math.max(0, prod - disp);
  }
  return carry;
}

function priceFor(state, site) {
  // Site-specific price wins; else inherit network default (marked as assumption).
  const p = (state.params.sites[site] || {}).price;
  if (p != null) return { price: p, assumed: false };
  const n = (state.params.network || {}).price;
  if (n != null) return { price: n, assumed: true };
  return { price: null, assumed: false };
}

function anyPrice(state) {
  const n = (state.params.network || {}).price;
  if (n != null) return n;
  const prices = Object.values(state.params.sites).map(s => s.price).filter(p => p != null);
  if (!prices.length) return null;
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

function driverPrice(state, driver, date) {
  // Price a driver's cash at the site he loads/sells for; fall back to the
  // production-weighted network price when no mapping exists.
  const site = (state.params.drivers || {})[driver];
  if (site) {
    const pf = priceFor(state, site);
    if (pf.price != null) return { price: pf.price, assumed: pf.assumed, site };
  }
  const pi = networkPrice(state, date);
  return { price: pi.price, assumed: pi.assumed, site: null };
}

function networkPrice(state, date) {
  // Production-weighted price across sites (resolving per-site → network inheritance).
  let num = 0, den = 0, anyAssumed = false;
  for (const code of Object.keys(state.params.sites)) {
    const pf = priceFor(state, code);
    if (pf.price == null) continue;
    if (pf.assumed) anyAssumed = true;
    const st = siteStats(state, code, date);
    num += st.actual * pf.price; den += st.actual;
  }
  if (den > 0) return { price: num / den, assumed: anyAssumed };
  const a = anyPrice(state);
  return { price: a, assumed: a != null && (state.params.network || {}).price != null };
}

function kioskAging(state, date) {
  const ref = date || todayStr();
  const n = asOfState(state, ref).params.network || {};
  const alertDays = n.debtDays || 3, escDays = n.debtEscalateDays || 7;
  return state.kioskDebt.map(k => {
    const days = daysBetween(k.issued, ref);
    return { ...k, days, overdue: k.outstanding > 0 && days > alertDays, escalate: k.outstanding > 0 && days > escDays, noCredit: k.outstanding > 0 && days > alertDays };
  });
}

// ---------------- data-gap escalation chain (9 PM nudge → 10 PM blind spot) --

function siteHasData(state, site, date) {
  if (state.production.some(r => r.site === site && r.date === date)) return true;
  if (state.stockLog.some(r => r.site === site && r.date === date)) return true;
  return false;
}

function runDataGapNudge(state, now = new Date()) {
  // Called at 21:00 (Ghana time = UTC). Nudges every silent site once per day.
  const date = now.toISOString().slice(0, 10);
  const events = [];
  for (const code of Object.keys(state.params.sites)) {
    if (siteHasData(state, code, date)) continue;
    if (state.delayedAcks.some(d => d.site === code && d.date === date)) continue;
    if (state.nudges.some(n => n.site === code && n.date === date)) continue;
    const msg = `BakeGuard: No data received for ${state.params.sites[code].name} today. Reply with today's totals or 'DELAYED' with reason.`;
    state.nudges.push({ id: uid(), date, site: code, ts: now.toISOString(), text: msg, delivered: false });
    events.push({ site: code, text: msg });
  }
  return events;
}

function siteBlindSpot(state, site, date) {
  // 'blind' = nudged at 9 PM and still silent · 'delayed' = manager reported DELAYED · null = fine/pre-9pm
  if (date !== todayStr()) return null;
  if (siteHasData(state, site, date)) return null;
  const ack = state.delayedAcks.find(d => d.site === site && d.date === date);
  if (ack) return { level: 'delayed', reason: ack.reason };
  if (state.nudges.some(n => n.site === site && n.date === date)) return { level: 'blind' };
  return null;
}

function daySummary(state, date) {
  const st = asOfState(state, date); // past days keep the parameter values they ran with
  const sites = {};
  for (const code of Object.keys(st.params.sites)) {
    const sp = st.params.sites[code] || {};
    const prod = siteStats(st, code, date);
    const stock = siteStock(st, code);
    const cover = daysOfCover(st, code);
    const lowBags = sp.reorder != null ? sp.reorder : 20;
    const coverT = sp.coverTarget != null ? sp.coverTarget : 3;
    sites[code] = {
      ...prod, stock, cover,
      low: stock != null && (stock < lowBags || (cover != null && cover < coverT)),
      sessions: st.production.filter(r => r.site === code && r.date === date),
    };
  }
  const net = { bags: 0, expected: 0, actual: 0 };
  for (const c of Object.keys(sites)) { net.bags += sites[c].bags; net.expected += sites[c].expected; net.actual += sites[c].actual; }
  net.variance = net.expected - net.actual;
  net.variancePct = variancePct(net.expected, net.actual);
  net.status = vStatus(st, null, net.variancePct);

  const trips = dayTrips(st, date);
  const dispatched = trips.reduce((s, t) => s + t.dispatched, 0);
  const cashLoaves = trips.reduce((s, t) => s + t.cashLoaves, 0);
  const crLoaves = trips.reduce((s, t) => s + t.crLoaves, 0);
  const retLoaves = trips.reduce((s, t) => s + t.retLoaves, 0);
  const priceInfo = networkPrice(st, date);
  const price = priceInfo.price;

  const drivers = {};
  for (const t of trips) {
    const d = drivers[t.driver] = drivers[t.driver] || { driver: t.driver, trips: 0, dispatched: 0, cash: 0, cr: 0, ret: 0 };
    d.trips++; d.dispatched += t.dispatched; d.cash += t.cashLoaves; d.cr += t.crLoaves; d.ret += t.retLoaves;
  }
  for (const d of Object.values(drivers)) {
    d.accounted = d.cash + d.cr + d.ret;
    d.gap = d.dispatched - d.accounted;
    d.gapPct = d.dispatched > 0 ? (d.gap / d.dispatched) * 100 : 0;
    const dCode = (st.params.drivers || {})[d.driver];
    const dSite = dCode && st.params.sites[dCode] ? st.params.sites[dCode] : null;
    const gapTh = dSite && dSite.driverGap != null ? dSite.driverGap : 1;
    d.status = d.gapPct > gapTh ? 'short' : 'ok';
    const dp = driverPrice(st, d.driver, date);
    d.ghs = dp.price != null ? Math.round(d.cash * dp.price) : null;
  }
  return { date, sites, net, trips, dispatched, cashLoaves, crLoaves, retLoaves, price, priceAssumed: priceInfo.assumed, drivers, debt: kioskAging(st, date) };
}

function readinessScore(state, date) {
  const ref = date || todayStr();
  const q = asOfState(state, ref); // past dates keep the parameter values they ran with
  const dates = lastNDates(q, 7, ref);
  let exp = 0, act = 0, disp = 0, acc = 0;
  for (const d of dates) {
    for (const code of Object.keys(q.params.sites)) {
      const ss = siteStats(q, code, d);
      exp += ss.expected; act += ss.actual;
    }
    for (const t of dayTrips(q, d)) { disp += t.dispatched; acc += t.cashLoaves + t.crLoaves + t.retLoaves; }
  }
  const vp = exp > 0 ? ((exp - act) / exp) * 100 : 2;
  const accPct = disp > 0 ? (acc / disp) * 100 : 99;
  const open = q.kioskDebt.filter(k => k.outstanding > 0);
  const oldest = open.length ? Math.max(...open.map(k => daysBetween(k.issued, ref))) : 0;
  const covers = Object.keys(q.params.sites).map(c => daysOfCover(q, c)).filter(c => c != null);
  const minCover = covers.length ? Math.min(...covers) : 3;

  // readiness bands track the Admin-set thresholds
  const sitesP = q.params.sites, codes = Object.keys(sitesP);
  const vm = codes.length ? Math.max(...codes.map(c => sitesP[c].varMinor ?? 2)) : 2;
  const vc = codes.length ? Math.max(...codes.map(c => sitesP[c].varCrit ?? 5)) : 5;
  const netP = q.params.network || {};
  const dd = netP.debtDays || 3, de = netP.debtEscalateDays || 7;
  const coverT = codes.length ? codes.reduce((a, c) => a + (sitesP[c].coverTarget ?? 3), 0) / codes.length : 3;

  let score = 0;
  const detail = {
    variance: { pts: vp <= vm ? 40 : vp <= vc ? 20 : 0, max: 40, value: round1(vp) },
    accountability: { pts: accPct >= 99 ? 30 : accPct >= 97 ? 15 : 0, max: 30, value: round1(accPct) },
    debt: { pts: oldest <= dd ? 20 : oldest <= de ? 10 : 0, max: 20, value: oldest },
    cover: { pts: minCover >= coverT ? 10 : 5, max: 10, value: round1(minCover) },
  };
  score = detail.variance.pts + detail.accountability.pts + detail.debt.pts + detail.cover.pts;

  // CEO insight + action: worst signal first, honest but encouraging.
  let insight, action;
  const today = daySummary(q, ref);
  const critSite = Object.values(today.sites).find(s => s.status === 'critical' && s.bags > 0);
  const shortDriver = Object.values(today.drivers).find(d => d.status === 'short');
  const lowSite = Object.values(today.sites).find(s => s.low);

  if (critSite) {
    const name = q.params.sites[Object.keys(today.sites).find(c => today.sites[c] === critSite)].name;
    insight = `Variance at ${name} is ${critSite.variancePct.toFixed(1)}% — do not scale until this is fixed.`;
    const flagged = critSite.sessions.find(x => x.status === 'critical');
    action = flagged ? `Investigate ${flagged.site || ''} session S${flagged.session} (scale, oven, staff) and log the reason with REASON.` : `Investigate today's bake at ${name} and log the reason.`;
  } else if (shortDriver) {
    insight = `Driver accountability at ${100 - shortDriver.gapPct.toFixed(1)}% — close the ${shortDriver.gap}-loaf gap with ${shortDriver.driver} before adding routes.`;
    action = `Ask ${shortDriver.driver} to recount returns and verify the next load; log the outcome.`;
  } else if (lowSite) {
    const lc = Object.keys(today.sites).find(c => today.sites[c] === lowSite);
    const name = q.params.sites[lc].name;
    const lt = (q.params.sites[lc].coverTarget != null ? q.params.sites[lc].coverTarget : 3);
    insight = `Flour cover at ${name} is below ${lt} days — supply risk, not a scaling problem, but it caps tomorrow's output.`;
    action = 'Send the reorder draft in the Stock tab to the supplier today.';
  } else if (score >= 80) {
    insight = 'The system is stable and trending clean — the numbers support adding capacity.';
    action = 'Deploy the next driver or open the next branch; keep daily logs flowing so readiness stays visible.';
  } else {
    const weakest = Object.entries(detail).sort((a, b) => (a[1].pts / a[1].max) - (b[1].pts / b[1].max))[0];
    const map = { variance: `bring average variance under ${vm}%`, accountability: 'get driver accountability to 99%', debt: 'collect the oldest kiosk debt', cover: 'top up flour at the lowest site' };
    insight = `Operations are holding but not scale-ready yet (${score}/100). Biggest gap: ${weakest[0]}.`;
    action = `Focus the next 3 days on ${map[weakest[0]]}.`;
  }
  return { score, detail, insight, action };
}

function forecast(state, date) {
  const ref = date || todayStr();
  const dates = lastNDates(state, 7, ref).filter(d => d < ref);
  if (!dates.length) return { production: null, dispatch: null, cashGHS: null, note: 'No history before this date yet — forecast activates after a few days of logs.' };
  const price = anyPrice(state);
  let bags = 0, actual = 0, disp = 0, cash = 0;
  for (const d of dates) {
    for (const code of Object.keys(state.params.sites)) {
      const st = siteStats(state, code, d);
      bags += st.bags; actual += st.actual;
    }
    for (const t of dayTrips(state, d)) { disp += t.dispatched; cash += t.cashLoaves; }
  }
  const n = dates.length;
  return {
    production: Math.round(actual / n),
    dispatch: Math.round(disp / n),
    bags: Math.round(bags / n),
    cashGHS: price != null ? Math.round((cash / n) * price) : null,
    note: `Based on a ${n}-day average. If tonight's panned dough differs, expect a proportional move.`,
  };
}

// ---------------------------------------------------------------- ingest --

function ingest(state, { from, text }) {
  const date = todayStr();
  const parsed = parseMessage(text);
  const events = [];

  const alert = (level, type, title, body, meta = {}) => {
    const a = { id: uid(), date, ts: new Date().toISOString(), level, type, title, body, ...meta };
    state.alerts.unshift(a);
    if (state.alerts.length > 500) state.alerts.length = 500;
    events.push({ id: a.id, title: a.title, level: a.level, body: a.body });
    return a;
  };

  let reply = '';

  switch (parsed.type) {
    case 'PROD': {
      const s = state.params.sites[parsed.site];
      const per = parsed.bags / parsed.sessions.length;
      const parts = [];
      let anyCritical = false, anyMinor = false;
      for (const sess of parsed.sessions) {
        const expected = per * s.yield;
        const actual = sess.loaves;
        const variance = expected - actual;
        const vp = variancePct(expected, actual);
        const status = vStatus(state, parsed.site, vp);
        state.production.push({
          id: uid(), date, site: parsed.site, session: sess.n,
          bags: round1(per), expected: Math.round(expected), actual,
          variance: Math.round(variance), variancePct: round1(vp), status,
          reason: null, reasonTs: null, ts: new Date().toISOString(),
        });
        const shortfall = actual - expected; // negative = loss
        parts.push(`S${sess.n}: ${fmt(actual)}/${fmt(expected)} (${shortfall >= 0 ? '+' : '−'}${fmt(Math.abs(shortfall))}, ${shortfall >= 0 ? '+' : '−'}${Math.abs(vp).toFixed(1)}%)`);
        if (status === 'critical') {
          anyCritical = true;
          alert('critical', 'variance', `🚨 CRITICAL YIELD — ${s.name} S${sess.n}`,
            `Expected ${fmt(expected)}, actual ${fmt(actual)} → ${fmt(Math.abs(variance))} loaves (${vp.toFixed(1)}%).\nManager: check the scale and oven for session ${sess.n}, recount at shaping, then reply: REASON ${parsed.site} S${sess.n} <specific reason>.`,
            { site: parsed.site, session: sess.n });
        } else if (status === 'minor') {
          anyMinor = true;
          alert('warn', 'variance', `⚠️ Minor loss — ${s.name} S${sess.n}`,
            `Variance ${vp.toFixed(1)}% (${fmt(Math.abs(variance))} loaves). Manager: verify scale calibration and log the reason: REASON ${parsed.site} S${sess.n} <reason>.`,
            { site: parsed.site, session: sess.n });
        }
      }
      const tot = siteStats(state, parsed.site, date);
      const dayShort = tot.actual - tot.expected;
      reply = `✅ Logged ${s.name} — ${parsed.bags} bags, ${parsed.sessions.length} session(s). ${parts.join(' · ')} → today: ${fmt(tot.actual)}/${fmt(tot.expected)} loaves (${dayShort >= 0 ? '+' : '−'}${Math.abs(tot.variancePct).toFixed(1)}% variance).` +
        (anyCritical ? ' 🚨 Manager alerted — investigation requested.' : anyMinor ? ' ⚠️ Manager flagged for review.' : ' All within tolerance.');
      break;
    }

    case 'TRIP': {
      const trip = {
        id: uid(), date, driver: parsed.driver, trip: parsed.tripNo,
        dispatched: parsed.dispatched, cashLoaves: parsed.cashLoaves,
        crLoaves: parsed.crLoaves, retLoaves: parsed.retLoaves, ts: new Date().toISOString(),
      };
      const accounted = parsed.cashLoaves + parsed.crLoaves + parsed.retLoaves;
      trip.short = parsed.dispatched - accounted;
      trip.shortPct = trip.dispatched > 0 ? (trip.short / trip.dispatched) * 100 : 0;
      trip.status = trip.shortPct > 1 ? 'short' : 'ok';
      state.trips.push(trip);

      const price = anyPrice(state);
      reply = `✅ Trip ${parsed.tripNo || ''} ${parsed.driver}: ${fmt(parsed.dispatched)} loaded → cash ${fmt(parsed.cashLoaves)} + credit ${fmt(parsed.crLoaves)}` +
        (parsed.retLoaves ? ` + returns ${fmt(parsed.retLoaves)}` : '') +
        (price != null ? ` ≈ GHS ${fmt(accounted * price)}` : '') + '.';

      if (trip.status === 'short') {
        reply += ` 🚨 ${fmt(trip.short)} loaves unaccounted (${trip.shortPct.toFixed(1)}%).`;
        alert('critical', 'driver', `🚨 DRIVER SHORTAGE — ${parsed.driver}`,
          `Trip ${parsed.tripNo || '-'}: dispatched ${fmt(parsed.dispatched)}, accounted ${fmt(accounted)} → short ${fmt(trip.short)} (${trip.shortPct.toFixed(1)}%).\nAsk the driver to recount returns and verify the next load. Log the outcome before escalating.`,
          { driver: parsed.driver });
      }

      // Cross-check rule: dispatch vs production + carried buffer (before any theft call).
      const prodToday = Object.keys(state.params.sites).reduce((s2, c) => s2 + siteStats(state, c, date).actual, 0);
      const dispToday = dayTrips(state, date).reduce((s2, t) => s2 + t.dispatched, 0);
      const carry = carriedSurplus(state, date);
      if (dispToday > prodToday + carry) {
        reply += ' 🚨 Reconciliation flag: dispatch today exceeds production + carried buffer.';
        alert('critical', 'reconcile', '🚨 RECONCILIATION ERROR — network',
          `Dispatched today ${fmt(dispToday)} > produced ${fmt(prodToday)} + carried buffer ${fmt(carry)}. Rule out in order: previous-day surplus sold, misreported counts, unlogged production. Theft is the last diagnosis, never the first.`, {});
      }
      break;
    }

    case 'STOCK': {
      const s = state.params.sites[parsed.site];
      state.stockLog.push({ date, site: parsed.site, bags: parsed.bags, ts: new Date().toISOString() });
      const cover = daysOfCover(state, parsed.site);
      reply = `✅ ${s.name} flour stock set: ${parsed.bags} bags${cover != null ? ` ≈ ${cover.toFixed(1)} days of cover` : ''}.`;
      const lowBags = s.reorder != null ? s.reorder : 20;
      const coverT = s.coverTarget != null ? s.coverTarget : 3;
      const low = parsed.bags < lowBags || (cover != null && cover < coverT);
      if (low) {
        const days = avgDailyBags(state, parsed.site);
        const suggest = days ? Math.max(lowBags, Math.ceil(days * 5 - parsed.bags)) : 40;
        const draft = `Supplier: please deliver ${suggest} bags of flour to ${s.name} (${s.region}) this week. Current stock ${parsed.bags} bags${cover != null ? ` ≈ ${cover.toFixed(1)} days of cover` : ''}. — HOPE Special Bread`;
        alert('critical', 'stock', `🚨 Flour low — ${s.name} (${parsed.bags} bags)`, draft, { site: parsed.site });
        reply += ' 🚨 Below threshold — reorder draft ready (see Stock tab / briefing).';
      }
      break;
    }

    case 'KIOSK': {
      const key = parsed.kiosk;
      let k = state.kioskDebt.find(x => x.kiosk === key);
      if (!k) { k = { kiosk: key, issued: date, outstanding: 0, payments: [], ts: new Date().toISOString() }; state.kioskDebt.push(k); }
      const aged = daysBetween(k.issued, date);
      const n2 = state.params.network || {};
      const alertD = n2.debtDays || 3, escD = n2.debtEscalateDays || 7;
      if (parsed.action === 'owes') {
        const isNew = k.outstanding === 0;
        k.outstanding = parsed.amount;
        if (isNew) k.issued = date;
        reply = `✅ Debt ledger — ${key}: outstanding set to GHS ${fmt(parsed.amount)}.` +
          (k.outstanding > 0 && aged > alertD ? ` ⚠️ This debt is ${aged} days old — collect today.` : '');
        if (k.outstanding > 0 && aged > alertD) {
          alert('warn', 'debt', `⚠️ Debt overdue — ${key}`, `GHS ${fmt(k.outstanding)} outstanding for ${aged} days (> ${alertD}). Flag for immediate collection.`, {});
        }
        if (k.outstanding > 0 && aged > escD) {
          alert('critical', 'debt', `🚨 Debt escalated — ${key}`, `GHS ${fmt(k.outstanding)} outstanding for ${aged} days (> ${escD}). Escalate to CEO for direct follow-up.`, {});
        }
      } else {
        k.outstanding = Math.max(0, k.outstanding - parsed.amount);
        k.payments.push({ amount: parsed.amount, date });
        reply = `✅ ${key} paid GHS ${fmt(parsed.amount)} → balance GHS ${fmt(k.outstanding)}.` + (k.outstanding === 0 ? ' 🎉 Debt cleared.' : '');
      }
      break;
    }

    case 'REASON': {
      const row = state.production.find(r => r.site === parsed.site && r.date === date && r.session === parsed.session);
      if (!row) { reply = `❓ No session S${parsed.session} found for ${parsed.site} today. Which session should I attach this reason to?`; break; }
      row.reason = parsed.reason;
      row.reasonTs = new Date().toISOString();
      const openAlert = state.alerts.find(a => a.type === 'variance' && a.site === parsed.site && a.session === parsed.session && !a.resolved);
      if (openAlert) { openAlert.resolved = true; openAlert.resolution = parsed.reason; }
      reply = `✅ Reason logged for ${parsed.site} S${parsed.session}: “${parsed.reason}”. This will show in the CEO briefing.`;
      break;
    }

    case 'REFUSED_CREDIT': {
      const kiosk = parsed.kiosk;
      state.creditRefusals.push({ id: uid(), date, ts: new Date().toISOString(), kiosk, by: from });
      const k = state.kioskDebt.find(x => x.kiosk === kiosk);
      const days = k ? daysBetween(k.issued, date) : 0;
      let note = '';
      if (!k || k.outstanding === 0) note = ' Note: this kiosk has no open balance in my ledger — double-check before refusing.';
      else if (days <= 3) note = ` Note: that balance is only ${days} day(s) old (≤ 3d) — policy still allows credit.`;
      reply = `✅ Credit refusal logged — ${kiosk} (cash demanded). Discipline noted for the CEO briefing.${note}`;
      break;
    }

    case 'REMITTED': {
      const driver = parsed.driver;
      const todayTrips = dayTrips(state, date).filter(t => t.driver === driver);
      if (!todayTrips.length) {
        reply = `❓ No trips logged for ${driver} today. Which day's cash is this remittance for?`;
        break;
      }
      const cashLoaves = todayTrips.reduce((s2, t) => s2 + t.cashLoaves, 0);
      const pi = driverPrice(state, driver, date);
      if (pi.price == null) {
        reply = `❓ ${driver} reported ${fmt(cashLoaves)} cash loaves today, but PRICE is not set. Set PRICE (GHS/loaf) so I can reconcile the GHS amount.`;
        break;
      }
      const expected = cashLoaves * pi.price;
      const priceBasis = pi.site ? ` at ${pi.site}'s price` : pi.assumed ? ' at network default price' : ' at network-weighted price (set DRIVER-SITE for exact matching)';
      const gap = parsed.amount - expected;
      const gapPct = expected > 0 ? (Math.abs(gap) / expected) * 100 : 0;
      const remTh = (state.params.network || {}).remGap || 0.5;
      const status = gapPct > remTh ? 'alert' : 'ok';
      state.remittances.push({ id: uid(), date, driver, expected: Math.round(expected), actual: parsed.amount, gap: Math.round(gap), gapPct: round1(gapPct), status, ts: new Date().toISOString() });
      if (status === 'alert') {
        reply = `🚨 CASH HANDLING ALERT — ${driver}: expected GHS ${fmt(expected)} (from ${fmt(cashLoaves)} cash loaves${priceBasis}), remitted GHS ${fmt(parsed.amount)} → gap ${gap >= 0 ? '+' : '−'}${fmt(Math.abs(gap))} (${gapPct.toFixed(2)}% > ${remTh}%).`;
        alert('critical', 'cash', `🚨 CASH HANDLING ALERT — ${driver} → Manager`,
          `Expected GHS ${fmt(expected)} vs remitted GHS ${fmt(parsed.amount)} (gap ${gapPct.toFixed(2)}% > ${remTh}%). Manager: recount the till, verify the driver's cash book, and confirm the correction before the next remittance.`, { driver });
      } else {
        reply = `✅ Cash reconciled — ${driver}: GHS ${fmt(parsed.amount)} vs expected GHS ${fmt(expected)} (diff ${gapPct.toFixed(2)}% ≤ ${remTh}%). Driver→Manager loop closed.`;
      }
      break;
    }

    case 'DRIVER_SITE': {
      state.params.drivers = state.params.drivers || {};
      state.params.drivers[parsed.driver] = parsed.site;
      reply = `✅ ${parsed.driver} mapped to ${parsed.site} (${state.params.sites[parsed.site].name}) route. Cash reconciliation now uses ${parsed.site}'s price for ${parsed.driver}.`;
      break;
    }

    case 'CONFIG': {
      if (parsed.key === 'price' && !parsed.site) {
        state.params.network.price = parsed.value;
        const own = Object.keys(state.params.sites).filter(c => state.params.sites[c].price != null)
          .map(c => `${c} (GHS ${state.params.sites[c].price}/loaf)`);
        const unset = Object.keys(state.params.sites).filter(c => state.params.sites[c].price == null);
        reply = `✅ Network default price set to GHS ${parsed.value}/loaf.` +
          (own.length ? ` ⚠️ Sites with their OWN price keep it — reconciliation uses the site price first: ${own.join(', ')}.` : '') +
          (unset.length ? ` Sites without a price inherit the new default (marked as assumption): ${unset.join(', ')}.` : '') +
          ` To change a site's own price: PRICE 1.60 MAM. To make the network price apply everywhere, clear site prices in Settings.`;
        break;
      }
      const targets = parsed.site ? [parsed.site] : Object.keys(state.params.sites);
      for (const code of targets) state.params.sites[code][parsed.key] = parsed.value;
      const label = { yield: 'yield (loaves/bag)', batch: 'batch (bags/load)', session: 'session (bags/session)', price: `price (GHS/loaf) for ${targets.join(', ')}` }[parsed.key];
      reply = `✅ ${label} set to ${parsed.value}. All future math uses the new value.`;
      break;
    }

    case 'CLARIFY': {
      reply = `❓ ${parsed.question}`;
      break;
    }

    case 'FREE': {
      const free = String(parsed.text || '');
      let siteFromSender = Object.keys(state.params.sites).find(c => String(from || '').toUpperCase().includes(c)) || null;
      if (!siteFromSender && state.config.whatsapp && state.config.whatsapp.managers) {
        // On WhatsApp the sender is a phone number — match it to the site's Manager number.
        const digits = String(from || '').replace(/\D/g, '');
        const match = Object.entries(state.config.whatsapp.managers)
          .find(([, ph]) => ph && digits && digits.endsWith(String(ph).replace(/\D/g, '').slice(-9)));
        siteFromSender = match ? match[0] : null;
      }
      if (/\bDELAYED\b/i.test(free) && siteFromSender) {
        const reason = free.replace(/\bDELAYED\b/i, '').replace(/^[\s,:-]+/, '').trim() || 'no reason given';
        state.delayedAcks.push({ id: uid(), date, site: siteFromSender, reason, ts: new Date().toISOString() });
        reply = `⚠️ ${siteFromSender} marked DELAYED — reason logged: “${reason}”. Blind-spot risk cleared for today; I'll watch for the data to arrive.`;
        break;
      }
      reply = `I logged that note, but I only act on numbers. To record data use: PROD / TRIP / STOCK / KIOSK / REASON / REMITTED / REFUSED-CREDIT / YIELD / BATCH / SESSION / PRICE. Which figures should I record?`;
      break;
    }
  }

  state.log.unshift({
    id: uid(), date, ts: new Date().toISOString(), from, text: String(text || '').trim(),
    reply, events: events.map(e => e.title),
  });
  if (state.log.length > 1000) state.log.length = 1000;
  return { reply, events };
}

function week7Stats(state, date) {
  // 7-day production variance per site + network — the number behind "MAMPONG LEAKING".
  const ref = date || todayStr();
  const dates = lastNDates(state, 7, ref);
  const sites = {};
  let exp = 0, act = 0;
  for (const code of Object.keys(state.params.sites)) {
    let e = 0, a = 0;
    for (const d of dates) { const st = siteStats(state, code, d); e += st.expected; a += st.actual; }
    sites[code] = { expected: e, actual: a, variance: e - a, variancePct: variancePct(e, a) };
  }
  for (const c of Object.keys(sites)) { exp += sites[c].expected; act += sites[c].actual; }
  return { days: dates.length, sites, net: { expected: exp, actual: act, variance: exp - act, variancePct: variancePct(exp, act) } };
}

function computeSummary(state) {
  const date = todayStr();
  const s = daySummary(state, date);
  const readiness = readinessScore(state, date);
  const forecastF = forecast(state, date);
  const debtTotal = s.debt.reduce((a, k) => a + k.outstanding, 0);
  const debtOverdue = s.debt.filter(k => k.overdue).length;
  const covers = Object.values(s.sites).map(x => x.cover).filter(c => c != null);
  const minCover = covers.length ? Math.min(...covers) : null;
  const spots = {};
  for (const code of Object.keys(state.params.sites)) spots[code] = siteBlindSpot(state, code, date);
  return {
    date, ...s, debtTotal, debtOverdue, minCover, readiness, forecast: forecastF, spots,
    week7: week7Stats(state, date),
    alerts: state.alerts.slice(0, 30), log: state.log.slice(0, 60),
  };
}

module.exports = {
  ingest, computeSummary, daySummary, readinessScore, forecast,
  siteStats, dayTrips, siteStock, avgDailyBags, daysOfCover, kioskAging,
  priceFor, anyPrice, networkPrice, driverPrice,
  siteHasData, runDataGapNudge, siteBlindSpot, lastNDates, week7Stats,
  fmt, variancePct, vStatus,
};
