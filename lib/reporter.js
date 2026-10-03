'use strict';
// The 10:00 PM CEO briefing + Sunday Weekly Business Review — exact WhatsApp format.
const { todayStr } = require('./store');
const {
  daySummary, readinessScore, forecast, siteStats, kioskAging, lastNDates,
  siteBlindSpot, anyPrice, fmt,
} = require('./rules');
const { radarAdvice } = require('./market');

const sign = n => (n < 0 ? '−' : '+') + fmt(Math.abs(n));
const pctStr = n => { const tiny = Math.abs(n) < 0.05; return (tiny ? '' : n < 0 ? '−' : '+') + Math.abs(n).toFixed(1) + '%'; };
const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function briefingText(state, date) {
  const s = daySummary(state, date);
  const L = [];
  L.push('📊 *BAKEGUARD — HOPE SPECIAL BREAD*');
  L.push('*DAILY OPS BRIEFING*');
  L.push(`*Date:* ${date}`);
  const recentParams = (state.paramLog || []).filter(e => (Date.now() - new Date(e.ts).getTime()) < 24 * 3600 * 1000);
  if (recentParams.length) {
    const f = v => v == null ? 'unset' : v;
    L.push(`⚠️ *Parameter change (last 24h):* ${recentParams.slice(-3).map(e => `${e.scope} ${e.field} ${f(e.old)} → ${f(e.new)} (by ${e.by})`).join('; ')} — applies to future calculations only; history keeps its original values.`);
  }
  L.push('');
  L.push('🏭 *PRODUCTION*');
  for (const code of Object.keys(state.params.sites)) {
    const site = s.sites[code];
    const name = state.params.sites[code].name;
    if (!site.bags) {
      const spot = siteBlindSpot(state, code, date);
      if (spot && spot.level === 'blind') {
        L.push(`- *${name}:* 🚨 OPERATIONAL BLIND SPOT — 9:00 PM nudge sent, no data, no reply.`);
      } else if (spot && spot.level === 'delayed') {
        L.push(`- *${name}:* ⚠️ Data delayed (manager reported: “${spot.reason}”).`);
      } else {
        L.push(`- *${name}:* no production logged (data gap).`);
      }
      continue;
    }
    const emoji = site.status === 'critical' ? '🚨' : site.status === 'minor' ? '⚠️' : '✅';
    const flagged = site.sessions.filter(x => x.status !== 'ok');
    const reasons = flagged.map(x => `S${x.session}: ${x.reason || 'reason pending'}`).join('; ');
    L.push(`- *${name}:* ${site.bags} bags · exp. ${fmt(site.expected)} · actual ${fmt(site.actual)} → ${emoji} ${sign(-site.variance)} loaves (${pctStr(-site.variancePct)})${flagged.length ? ' — ' + reasons : ''}`);
  }
  const nw = s.net.status === 'critical' ? '🚨 CRITICAL' : s.net.status === 'minor' ? '⚠️ Minor loss' : '✅ Healthy';
  L.push(`- *Network:* ${pctStr(-s.net.variancePct)} variance — ${nw}`);
  L.push('');
  L.push('🚚 *DISTRIBUTION*');
  L.push(`- Dispatched: ${fmt(s.dispatched)} loaves · ${s.trips.length} trip(s)`);
  const drv = Object.values(s.drivers).map(d => d.status === 'ok' ? `${d.driver} ✅ 100%` : `${d.driver} 🚨 short ${fmt(d.gap)} (${d.gapPct.toFixed(1)}%)`).join(' · ') || 'none logged';
  L.push(`- Drivers: ${drv}`);
  const priceNote = s.priceAssumed ? ' (assumed — set per-site PRICE)' : '';
  const cashStr = s.price != null ? `GHS ${fmt(s.cashLoaves * s.price)}` : `${fmt(s.cashLoaves)} loaves (set PRICE)`;
  const crStr = s.price != null ? `GHS ${fmt(s.crLoaves * s.price)}` : `${fmt(s.crLoaves)} loaves (set PRICE)`;
  L.push(`- Cash: ${cashStr} · Credit issued: ${crStr}${priceNote}`);
  L.push('');
  L.push('💰 *FINANCIAL PULSE*');
  L.push(`- Total revenue today: ${s.price != null ? `GHS ${fmt(s.cashLoaves * s.price)}` : '— (set PRICE to convert)'}`);
  const debtTotal = s.debt.reduce((a, k) => a + k.outstanding, 0);
  const overdue = s.debt.filter(k => k.overdue);
  L.push(`- Outstanding kiosk debt: GHS ${fmt(debtTotal)} — ${overdue.length ? `⚠️ ${overdue.length} overdue > 3 days: ` + overdue.map(k => `${k.kiosk} (GHS ${fmt(k.outstanding)}, ${k.days}d)`).join(', ') : 'none overdue'}`);
  const refusals = state.creditRefusals.filter(r => r.date === date);
  const noCredit = s.debt.filter(k => k.noCredit);
  if (refusals.length) {
    L.push(`- Credit discipline: ✅ ${refusals.length} overdue-credit refusal(s) enforced: ${[...new Set(refusals.map(r => r.kiosk))].join(', ')} — good sign.`);
  }
  if (noCredit.length) {
    L.push(`- *NO CREDIT list (drivers: demand cash only):* ${noCredit.map(k => k.kiosk).join(', ')}`);
  }
  const rem = state.remittances.filter(r => r.date === date);
  if (rem.length) {
    L.push(`- Cash reconciliation: ${rem.map(r => `${r.driver} ${r.status === 'ok' ? '✅' : '🚨'} (GHS ${fmt(r.actual)} vs ${fmt(r.expected)})`).join(' · ')}`);
  }
  L.push('');
  L.push('📦 *STOCK & SUPPLY*');
  const stockLine = Object.keys(state.params.sites).map(code => {
    const site = s.sites[code];
    const cover = site.cover != null ? ` (${site.cover.toFixed(1)}d)` : '';
    return `${code} ${site.stock == null ? '?' : site.stock}${cover}${site.low ? ' 🚨' : ''}`.trim();
  }).join(' · ');
  L.push(`- Flour: ${stockLine}`);
  const reorder = state.alerts.find(a => a.date === date && a.type === 'stock' && !a.resolved);
  L.push(`- *Action:* ${reorder ? reorder.body.replace(/\n/g, ' ') : 'None — all sites ≥ 3 days cover'}`);
  L.push('');
  L.push('🔮 *TOMORROW*');
  const f = forecast(state, date);
  if (f.production != null) {
    L.push(`- Forecast: ${fmt(f.production)} loaves · dispatch ~${fmt(f.dispatch)} · cash ≈ ${f.cashGHS != null ? 'GHS ' + fmt(f.cashGHS) : '— (set PRICE)'}`);
    L.push(`- ${f.note}`);
  } else {
    L.push(`- Forecast: ${f.note}`);
  }
  L.push('');
  L.push('📈 *CEO INSIGHT*');
  const r = readinessScore(state, date);
  L.push(`- *Readiness: ${r.score}/100* — ${r.insight}`);
  L.push(`- *Do this:* ${r.action}`);
  const rad = radarAdvice(state);
  if (date === todayStr()) L.push(`- *Radar:* ${rad.line}`);
  return L.join('\n');
}

function weeklyReview(state, asOf) {
  const dates = lastNDates(state, 7, asOf);
  if (!dates.length) return 'No history yet — the weekly review activates after the first week of logs.';
  const L = [];
  L.push('📈 *BAKEGUARD — HOPE SPECIAL BREAD*');
  L.push('*WEEKLY BUSINESS REVIEW*');
  L.push(`*Week ending:* ${asOf} (${dates.length} days of data)`);
  L.push('');

  // 7-day production
  let bags = 0, exp = 0, act = 0;
  const bySite = {};
  for (const d of dates) for (const code of Object.keys(state.params.sites)) {
    const st = siteStats(state, code, d);
    bags += st.bags; exp += st.expected; act += st.actual;
    const b = bySite[code] = bySite[code] || { bags: 0, expected: 0, actual: 0 };
    b.bags += st.bags; b.expected += st.expected; b.actual += st.actual;
  }
  const vPct = exp > 0 ? ((exp - act) / exp) * 100 : 0;
  L.push('🏭 *7-DAY PRODUCTION*');
  L.push(`- Total: ${fmt(bags)} bags · exp. ${fmt(exp)} · actual ${fmt(act)} → ${sign(act - exp)} loaves (${pctStr(-vPct)})`);
  L.push('- By site: ' + Object.keys(bySite).map(c => {
    const b = bySite[c];
    const vp = b.expected > 0 ? ((b.expected - b.actual) / b.expected) * 100 : 0;
    return `${c} ${fmt(b.actual)} (${pctStr(-vp)})`;
  }).join(' · '));
  L.push('');

  // 7-day money
  let cashL = 0, crL = 0;
  const byDriver = {};
  for (const d of dates) for (const t of state.trips.filter(x => x.date === d)) {
    cashL += t.cashLoaves; crL += t.crLoaves;
    const b = byDriver[t.driver] = byDriver[t.driver] || { driver: t.driver, cash: 0, cr: 0, trips: 0, dispatched: 0 };
    b.cash += t.cashLoaves; b.cr += t.crLoaves; b.trips++; b.dispatched += t.dispatched;
  }
  const price = anyPrice(state);
  const priceNote = price != null && (state.params.network || {}).price != null ? ' (network price assumed where site price unset)' : '';
  L.push('💰 *7-DAY MONEY*');
  L.push(`- Cash collected: ${price != null ? 'GHS ' + fmt(cashL * price) : fmt(cashL) + ' loaves (set PRICE)'} · Credit issued: ${price != null ? 'GHS ' + fmt(crL * price) : fmt(crL) + ' loaves'}${priceNote}`);
  const debt = kioskAging(state, asOf);
  L.push(`- Kiosk debt outstanding: GHS ${fmt(debt.reduce((a, k) => a + k.outstanding, 0))} across ${debt.filter(k => k.outstanding > 0).length} kiosk(s)`);
  L.push('');

  // Routes top/bottom 3
  const ranked = Object.values(byDriver).map(b => ({ ...b, ghs: price != null ? Math.round(b.cash * price) : null })).filter(b => b.ghs != null || b.dispatched > 0).sort((a, b) => (b.ghs || 0) - (a.ghs || 0));
  L.push('🚚 *ROUTES (7-DAY REVENUE)*');
  const fmtDrv = b => `${b.driver} ${b.ghs != null ? 'GHS ' + fmt(b.ghs) : fmt(b.dispatched) + ' loaves'} (${b.trips} trips)`;
  L.push(`- *Top 3:* ${ranked.slice(0, 3).map(fmtDrv).join(' · ') || '—'}`);
  L.push(`- *Bottom 3:* ${ranked.length > 3 ? ranked.slice(-3).reverse().map(fmtDrv).join(' · ') : 'only ' + ranked.length + ' active route(s) this week'}`);
  L.push('');

  // Chronic debt
  const chronic = debt.filter(k => k.outstanding > 0 && k.days > 7);
  L.push('⚠️ *CHRONIC DEBT (> 7 days) — write-off or legal review*');
  L.push(chronic.length ? chronic.map(k => `- ${k.kiosk}: GHS ${fmt(k.outstanding)} (${k.days}d old)`).join('\n') : '- None 🎉');
  L.push('');

  // Readiness trend
  L.push('📈 *READINESS TREND (7 DAYS)*');
  const scores = dates.map(d => ({ d, score: readinessScore(state, d).score }));
  L.push('- ' + scores.map(x => `${DAYN[new Date(x.d + 'T00:00:00Z').getUTCDay()]} ${x.score}`).join(' → '));
  const delta = scores.length >= 2 ? scores[scores.length - 1].score - scores[0].score : 0;
  L.push(`- Movement: ${delta >= 0 ? '+' : ''}${delta} pts this week`);
  L.push('');

  // Expansion radar
  const rad = radarAdvice(state);
  L.push('🧭 *EXPANSION RADAR*');
  L.push(`- ${rad.line}`);
  if (rad.nextBranch) L.push(`- ${rad.nextBranch}`);
  L.push('');

  // CEO verdict
  const lastScore = scores[scores.length - 1].score;
  const trendUp = delta >= 0;
  let verdict, action;
  if (chronic.length) {
    verdict = `Chronic debt at ${chronic.length} kiosk(s) is a leak the scale-up cannot fund. Decide write-off vs legal this week.`;
    action = `Review ${chronic.map(k => k.kiosk).join(', ')} and set a collection deadline or write-off entry.`;
  } else if (lastScore >= 80 && trendUp) {
    verdict = 'The week is clean and trending up — this is your green light window for capacity.';
    action = 'Lock in the next driver or branch from the Expansion Radar; keep the 10 PM logs flowing.';
  } else if (lastScore >= 60) {
    verdict = `Solid week, ${lastScore}/100 — stable but not yet scale-grade.`;
    action = 'Push the weakest readiness component (see daily briefings) for two more weeks before committing to scale.';
  } else {
    verdict = `Week closed at ${lastScore}/100 — do not scale yet.`;
    action = 'Run the daily "Do this" actions for 7 days and re-test readiness.';
  }
  L.push('📈 *CEO VERDICT*');
  L.push(`- ${verdict}`);
  L.push(`- *Do this:* ${action}`);
  return L.join('\n');
}

// ---------------- shared period helpers ----------------
function periodStats(state, dates) {
  let bags = 0, exp = 0, act = 0, cashL = 0, crL = 0;
  const bySite = {};
  const byDriver = {};
  for (const d of dates) {
    for (const code of Object.keys(state.params.sites)) {
      const st = siteStats(state, code, d);
      bags += st.bags; exp += st.expected; act += st.actual;
      const b = bySite[code] = bySite[code] || { bags: 0, expected: 0, actual: 0 };
      b.bags += st.bags; b.expected += st.expected; b.actual += st.actual;
    }
    for (const t of state.trips.filter(x => x.date === d)) {
      cashL += t.cashLoaves; crL += t.crLoaves;
      const b = byDriver[t.driver] = byDriver[t.driver] || { driver: t.driver, cash: 0, cr: 0, trips: 0, dispatched: 0, got: 0 };
      b.cash += t.cashLoaves; b.cr += t.crLoaves; b.trips++; b.dispatched += t.dispatched;
      b.got += t.cashLoaves + t.crLoaves + t.retLoaves;
    }
  }
  return { bags, exp, act, cashL, crL, bySite, byDriver, price: anyPrice(state) };
}

function chunksOf7(dates) {
  // newest-first 7-day chunks: [last 7, prior 7, ...]
  const out = [];
  for (let i = dates.length; i > 0; i -= 7) out.push(dates.slice(Math.max(0, i - 7), i));
  return out;
}

function debtBuckets(state, asOf) {
  const debt = kioskAging(state, asOf);
  const b = { fresh: 0, freshN: 0, watch: 0, watchN: 0, escalate: 0, escalateN: 0, chronic: 0, chronicN: 0 };
  for (const k of debt) {
    if (k.outstanding <= 0) continue;
    const g = k.days <= 3 ? 'fresh' : k.days <= 7 ? 'watch' : k.days <= 30 ? 'escalate' : 'chronic';
    b[g] += k.outstanding; b[g + 'N']++;
  }
  const paid = debt.reduce((a, k) => a + (k.payments || []).reduce((p, x) => p + x.amount, 0), 0);
  const issued = debt.reduce((a, k) => a + k.outstanding + (k.payments || []).reduce((p, x) => p + x.amount, 0), 0);
  return { debt, b, paid, issued };
}

function driverGapLine(state, dates) {
  const { byDriver, price } = periodStats(state, dates);
  const ranked = Object.values(byDriver).filter(b => b.dispatched > 0)
    .map(b => ({ ...b, gapPct: ((b.dispatched - b.got) / b.dispatched) * 100 }))
    .sort((a, b) => a.gapPct - b.gapPct);
  return ranked;
}

function cooReco(state, asOf, dates) {
  const out = [];
  const s = daySummary(state, asOf);
  // 1. stock cover
  for (const code of Object.keys(state.params.sites)) {
    const site = s.sites[code];
    if (site.cover != null && site.cover < 3) {
      out.push(`Reorder *${code}* now: ${site.stock} bags left (${site.cover.toFixed(1)}d cover). Use the Stock tab reorder draft — move flour from a high-cover site if a delivery can't land in time.`);
    }
  }
  // 2. debt escalation
  const { b, debt } = debtBuckets(state, asOf);
  const hot = debt.filter(k => k.outstanding > 0 && k.days > 3);
  if (hot.length) out.push(`Chase *${hot.map(k => k.kiosk).join(', ')}*: GHS ${fmt(hot.reduce((a, k) => a + k.outstanding, 0))} over 3 days old — call each kiosk, set a collection deadline, and add to the NO CREDIT list until cleared.`);
  // 3. driver coaching (period gap)
  const ranked = driverGapLine(state, dates);
  const weak = ranked.filter(d => d.gapPct > 2);
  if (weak.length) out.push(`Review trip logs with *${weak.map(d => d.driver).join(', ')}*: ${weak.map(d => d.driver + ' ' + d.gapPct.toFixed(1) + '%').join(', ')} period gap — recount one trip together before repeating the coaching.`);
  // 4. production variance
  if (s.net.variancePct > 2) out.push(`Bake variance is running at ${s.net.variancePct.toFixed(1)}% — check the scale and yeast timing before this becomes a monthly leak.`);
  // 5. scale signal
  const r = readinessScore(state, asOf);
  if (r.score >= 80) {
    const rad = radarAdvice(state);
    out.push(`Readiness ${r.score}/100 — green light window: ${rad.nextBranch || rad.line}`);
  } else if (r.score >= 60) {
    out.push(`Readiness ${r.score}/100 — fix the weakest component for two more weeks before committing new capacity.`);
  } else {
    out.push(`Readiness ${r.score}/100 — hold scale-up; run the daily "Do this" actions first.`);
  }
  if (!out.length) out.push('All KPIs green — keep the rhythm: 10 PM logs, morning stock check, driver counts at the gate.');
  return out;
}

function monthlyReview(state, asOf) {
  const dates = lastNDates(state, 30, asOf);
  if (!dates.length) return 'No history yet — the monthly review activates after the first days of logs.';
  const p = periodStats(state, dates);
  const chunks = chunksOf7(dates); // newest first
  const L = [];
  L.push('📊 *BAKEGUARD — HOPE SPECIAL BREAD*');
  L.push('*MONTHLY BUSINESS REVIEW*');
  L.push(`*Month ending:* ${asOf} (${dates.length} days of data)`);
  L.push('');
  L.push('🏭 *PRODUCTION*');
  L.push(`- Total: ${fmt(p.bags)} bags · exp. ${fmt(p.exp)} · actual ${fmt(p.act)} → ${sign(p.act - p.exp)} loaves (${p.exp > 0 ? pctStr(-(p.exp - p.act) / p.exp * 100) : ''})`);
  L.push('- By site: ' + Object.keys(p.bySite).map(c => {
    const b = p.bySite[c];
    const vp = b.expected > 0 ? ((b.expected - b.actual) / b.expected) * 100 : 0;
    return `${c} ${fmt(b.actual)} (${pctStr(-vp)})`;
  }).join(' · '));
  if (chunks.length >= 2) {
    L.push('- Weekly trend (loaves): ' + chunks.map((c, i) => {
      const a = c.reduce((acc, d) => acc + Object.values(siteStatsAll(state, d)).reduce((x, s) => x + s.actual, 0), 0);
      return (i === 0 ? 'W-end' : 'W-' + i) + ' ' + fmt(a);
    }).join(' → '));
  }
  L.push('');
  L.push('💰 *MONEY*');
  const mStr = n => p.price != null ? 'GHS ' + fmt(n * p.price) : fmt(n) + ' loaves';
  L.push(`- Cash collected: ${mStr(p.cashL)} · Credit issued: ${mStr(p.crL)}`);
  if (chunks.length >= 2) {
    const cashChunk = c => c.reduce((a, d) => a + state.trips.filter(t => t.date === d).reduce((x, t) => x + t.cashLoaves, 0), 0);
    const last7 = cashChunk(chunks[0]), prev7 = cashChunk(chunks[1]);
    const d = prev7 > 0 ? ((last7 - prev7) / prev7) * 100 : 0;
    const partial = chunks[1].length < 7 ? ` (prev window has only ${chunks[1].length} day(s) of data)` : '';
    L.push(`- Week-over-week cash: ${mStr(last7)} vs prev 7d ${mStr(prev7)} → ${d >= 0 ? '📈' : '📉'} ${pctStr(d)}${partial}`);
  }
  const { b, paid, issued } = debtBuckets(state, asOf);
  L.push(`- Kiosk debt aging: ≤3d GHS ${fmt(b.fresh)} · 4–7d GHS ${fmt(b.watch)} · 8–30d GHS ${fmt(b.escalate)} · >30d GHS ${fmt(b.chronic)}`);
  L.push(`- Credit recovery: ${issued > 0 ? Math.round(paid / issued * 100) + 0 : 0}% of issued credit collected (GHS ${fmt(paid)} of GHS ${fmt(issued)})`);
  L.push('');
  const ranked = driverGapLine(state, dates).filter(d => p.price != null || d.dispatched > 0);
  const byCash = [...ranked].sort((a, b) => b.cash - a.cash);
  L.push('🚚 *DRIVERS (PERIOD)*');
  L.push(`- Top by cash: ${byCash.slice(0, 5).map(x => `${x.driver}${p.price != null ? ' GHS ' + fmt(x.cash * p.price) : ' ' + fmt(x.cash) + ' loaves'}`).join(' · ') || '—'}`);
  if (ranked.length) {
    L.push(`- Most consistent: *${ranked[0].driver}* — ${ranked[0].gapPct.toFixed(1)}% gap over ${ranked[0].trips} trips`);
    const weak = ranked.filter(x => x.gapPct > 2);
    if (weak.length) L.push(`- Needs coaching: ${weak.map(x => `${x.driver} (${x.gapPct.toFixed(1)}%)`).join(', ')}`);
  }
  L.push('');
  L.push('📈 *READINESS*');
  const first = readinessScore(state, dates[0]).score, last = readinessScore(state, asOf).score;
  L.push(`- ${first} → ${last} (${last - first >= 0 ? '+' : ''}${last - first} pts) — ${readinessScore(state, asOf).insight}`);
  L.push('');
  L.push('🧭 *EXPANSION RADAR*');
  const rad = radarAdvice(state);
  L.push(`- ${rad.line}`);
  L.push('');
  L.push('🎯 *COO RECOMMENDATIONS*');
  cooReco(state, asOf, dates).forEach(r => L.push('- ' + r));
  L.push('');
  const verdict = last >= 80
    ? 'Scale-grade month. The numbers justify the next capacity decision — do it deliberately.'
    : last >= 60
      ? 'A solid month with visible edges. Close the edges below before the next expansion spend.'
      : 'Not scale-grade yet. The ledger now shows exactly why — fix the list below.';
  L.push('📈 *CEO VERDICT*');
  L.push(`- ${verdict}`);
  return L.join('\n');
}

function yearlyReview(state, asOf) {
  const dates = lastNDates(state, 365, asOf);
  if (!dates.length) return 'No history yet — the yearly review activates after the first days of logs.';
  const p = periodStats(state, dates);
  const L = [];
  L.push('📊 *BAKEGUARD — HOPE SPECIAL BREAD*');
  L.push('*YEARLY BUSINESS REVIEW*');
  L.push(`*Year ending:* ${asOf} (${dates.length} days of data)`);
  L.push('');
  L.push('🏭 *BY MONTH*');
  const byMonth = {};
  for (const d of dates) {
    const m = d.slice(0, 7);
    const b = byMonth[m] = byMonth[m] || { days: 0, bags: 0, actual: 0, cash: 0 };
    b.days++;
    for (const code of Object.keys(state.params.sites)) { const st = siteStats(state, code, d); b.bags += st.bags; b.actual += st.actual; }
    for (const t of state.trips.filter(x => x.date === d)) b.cash += t.cashLoaves;
  }
  const mNames = { 1: 'Jan', 2: 'Feb', 3: 'Mar', 4: 'Apr', 5: 'May', 6: 'Jun', 7: 'Jul', 8: 'Aug', 9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Dec' };
  Object.keys(byMonth).sort().forEach(m => {
    const b = byMonth[m];
    const cash = p.price != null ? 'GHS ' + fmt(b.cash * p.price) : fmt(b.cash) + ' loaves';
    L.push(`- ${mNames[+m.slice(5)]} ${m.slice(2, 4)}: ${fmt(b.bags)} bags · ${fmt(b.actual)} loaves · cash ${cash}${b.days < 28 ? ` (${b.days} days)` : ''}`);
  });
  L.push('');
  L.push('💰 *TOTALS*');
  L.push(`- ${fmt(p.bags)} bags baked · ${fmt(p.act)} loaves out · cash ${p.price != null ? 'GHS ' + fmt(p.cashL * p.price) : fmt(p.cashL) + ' loaves'} · credit issued ${p.price != null ? 'GHS ' + fmt(p.crL * p.price) : fmt(p.crL) + ' loaves'}`);
  const { paid, issued } = debtBuckets(state, asOf);
  if (issued > 0) L.push(`- Credit ever issued: GHS ${fmt(issued)} · collected GHS ${fmt(paid)} (${Math.round(paid / issued * 100)}%)`);
  L.push('');
  const ranked = driverGapLine(state, dates);
  const byCash = [...ranked].sort((a, b) => b.cash - a.cash);
  if (ranked.length) {
    L.push('🚚 *DRIVERS (YEAR TO DATE)*');
    L.push(`- Top by cash: ${byCash.slice(0, 5).map(x => `${x.driver}${p.price != null ? ' GHS ' + fmt(x.cash * p.price) : ' ' + fmt(x.cash) + ' loaves'}`).join(' · ')}`);
    L.push(`- Most consistent: *${ranked[0].driver}* — ${ranked[0].gapPct.toFixed(1)}% gap over ${ranked[0].trips} trips`);
    L.push('');
  }
  const first = readinessScore(state, dates[0]).score, last = readinessScore(state, asOf).score;
  L.push('📈 *READINESS*');
  L.push(`- ${first} → ${last} (${last - first >= 0 ? '+' : ''}${last - first} pts since first log) — ${readinessScore(state, asOf).insight}`);
  L.push('');
  L.push('🧭 *EXPANSION RADAR*');
  const rad = radarAdvice(state);
  L.push(`- ${rad.line}`);
  L.push('');
  L.push('🎯 *COO RECOMMENDATIONS*');
  cooReco(state, asOf, dates).forEach(r => L.push('- ' + r));
  L.push('');
  const verdict = dates.length < 60
    ? 'The ledger is young — this is the foundation year. Goal: 90 consecutive days of clean 10 PM logs before the first scale decision; the radar is already queuing your next move.'
    : last >= 80
      ? 'A ledger this clean is rare in this market. Next year: capacity + the first new branch from the radar.'
      : last >= 60
        ? 'A real year of numbers, with clear edges. Next year opens with the COO recommendations above.'
        : 'Next year starts with discipline, not expansion — the daily "Do this" actions first.';
  L.push('📈 *CEO VERDICT*');
  L.push(`- ${verdict}`);
  return L.join('\n');
}

// sum of all-site stats for one date (helper for weekly trend line)
function siteStatsAll(state, date) {
  const out = {};
  for (const code of Object.keys(state.params.sites)) out[code] = siteStats(state, code, date);
  return out;
}

module.exports = { briefingText, weeklyReview, monthlyReview, yearlyReview };
