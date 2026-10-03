'use strict';
// BakeGuard dashboard — vanilla JS SPA
let S = null;
let tab = 'dash';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = n => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const ghs = n => (n == null ? '—' : 'GHS ' + Math.round(n).toLocaleString('en-US'));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const badge = st => st === 'critical' ? '<span class="bdg c">🚨 CRITICAL</span>' : st === 'minor' ? '<span class="bdg w">⚠️ MINOR</span>' : st === 'ok' ? '<span class="bdg ok">✅ OK</span>' : '<span class="bdg m">—</span>';
const pctSign = n => (Math.abs(n) < 0.05 ? '±' : n < 0 ? '−' : '+') + Math.abs(n).toFixed(1) + '%';

const SENDER_ROLES = [
  ['Manager — Mampong (MAM)', 'Manager MAM'],
  ['Manager — Nkoranza (NKZ)', 'Manager NKZ'],
  ['Manager — Techiman (TCH)', 'Manager TCH'],
  ['Driver KSI', 'KSI'],
  ['Driver KAN', 'KAN'],
  ['Driver AKU', 'AKU'],
  ['Driver TET', 'TET'],
  ['Kiosk owner', 'Kiosk'],
];
const SAMPLES = [
  'PROD MAM 80 S1-4000 S2-3800',
  'TRIP KSI 1000 CASH-800 CR-200 T1',
  'REMITTED KSI 3300',
  'REFUSED-CREDIT ADU KIOSK',
  'STOCK TCH 12',
  'KIOSK ADU KIOSK PAID-150',
  'REASON MAM S2 scale recalibrated',
  'PRICE 1.50',
];

async function api(path, body) {
  const opts = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.text()) || r.status);
  return r.json();
}

async function refresh() {
  S = await api('/api/state');
  render();
}

function render() {
  if (!S) return;
  const s = S.summary;
  $('#date').textContent = s.date;
  const wa = S.config.whatsapp;
  const on = wa.phone_number_id && wa.token;
  $('#wa').textContent = on ? 'WhatsApp: API keys set' : 'WhatsApp: awaiting API keys';
  $('#wa').classList.toggle('on', !!on);
  renderChat();
  const view = $('#view');
  const fns = { dash: rDash, prod: rProd, drivers: rDrivers, debt: rDebt, stock: rStock, radar: rRadar, brief: rBrief, reports: rReports, log: rLog };
  view.innerHTML = (fns[tab] || rDash)();
  bindView();
}

// ------------------------------------------------------------- dashboard
function rBanners() {
  const s = S.summary;
  const out = [];
  const siteName = code => S.params.sites[code] ? S.params.sites[code].name.toUpperCase() : code;
  // 7-day leak per site (the weekly-review number, surfaced in real time)
  if (s.week7) {
    for (const [code, st] of Object.entries(s.week7.sites)) {
      if (st.expected > 0 && st.variancePct > 5) {
        out.push(`<div class="banner red">🚨 ${esc(siteName(code))} LEAKING: −${st.variancePct.toFixed(1)}% over ${s.week7.dates} days (${fmt(st.variance)} loaves lost)
          <span class="act">Check scale → oven → staff, in that order. Log the manager's reason with REASON. Do not scale this site until it is under 2%.</span></div>`);
      }
    }
    if (s.week7.net.expected > 0 && s.week7.net.variancePct > 5) {
      out.push(`<div class="banner red">🚨 NETWORK LEAK: −${s.week7.net.variancePct.toFixed(1)}% over ${s.week7.dates} days
        <span class="act">More than 5% of the dough never reaches a customer. This is the number to kill.</span></div>`);
    }
  }
  // today's critical (single-day spike, earlier signal)
  for (const [code, st] of Object.entries(s.sites)) {
    if (st.bags > 0 && st.status === 'critical') {
      out.push(`<div class="banner red">🚨 ${esc(siteName(code))} TODAY: −${st.variancePct.toFixed(1)}% (−${fmt(st.variance)} loaves)
        <span class="act">Check the scale before the next session — a single bad bake becomes a weekly leak.</span></div>`);
    }
  }
  // readiness below scale-ready
  if (s.readiness.score < 60) {
    const weakest = Object.entries(s.readiness.detail).sort((a, b) => (a[1].pts / a[1].max) - (b[1].pts / b[1].max))[0];
    const names = Object.keys(S.params.sites).map(c => c).join(' / ');
    out.push(`<div class="banner amber">⚠️ READINESS ${s.readiness.score}/100 — below scale-ready. Weakest: ${weakest[0]} (${s.readiness.detail[weakest[0]].value}${weakest[0] === 'debt' ? ' days' : weakest[0] === 'cover' ? 'd cover' : '%'}).
      <span class="act">Managers not reporting or leaking drive this score — call ${esc(names)} managers now.</span></div>`);
  }
  return out.join('');
}

function rDash() {
  const s = S.summary;
  const r = s.readiness;
  const cards = rBanners() + `
  <div class="cards">
    <div class="card"><div class="lbl">Production today</div><div class="val">${fmt(s.net.actual)}<span class="muted" style="font-size:14px"> / ${fmt(s.net.expected)}</span></div>
      <div class="sub">loaves baked · variance <span>${s.net.status === 'critical' ? '🚨' : s.net.status === 'minor' ? '⚠️' : '✅'} ${pctSign(-s.net.variancePct)}</span></div></div>
    <div class="card"><div class="lbl">Revenue today (cash)</div><div class="val">${ghs(s.price != null ? s.cashLoaves * s.price : null)}</div>
      <div class="sub">${s.price != null ? fmt(s.cashLoaves) + ' loaves cashed × GHS ' + s.price.toFixed(2) : 'set PRICE to convert'}</div></div>
    <div class="card"><div class="lbl">Kiosk debt outstanding</div><div class="val">${ghs(s.debtTotal)}</div>
      <div class="sub">${s.debtOverdue ? `<span class="bdg w">⚠️ ${s.debtOverdue} overdue &gt; 3d</span>` : '<span class="bdg ok">none overdue</span>'}</div></div>
    <div class="card"><div class="lbl">Min flour cover</div><div class="val">${s.minCover != null ? s.minCover.toFixed(1) + 'd' : '—'}</div>
      <div class="sub">${(() => { const cs = (S.params && S.params.sites) ? Object.values(S.params.sites).map(x => x.coverTarget ?? 3) : [3]; const t = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : 3; return s.minCover != null && s.minCover < t ? `<span class="bdg c">🚨 below ${t} days</span>` : '<span class="bdg ok">safe</span>'; })()} network-wide</div></div>
    <div class="card"><div class="lbl">Scale-up readiness</div><div class="val">${r.score}/100</div>
      <div class="scorebar"><i style="width:${r.score}%"></i></div>
      <div class="sub" style="margin-top:6px">${r.score >= 80 ? 'scale-ready' : r.score >= 60 ? 'watch' : 'fix first'}</div></div>
  </div>`;

  const sites = `
  <h2>Sites today</h2>
  <div class="grid3">${Object.keys(S.params.sites).map(code => {
    const site = s.sites[code];
    const cfg = S.params.sites[code];
    const cover = site.cover != null ? site.cover.toFixed(1) + 'd' : '—';
    const spot = (s.spots || {})[code];
    const spotBadge = site.bags ? '' : (spot && spot.level === 'blind' ? ' <span class="bdg c">🚨 BLIND SPOT</span>' : spot && spot.level === 'delayed' ? ' <span class="bdg w">⚠️ DELAYED</span>' : ' <span class="bdg m">data gap</span>');
    return `<div class="card">
      <div class="row" style="justify-content:space-between"><b>${esc(cfg.name)}</b>${badge(site.status)}${spotBadge}</div>
      <div class="small" style="margin-top:2px">${esc(cfg.region)} · session ${cfg.session || '?'} bags · yield ${cfg.yield}/bag</div>
      <table style="margin-top:8px">
        <tr><td class="muted">Baked</td><td class="num">${site.bags ? fmt(site.actual) + ' / ' + fmt(site.expected) : 'not logged'}</td></tr>
        <tr><td class="muted">Sessions</td><td class="num">${site.sessions.length}</td></tr>
        <tr><td class="muted">Flour stock</td><td class="num">${site.stock == null ? '?' : site.stock + ' bags'} ${site.low ? '🚨' : ''}</td></tr>
        <tr><td class="muted">Cover</td><td class="num">${cover}</td></tr>
      </table>
    </div>`;
  }).join('')}</div>`;

  const route = `
  <h2>Route score (today)</h2>
  <div class="card"><table>
    <tr><th>Driver</th><th class="num">Trips</th><th class="num">Dispatched</th><th class="num">Cash</th><th class="num">Credit</th><th class="num">GHS cash</th><th>Status</th></tr>
    ${Object.values(s.drivers).map(d => `<tr><td>${esc(d.driver)}</td><td class="num">${d.trips}</td><td class="num">${fmt(d.dispatched)}</td><td class="num">${fmt(d.cash)}</td><td class="num">${fmt(d.cr)}</td><td class="num">${ghs(d.ghs)}</td><td>${d.status === 'ok' ? '<span class="bdg ok">✅ 100%</span>' : '<span class="bdg c">🚨 short ' + fmt(d.gap) + '</span>'}</td></tr>`).join('') || '<tr><td class="muted">No trips logged yet today.</td></tr>'}
  </table></div>`;

  const alerts = `
  <h2>Alerts (latest)</h2>
  ${s.alerts.slice(0, 8).map(a => `<div class="alert ${a.level}"><div><div class="t">${esc(a.title)} <span class="muted" style="font-weight:400">${a.date}</span></div><div class="b">${esc(a.body)}</div>${a.resolved ? `<div class="res">✓ resolved — ${esc(a.resolution || '')}</div>` : ''}</div></div>`).join('') || '<div class="muted">No alerts. Quiet is good.</div>'}`;

  return cards + sites + route + alerts;
}

// ------------------------------------------------------------ production
function rProd() {
  const rows = [...(S.production || [])].reverse().map(x => `<tr>
    <td>${x.date}</td>
    <td>${esc(S.params.sites[x.site] ? S.params.sites[x.site].name : x.site)}</td><td>S${x.session}</td>
    <td class="num">${x.bags}</td><td class="num">${fmt(x.expected)}</td><td class="num">${fmt(x.actual)}</td>
    <td class="num">${x.actual - x.expected >= 0 ? '+' : '−'}${fmt(Math.abs(x.variance))}</td>
    <td class="num">${pctSign(-x.variancePct)}</td>
    <td>${badge(x.status)}${x.reason ? `<div class="small">reason: ${esc(x.reason)}</div>` : (x.status !== 'ok' && x.date === S.summary.date ? `<button class="logbtn" data-site="${x.site}" data-sess="${x.session}">log reason</button>` : '')}</td>
  </tr>`).join('');
  return `
  <h2>Sessions — last ${Math.min((S.production || []).length, 120)} records (newest first)</h2>
  <div class="card"><table>
    <tr><th>Date</th><th>Site</th><th>Session</th><th class="num">Bags</th><th class="num">Expected</th><th class="num">Actual</th><th class="num">Var (loaves)</th><th class="num">Var %</th><th>Status / Reason</th></tr>
    ${rows || '<tr><td colspan="9" class="muted">No production logged yet. Send: PROD MAM 80 S1-4000 S2-3800</td></tr>'}
  </table></div>
  <div class="small" style="margin-top:10px">Yield rule: expected = bags × configured yield (Mampong: ${S.params.sites.MAM.yield} loaves/bag). Manager replies with <code>REASON MAM S2 &lt;reason&gt;</code> — the reason is logged and shown in the CEO briefing.</div>`;
}

// -------------------------------------------------------------- drivers
function rDrivers() {
  const s = S.summary;
  const dw = driverWeek();
  const top = dw[0];
  const hero = top && top.trips > 0
    ? `<div class="card" style="border-color:var(--amber);margin-bottom:12px">🏆 <b>Driver of the week: ${esc(top.driver)}</b> — ${top.gapPct.toFixed(1)}% gap over ${top.trips} trips (last 7 days). Full leaderboard: 📈 Reports.</div>`
    : '';
  const daily = `
  <h2>Driver accountability — today (${s.date})</h2>
  <div class="card"><table>
    <tr><th>Driver</th><th class="num">Trips</th><th class="num">Dispatched</th><th class="num">Cash</th><th class="num">Credit</th><th class="num">Returns</th><th class="num">Gap</th><th>Status</th></tr>
    ${Object.values(s.drivers).map(d => `<tr><td>${esc(d.driver)}</td><td class="num">${d.trips}</td><td class="num">${fmt(d.dispatched)}</td><td class="num">${fmt(d.cash)}</td><td class="num">${fmt(d.cr)}</td><td class="num">${fmt(d.ret)}</td>
      <td class="num">${d.gap > 0 ? '−' + fmt(d.gap) : '0'} (${d.gapPct.toFixed(1)}%)</td>
      <td>${d.status === 'ok' ? '<span class="bdg ok">✅ accounted</span>' : '<span class="bdg c">🚨 shortage alert</span>'}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No trips logged yet.</td></tr>'}
  </table></div>
  <div class="small" style="margin-top:8px">Rule: Dispatched = Cash + Credit + Returns. Any gap &gt; 1% raises a 🚨 DRIVER SHORTAGE ALERT.</div>`;
  const recent = [...(S.trips || [])].reverse().slice(0, 25).map(t => `<tr>
    <td>${t.date}</td><td>${esc(t.driver)}</td><td class="num">${t.trip || '—'}</td><td class="num">${fmt(t.dispatched)}</td>
    <td class="num">${fmt(t.cashLoaves)}</td><td class="num">${fmt(t.crLoaves)}</td><td class="num">${fmt(t.retLoaves)}</td>
    <td>${t.status === 'ok' ? '<span class="bdg ok">✅</span>' : '<span class="bdg c">🚨 short ' + fmt(t.short) + '</span>'}</td></tr>`).join('');
  const tripTable = `
  <h2>Recent trips</h2>
  <div class="card"><table>
    <tr><th>Date</th><th>Driver</th><th class="num">Trip</th><th class="num">Dispatched</th><th class="num">Cash</th><th class="num">Credit</th><th class="num">Returns</th><th>Status</th></tr>
    ${recent || '<tr><td colspan="8" class="muted">No trips yet.</td></tr>'}
  </table></div>`;

  const rem = [...(S.remittances || [])].reverse().slice(0, 20);
  const remTable = `
  <h2>Cash remittances (driver → Manager)</h2>
  <div class="card"><table>
    <tr><th>Date</th><th>Driver</th><th class="num">Expected GHS</th><th class="num">Remitted GHS</th><th class="num">Gap</th><th>Status</th></tr>
    ${rem.map(r => `<tr><td>${r.date}</td><td>${esc(r.driver)}</td><td class="num">${ghs(r.expected)}</td><td class="num">${ghs(r.actual)}</td>
      <td class="num">${r.gap >= 0 ? '+' : '−'}${fmt(Math.abs(r.gap))} (${r.gapPct}%)</td>
      <td>${r.status === 'ok' ? '<span class="bdg ok">✅ reconciled</span>' : '<span class="bdg c">🚨 CASH HANDLING ALERT</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">None logged. When a Manager confirms a driver\'s cash: REMITTED &lt;driver&gt; &lt;GHS&gt;</td></tr>'}
  </table></div>
  <div class="small" style="margin-top:8px">Cash Reconciliation Rule: gap &gt; 0.5% between driver-reported cash and Manager-remitted amount → 🚨 CASH HANDLING ALERT to the CEO. Closes the driver→Manager loop.</div>
  <div class="row" style="margin-top:10px"><label class="field">Record a remittance
    <span class="row"><select id="rem-driver">${Object.values(s.drivers).map(d => `<option>${d.driver}</option>`).join('')}</select>
    <input type="number" id="rem-amount" placeholder="GHS amount" style="min-width:130px"><button class="primary" id="rem-go">REMITTED ➤</button></span></label></div>`;
  return hero + daily + tripTable + remTable;
}

// ----------------------------------------------------------------- debt
function rDebt() {
  const s = S.summary;
  const refusals = (S.creditRefusals || []).filter(r => r.date === s.date);
  const da = debtAgingData();
  const recPct = da.issued > 0 ? Math.round(da.paid / da.issued * 100) : 0;
  const agingStr = ['fresh', 'watch', 'escalate', 'chronic'].map((b, i) => [
    ['≤3d', '4–7d', '8–30d', '>30d'][i] + ' ' + ghs(da.totals[b] || 0),
  ][0]).join(' · ');
  return `
  <h2>Kiosk debt ledger</h2>
  <div class="card"><table>
    <tr><th>Kiosk</th><th class="num">Outstanding</th><th>Since</th><th class="num">Age</th><th class="num">Payments</th><th>Status</th></tr>
    ${s.debt.map(k => `<tr><td>${esc(k.kiosk)}</td><td class="num">${ghs(k.outstanding)}</td><td>${k.issued}</td><td class="num">${k.days}d</td>
      <td class="num">${k.payments.length ? k.payments.map(p => ghs(p.amount)).join(', ') : '—'}</td>
      <td>${k.outstanding === 0 ? '<span class="bdg ok">✅ cleared</span>' : k.escalate ? '<span class="bdg c">🚨 escalate &gt; 7d</span>' : k.overdue ? '<span class="bdg w">⚠️ NO CREDIT &gt; 3d</span>' : '<span class="bdg ok">on track</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No kiosk debts recorded. Use: KIOSK &lt;name&gt; OWES-300 / PAID-150</td></tr>'}
  </table></div>
  <div class="small" style="margin-top:8px">Total outstanding: <b>${ghs(s.debtTotal)}</b> · Aging: ${agingStr} · Recovery: <b>${recPct}%</b> of issued credit collected (GHS ${fmt(da.paid)}). Credit Approval Rule: drivers may only issue credit to kiosks with no balance overdue &gt; 3 days — when they refuse, they report <code>REFUSED-CREDIT &lt;name&gt;</code> and it's logged as discipline below.</div>
  <h2>Credit refusals today (discipline signal)</h2>
  <div class="card">
    ${refusals.length ? refusals.map(r => `<div class="alert warn"><div><div class="t">✅ Refused credit — ${esc(r.kiosk)}</div><div class="b">Reported by ${esc(r.by)} · ${r.ts.slice(11, 16)} · cash demanded per policy</div></div></div>`).join('') : '<div class="muted">None logged today.</div>'}
  </div>`;
}

// ----------------------------------------------------------------- radar
function rRadar() {
  const TOWN_CLASS = { 1: 'village cluster', 2: 'settlement', 3: 'town / district capital', 4: 'regional capital' };
  const advice = S.radar; // computed server-side
  let html = `
  <h2>Expansion Radar — neighboring town intelligence</h2>
  <div class="card"><b>${esc(advice.line)}</b>${advice.nextBranch ? `<div class="small" style="margin-top:6px"> ${esc(advice.nextBranch)}</div>` : ''}
  <div class="small" style="margin-top:6px">Gate: ${esc(advice.gate)} — the radar only recommends new drops when stock cover and readiness justify it. Distances ≈ road km from public data; verify with drivers before committing.</div></div>`;
  for (const site of advice.radar) {
    const pick = site.towns.find(t => !t.ownSite) || site.towns[0];
    html += `
    <h2>${esc(site.name)} (${site.site})</h2>
    <div class="card"><table>
      <tr><th>Town</th><th>≈ km</th><th>Dir</th><th>Class</th><th>Market notes</th></tr>
      ${site.towns.map(t => `<tr style="${t.town === pick.town ? 'background:rgba(37,211,102,.06)' : ''}"><td>${t.town === pick.town ? '⭐ ' : ''}${esc(t.town)}${t.ownSite ? ' <span class="bdg m">our site</span>' : ''}</td><td class="num">${t.dist}</td><td>${t.dir}</td><td>${esc(TOWN_CLASS[t.cls] || '—')}</td><td class="small">${esc(t.note)}</td></tr>`).join('')}
    </table>
    <div class="small" style="margin-top:8px">Recommended next drop for ${esc(site.name)}: <b>${esc(pick.town)}</b> (~${pick.dist} km ${pick.dir}) — ${esc(pick.note)}</div></div>`;
  }
  return html;
}

// ---------------------------------------------------------------- stock
function rStock() {
  const s = S.summary;
  const rows = Object.keys(S.params.sites).map(code => {
    const site = s.sites[code];
    const cfg = S.params.sites[code];
    const usage = S.summary.date; // avg usage shown via cover
    return `<tr><td>${esc(cfg.name)}</td><td class="num">${site.stock == null ? '?' : site.stock}</td><td class="num">${site.cover != null ? site.cover.toFixed(1) + ' days' : '—'}</td>
      <td>${site.stock != null && site.stock < 20 ? '🚨 &lt; 20 bags' : site.cover != null && site.cover < 3 ? '🚨 &lt; 3 days cover' : '<span class="bdg ok">safe</span>'}</td>
      <td>${site.low ? (s.alerts.find(a => a.type === 'stock' && a.site === code && a.date === s.date) || { body: 'Reorder draft in Stock tab.' }).body.replace(/\n/g, '<br>') : '<span class="muted">no action</span>'}</td></tr>`;
  }).join('');
  return `
  <h2>Flour stock & procurement</h2>
  <div class="card"><table>
    <tr><th>Site</th><th class="num">Stock (bags)</th><th class="num">Days of cover</th><th>Trigger</th><th>Reorder draft</th></tr>
    ${rows}
  </table></div>
  <div class="small" style="margin-top:8px">Procurement rule: reorder fires when a site drops <b>below 20 bags OR below 3 days of cover</b> (whichever first). Days of cover = stock ÷ 7-day average daily usage. Update with: <code>STOCK MAM 15</code></div>`;
}


// --------------------------------------------------------------- brief
function rBrief() {
  return `
  <h2>10:00 PM Daily Ops Briefing</h2>
  <div class="row" style="margin-bottom:10px">
    <label class="field">Date <input type="date" id="brief-date" value="${S.summary.date}"></label>
    <button class="primary" id="brief-gen">Generate</button>
    <button id="brief-copy">📋 Copy for WhatsApp</button>
  </div>
  <pre class="brief" id="brief-out">Press Generate…</pre>
  <div class="small" style="margin-top:8px">Auto-generated and pushed to the CEO's WhatsApp at 22:00 (set the CEO number in Settings). Also: a 9:00 PM nudge goes to any silent site's Manager, and a site still silent at 10 PM shows as 🚨 OPERATIONAL BLIND SPOT. Weekly / Monthly / Yearly reviews live in the 📈 Reports tab.</div>`;
}

// ----------------------------------------------------------------- log
function rLog() {
  const s = S.summary;
  return `
  <h2>Message log (ingested)</h2>
  ${s.log.slice(0, 40).map(l => `
    <div class="alert"><div style="flex:1">
      <div class="t">${esc(l.from)} <span class="muted" style="font-weight:400">· ${l.date} ${l.ts.slice(11, 16)}</span></div>
      <div class="b">${esc(l.text)}</div>
      <div class="res" style="color:var(--text)">🛡️ ${esc(l.reply)}</div>
      ${l.events && l.events.length ? `<div class="b">alerts: ${l.events.map(esc).join(' · ')}</div>` : ''}
    </div></div>`).join('') || '<div class="muted">Nothing ingested yet — send a message below.</div>'}`;
}

// ------------------------------------------------------------- chat
function renderChat() {
  const chat = $('#chat');
  const items = S.summary.log.slice(0, 14).reverse();
  chat.innerHTML = items.map(l => `
    <div class="bubble user"><div class="meta">${esc(l.from)} · ${l.date} ${l.ts.slice(11, 16)}</div>${esc(l.text)}</div>
    <div class="bubble bot"><div class="meta">🛡️ BakeGuard</div>${esc(l.reply)}${l.events && l.events.length ? `<div class="meta" style="margin-top:4px">⚑ ${l.events.map(esc).join(' · ')}</div>` : ''}</div>
  `).join('') || '<div class="muted" style="padding:6px 2px">Send a message below — the COO replies here, exactly as it would on WhatsApp.</div>';
  chat.scrollTop = chat.scrollHeight;
}

// ------------------------------------------------------------ reports
const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000));
function allDates() {
  const set = new Set();
  (S.production || []).forEach(x => set.add(x.date));
  (S.trips || []).forEach(t => set.add(t.date));
  return [...set].sort();
}
function driverWeek() {
  const dates = allDates().slice(-7);
  const byD = {};
  for (const t of (S.trips || [])) if (dates.includes(t.date)) {
    const b = byD[t.driver] = byD[t.driver] || { driver: t.driver, dispatched: 0, got: 0, trips: 0, cash: 0 };
    b.dispatched += t.dispatched; b.got += t.cashLoaves + t.crLoaves + t.retLoaves; b.trips++; b.cash += t.cashLoaves;
  }
  return Object.values(byD).map(b => ({ ...b, gapPct: b.dispatched > 0 ? (b.dispatched - b.got) / b.dispatched * 100 : 0 }))
    .sort((a, b) => a.gapPct - b.gapPct || b.cash - a.cash);
}
function debtAgingData() {
  const rows = (S.summary.debt || []).filter(k => k.outstanding > 0).map(k => ({ ...k, bucket: k.days <= 3 ? 'fresh' : k.days <= 7 ? 'watch' : k.days <= 30 ? 'escalate' : 'chronic' }));
  const kd = (S.summary.debt && S.summary.debt.length) ? S.summary.debt : (S.kioskDebt || []);
  const paid = kd.reduce((a, k) => a + (k.payments || []).reduce((p, x) => p + x.amount, 0), 0);
  const issued = kd.reduce((a, k) => a + k.outstanding + (k.payments || []).reduce((p, x) => p + x.amount, 0), 0);
  const totals = rows.reduce((a, k) => (a[k.bucket] = (a[k.bucket] || 0) + k.outstanding, a), {});
  return { rows, paid, issued, totals };
}
function cashTrendSVG() {
  const price = S.summary.price;
  const dates = allDates().slice(-14);
  if (!dates.length) return '';
  const per = dates.map(d => {
    const ts = (S.trips || []).filter(t => t.date === d);
    return { d, disp: ts.reduce((a, t) => a + t.dispatched, 0), cash: ts.reduce((a, t) => a + t.cashLoaves, 0) };
  });
  const maxV = Math.max(1, ...per.map(x => Math.max(x.disp, x.cash)));
  const n = per.length, slot = 600 / n, bw = Math.max(6, Math.min(14, slot / 2 - 3));
  const bars = per.map((x, i) => {
    const x0 = 20 + i * slot;
    const h1 = (x.disp / maxV) * 96, h2 = (x.cash / maxV) * 96;
    return `<rect x="${x0}" y="${160 - h1}" width="${bw}" height="${h1}" fill="#33445a" rx="2"/>
      <rect x="${x0 + bw + 2}" y="${160 - h2}" width="${bw}" height="${h2}" fill="#3ddc84" rx="2"/>
      <text x="${x0 + bw + 1}" y="178" text-anchor="middle" font-size="10" fill="#8b98a9">${DAYN[new Date(x.d + 'T00:00:00Z').getUTCDay()]}</text>`;
  }).join('');
  const unit = price != null ? 'GHS' : 'loaves';
  const val = x => (price != null ? Math.round(x * price) : Math.round(x)).toLocaleString('en-US');
  const last = per[per.length - 1];
  return `<svg viewBox="0 0 640 195" style="width:100%;max-width:780px;display:block">
    <text x="20" y="18" font-size="12.5" fill="#8b98a9">Cash collected vs dispatched (expected) — last ${dates.length} days · ${unit} · today: ${val(last.cash)} of ${val(last.disp)}</text>
    <rect x="20" y="28" width="12" height="12" fill="#33445a" rx="2"/><text x="37" y="39" font-size="11.5" fill="#8b98a9">Expected (dispatched)</text>
    <rect x="180" y="28" width="12" height="12" fill="#3ddc84" rx="2"/><text x="197" y="39" font-size="11.5" fill="#8b98a9">Cash collected</text>
    <line x1="20" y1="160" x2="620" y2="160" stroke="#1f2a37"/>
    ${bars}
  </svg>`;
}
function rReports() {
  const s = S.summary;
  const dw = driverWeek();
  const da = debtAgingData();
  const top = dw[0];
  const lbRows = dw.map((b, i) => `<tr><td>${i === 0 && b.trips > 0 ? '🏆 ' : ''}${esc(b.driver)}</td><td class="num">${b.trips}</td><td class="num">${fmt(b.dispatched)}</td><td class="num">${s.price != null ? ghs(b.cash * s.price) : fmt(b.cash) + ' loaves'}</td><td class="num">${b.gapPct.toFixed(1)}%</td><td>${b.gapPct <= 1 ? '<span class="bdg ok">✅</span>' : b.gapPct <= 3 ? '<span class="bdg w">⚠️</span>' : '<span class="bdg c">🚨</span>'}</td></tr>`).join('');
  const bucketLbl = { fresh: '≤ 3 days', watch: '4–7 days', escalate: '8–30 days', chronic: '> 30 days' };
  const agingRows = Object.keys(bucketLbl).map(b => `<tr><td>${bucketLbl[b]}</td><td class="num">${ghs(da.totals[b] || 0)}</td></tr>`).join('');
  const recPct = da.issued > 0 ? Math.round(da.paid / da.issued * 100) : 0;
  const agingWarn = da.rows.some(k => k.bucket === 'chronic' || k.bucket === 'escalate');
  return `
  <h2>Reports — one dropdown, every period</h2>
  <div class="row" style="margin-bottom:10px">
    <label class="field">Report
      <select id="rep-type">
        <option value="daily">Daily (10 PM briefing)</option>
        <option value="weekly" selected>Weekly review</option>
        <option value="monthly">Monthly review</option>
        <option value="yearly">Yearly review</option>
      </select>
    </label>
    <label class="field">Period ending <input type="date" id="rep-date" value="${s.date}"></label>
    <button class="primary" id="rep-gen">Generate</button>
    <button id="rep-copy">📋 Copy for WhatsApp</button>
  </div>
  <pre class="brief" id="rep-out">Press Generate…</pre>
  <div class="small" style="margin-top:8px">Every report ends with *COO recommendations* — data-driven actions, not opinions. Weekly = Sundays 10 PM (auto-pushed to WhatsApp once the API is connected).</div>

  <h2>Cash trend — last 14 days</h2>
  <div class="card" style="overflow-x:auto">${cashTrendSVG() || '<span class="muted">No trip data yet.</span>'}</div>

  <div style="display:grid;grid-template-columns:1.25fr 1fr;gap:14px;margin-top:14px">
    <div>
      <h2>Driver leaderboard (last 7 days)</h2>
      <div class="card"><table>
        <tr><th>Driver</th><th class="num">Trips</th><th class="num">Dispatched</th><th class="num">Cash</th><th class="num">Gap</th><th></th></tr>
        ${lbRows || '<tr><td colspan="6" class="muted">No trips in the last 7 days.</td></tr>'}
      </table>
      ${top && top.trips > 0 ? `<div class="small" style="margin-top:8px">🏆 <b>Driver of the week: ${esc(top.driver)}</b> — ${top.gapPct.toFixed(1)}% gap over ${top.trips} trips. Name them in the 10 PM briefing; consistency beats heroics.</div>` : ''}
      </div>
    </div>
    <div>
      <h2>Debt aging & recovery</h2>
      <div class="card">
        <table>
          <tr><th>Age bucket</th><th class="num">Outstanding</th></tr>
          ${agingRows}
        </table>
        <div class="small" style="margin-top:8px">Credit recovery: <b>${ghs(da.paid)}</b> of <b>${ghs(da.issued)}</b> issued collected (<b>${recPct}%</b>). ${agingWarn ? '⚠️ Debt is aging — chase the 8+ day balances before they harden into write-offs.' : 'All debt is young — collection discipline holding.'}</div>
      </div>
    </div>
  </div>`;
}

function bindView() {
  if (tab === 'brief') {
    const gen = async () => {
      const date = $('#brief-date').value || S.summary.date;
      const r = await api('/api/briefing?date=' + date);
      $('#brief-out').textContent = r.text;
    };
    $('#brief-gen').onclick = gen;
    const copy = (id, preId) => navigator.clipboard.writeText($(preId).textContent).then(() => { $(id).textContent = '✓ Copied'; setTimeout(() => $(id).textContent = '📋 Copy for WhatsApp', 1500); });
    $('#brief-copy').onclick = () => copy('#brief-copy', '#brief-out');
    gen();
  }
  if (tab === 'reports') {
    const gen = async () => {
      const type = $('#rep-type').value;
      const d = $('#rep-date').value || S.summary.date;
      try { $('#rep-out').textContent = 'Generating…'; const r = await api('/api/report?type=' + type + '&date=' + d); $('#rep-out').textContent = r.text; }
      catch (e) { $('#rep-out').textContent = 'Error: ' + e.message; }
    };
    $('#rep-gen').onclick = gen;
    $('#rep-type').onchange = gen;
    $('#rep-copy').onclick = () => navigator.clipboard.writeText($('#rep-out').textContent).then(() => { const b = $('#rep-copy'); b.textContent = '✓ Copied'; setTimeout(() => b.textContent = '📋 Copy for WhatsApp', 1500); });
    gen();
  }
  if (tab === 'drivers') {
    const go = document.getElementById('rem-go');
    if (go) go.onclick = async () => {
      const drv = document.getElementById('rem-driver').value;
      const amt = document.getElementById('rem-amount').value;
      if (!drv || amt === '') return;
      await sendToEngine('Manager (dashboard)', `REMITTED ${drv} ${amt}`);
    };
  }
  if (tab === 'prod') {
    $$('.logbtn').forEach(b => b.onclick = () => {
      const reason = prompt(`Manager's reason for ${b.dataset.site} S${b.dataset.sess}:`);
      if (!reason) return;
      sendToEngine(b.dataset.site + ' Manager', `REASON ${b.dataset.site} S${b.dataset.sess} ${reason}`, true);
    });
  }
}
function flash(msg) { const d = document.createElement('div'); d.className = 'bdg ok'; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 1200); }

// ------------------------------------------------------------ composer
async function sendToEngine(from, text, silent = false) {
  if (!text.trim()) return;
  const r = await api('/api/ingest', { from, text });
  await refresh();
  if (!silent) { $('#msg').value = ''; }
}

async function init() {
  $('#from').innerHTML = SENDER_ROLES.map(([label, v]) => `<option value="${v}">${label}</option>`).join('');
  $('#samples').innerHTML = SAMPLES.map(s => `<span class="chip">${esc(s)}</span>`).join('');
  $$('.chip').forEach(c => c.onclick = () => { $('#msg').value = c.textContent; $('#msg').focus(); });
  const doSend = async () => {
    const from = $('#from').value;
    const text = $('#msg').value;
    if (!text.trim()) return;
    $('#msg').value = '';
    // optimistic bubble
    const chat = $('#chat');
    const u = document.createElement('div'); u.className = 'bubble user';
    u.innerHTML = `<div class="meta">${esc(from)}</div>${esc(text)}`;
    chat.appendChild(u); chat.scrollTop = chat.scrollHeight;
    try { await sendToEngine(from, text); } catch (e) { alert('Error: ' + e.message); await refresh(); }
  };
  $('#send').onclick = doSend;
  $('#msg').addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
  $$('#tabs button').forEach(b => b.onclick = () => {
    $$('#tabs button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); tab = b.dataset.tab; render();
  });
  await refresh();
  setInterval(() => { if (tab === 'dash') refresh(); }, 60000);
}
init();
