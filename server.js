'use strict';
// BakeGuard Ops — zero-dependency Node server: dashboard + engine API + WhatsApp webhook.
const http = require('http');
const fs = require('fs');
const path = require('path');

const { load, save, todayStr, defaultState } = require('./lib/store');
const { ingest, computeSummary, runDataGapNudge } = require('./lib/rules');
const { briefingText, weeklyReview, monthlyReview, yearlyReview } = require('./lib/reporter');
const { seedDemo } = require('./lib/seed');
const { radarAdvice } = require('./lib/market');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// ---------- admin gate (public deployment safety) ----------
// The owner dashboard and CEO view are public; /admin and its write endpoints
// require a password. Set BAKEGUARD_ADMIN_PASS in the Render dashboard to change it.
const ADMIN_PASS = process.env.BAKEGUARD_ADMIN_PASS || 'hope2026';
function adminAuthed(req, url) {
  const q = url.searchParams.get('pass');
  const h = req.headers['x-admin-pass'];
  const m = String(req.headers.cookie || '').match(/bg_admin=([^;]+)/);
  const c = m ? decodeURIComponent(m[1]) : null;
  return q === ADMIN_PASS || h === ADMIN_PASS || c === ADMIN_PASS;
}
function sendLogin(res) {
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>Admin — BakeGuard</title>
<style>body{background:#0b1118;color:#e8edf4;font:15px system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
form{background:#141d28;border:1px solid #2a3a4c;border-radius:12px;padding:26px 28px;width:300px}
h2{margin:0 0 6px;font-size:18px}p{color:#8fa1b3;font-size:12px;margin:0 0 16px}
input{width:100%;box-sizing:border-box;background:#0b1118;border:1px solid #2a3a4c;border-radius:8px;color:#e8edf4;padding:10px 12px;font-size:15px}
button{width:100%;margin-top:12px;background:#1d6fb8;border:none;border-radius:8px;color:#fff;padding:10px;font-size:15px;cursor:pointer}</style></head>
<body><form onsubmit="location='/admin?pass='+encodeURIComponent(this.p.value);return false">
<h2>🛡️ BakeGuard — Admin</h2><p>Engineer area. Enter the admin password to continue.</p>
<input name="p" type="password" placeholder="Admin password" autofocus>
<button type="submit">Unlock</button></form></body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page);
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) { req.destroy(); reject(new Error('body too large')); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function serveStatic(req, res, p) {
  let file = path.join(PUB, p.replace(/^\/+/, ''));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end('forbidden'); }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': (MIME[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
  res.end(fs.readFileSync(file));
}

function waCreds(state) {
  const wa = state.config.whatsapp || {};
  return {
    pnid: wa.phone_number_id || process.env.WA_PHONE_NUMBER_ID || '',
    token: wa.token || process.env.WA_TOKEN || '',
  };
}
async function sendWhatsApp(state, to, text) {
  const { pnid, token } = waCreds(state);
  if (!pnid || !token || !to) return { ok: false, reason: 'not configured' };
  try {
    const resp = await fetch(`https://graph.facebook.com/v19.0/${pnid}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    });
    const j = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, error: j.error && j.error.message };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
async function deliverWhatsApp(state, replies) {
  const { pnid, token } = waCreds(state);
  if (!pnid || !token) return { configured: false, sent: [] };
  const sent = [];
  for (const r of replies) sent.push({ to: r.to, ...(await sendWhatsApp(state, r.to, r.text)) });
  return { configured: true, sent };
}

// ---------------- scheduler: 9 PM nudge · 10 PM briefing · Sunday weekly ----
const sched = { nudge: null, brief: null, weekly: null };

async function pushReport(state, date, label, text) {
  state.log.unshift({
    id: 'sched' + Date.now().toString(36), date, ts: new Date().toISOString(),
    from: '⏰ Scheduler', text: label, reply: text, events: [],
  });
  if (state.log.length > 1000) state.log.length = 1000;
  let pushed = false;
  if (state.config.whatsapp.ceo) {
    const r = await sendWhatsApp(state, state.config.whatsapp.ceo, text);
    pushed = !!r.ok;
  }
  return { pushed };
}

async function runNudgeCheck() {
  const state = load();
  const events = runDataGapNudge(state);
  for (const ev of events) {
    const phone = (state.config.whatsapp.managers || {})[ev.site];
    if (phone) {
      const r = await sendWhatsApp(state, phone, ev.text);
      const n = state.nudges.filter(x => x.site === ev.site).pop();
      if (n) n.delivered = !!r.ok;
    }
  }
  if (events.length) {
    console.log(`[9PM nudge] ${events.map(e => e.site).join(', ')}`);
    save(state);
  }
}

async function runBriefingPush(isSunday) {
  const state = load();
  const date = todayStr();
  await pushReport(state, date, '10:00 PM daily briefing — auto-generated', briefingText(state, date));
  if (isSunday) await pushReport(state, date, 'Sunday 10:00 PM Weekly Business Review — auto-generated', weeklyReview(state, date));
  save(state);
  console.log(`[10PM] briefing pushed${isSunday ? ' + weekly' : ''}${state.config.whatsapp.ceo ? ' to CEO WhatsApp' : ' (logged only — set CEO phone to push)'}`);
}

setInterval(async () => {
  try {
    const now = new Date();
    const h = now.getUTCHours(); // Ghana = UTC
    const date = todayStr(now);
    if (h === 21 && sched.nudge !== date) { sched.nudge = date; await runNudgeCheck(); }
    if (h === 22 && sched.brief !== date) { sched.brief = date; await runBriefingPush(now.getUTCDay() === 0); }
  } catch (e) { console.error('scheduler error:', e); }
}, 60000);

// Catch-up on boot: if we came up after 9 PM / 10 PM today, do what we missed.
(async () => {
  try {
    const now = new Date();
    const date = todayStr(now);
    if (now.getUTCHours() >= 21 && sched.nudge !== date) { sched.nudge = date; await runNudgeCheck(); }
    if (now.getUTCHours() >= 22 && sched.brief !== date) { sched.brief = date; await runBriefingPush(now.getUTCDay() === 0); }
  } catch (e) { console.error('catch-up error:', e); }
})();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    // ---------- static ----------
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveStatic(req, res, '/index.html');
    if (req.method === 'GET' && p === '/ceo') return serveStatic(req, res, '/ceo.html');
    if (req.method === 'GET' && p === '/admin') {
      if (!adminAuthed(req, url)) return sendLogin(res);
      if (url.searchParams.get('pass')) {
        res.writeHead(302, { Location: '/admin', 'Set-Cookie': `bg_admin=${encodeURIComponent(ADMIN_PASS)}; Path=/; HttpOnly; Max-Age=2592000; SameSite=Lax` });
        return res.end();
      }
      return serveStatic(req, res, '/admin.html');
    }
    if (req.method === 'POST' && (p === '/api/config' || p === '/api/reset' || p === '/api/demo') && !adminAuthed(req, url)) {
      return sendJSON(res, 401, { error: 'admin password required (x-admin-pass header, pass= query, or login at /admin)' });
    }
    if (req.method === 'GET' && p !== '/api/state' && !p.startsWith('/api/') && p !== '/webhook') {
      if (p.startsWith('/style') || p.startsWith('/app') || p.startsWith('/logo')) return serveStatic(req, res, p);
    }

    // ---------- engine API ----------
    if (req.method === 'GET' && p === '/api/state') {
      const state = load();
      return sendJSON(res, 200, {
        params: state.params, config: state.config,
        production: state.production.slice(-120),
        trips: state.trips.slice(-120),
        creditRefusals: state.creditRefusals.slice(-50),
        remittances: state.remittances.slice(-50),
        nudges: state.nudges.slice(-20),
        delayedAcks: state.delayedAcks.slice(-20),
        radar: radarAdvice(state),
        summary: computeSummary(state),
      });
    }
    if (req.method === 'POST' && p === '/api/ingest') {
      const body = await readBody(req);
      const state = load();
      const result = ingest(state, { from: body.from || 'Manager', text: body.text || '' });
      save(state);
      return sendJSON(res, 200, { reply: result.reply, events: result.events, summary: computeSummary(state) });
    }
    if (req.method === 'GET' && p === '/api/briefing') {
      const state = load();
      const date = url.searchParams.get('date') || todayStr();
      return sendJSON(res, 200, { date, text: briefingText(state, date) });
    }
    if (req.method === 'GET' && p === '/api/weekly') {
      const state = load();
      const date = url.searchParams.get('date') || todayStr();
      return sendJSON(res, 200, { date, text: weeklyReview(state, date) });
    }
    if (req.method === 'GET' && p === '/api/report') {
      const state = load();
      const type = url.searchParams.get('type') || 'weekly';
      const date = url.searchParams.get('date') || todayStr();
      let text;
      if (type === 'daily') text = briefingText(state, date);
      else if (type === 'monthly') text = monthlyReview(state, date);
      else if (type === 'yearly') text = yearlyReview(state, date);
      else text = weeklyReview(state, date);
      return sendJSON(res, 200, { type, date, text });
    }
    if (req.method === 'POST' && p === '/api/config') {
      const body = await readBody(req);
      const state = load();
      const changes = [];
      const logChange = (scope, field, oldV, newV) => {
        if (oldV !== newV) changes.push({ ts: new Date().toISOString(), by: body.by || 'Admin GUI', scope, field, old: oldV, new: newV });
      };
      if (body.network) {
        const n = state.params.network;
        for (const k of ['price', 'debtDays', 'debtEscalateDays', 'remGap']) {
          if (body.network[k] !== undefined) {
            const oldV = n[k];
            n[k] = body.network[k] === '' || body.network[k] == null ? null : Number(body.network[k]);
            logChange('network', k, oldV, n[k]);
          }
        }
      }
      if (body.drivers) {
        state.params.drivers = state.params.drivers || {};
        for (const [drv, site] of Object.entries(body.drivers)) {
          if (site && state.params.sites[site]) state.params.drivers[drv] = site;
          else delete state.params.drivers[drv];
        }
      }
      if (body.sites) {
        const numKeys = ['yield', 'batch', 'session', 'price', 'reorder', 'coverTarget', 'varMinor', 'varCrit', 'driverGap'];
        for (const [code, patch] of Object.entries(body.sites)) {
          if (state.params.sites[code]) {
            for (const k of numKeys) {
              if (patch[k] !== undefined && patch[k] !== '') { const oldV = state.params.sites[code][k]; state.params.sites[code][k] = patch[k] === null ? null : Number(patch[k]); logChange(code, k, oldV, state.params.sites[code][k]); }
              else if (patch[k] === '') { const oldV = state.params.sites[code][k]; state.params.sites[code][k] = null; logChange(code, k, oldV, null); }
            }
            if (patch.name) { const oldV = state.params.sites[code].name; state.params.sites[code].name = String(patch.name); logChange(code, 'name', oldV, state.params.sites[code].name); }
          }
        }
      }
      if (body.resetDefault && state.params.sites[body.resetDefault]) {
        const code = body.resetDefault;
        const def = defaultState().params.sites[code] || {};
        for (const [k, v] of Object.entries(def)) {
          if (state.params.sites[code][k] !== v) logChange(code, k, state.params.sites[code][k], v);
          state.params.sites[code][k] = v;
        }
      }
      if (changes.length && !body.dryRun) {
        state.paramLog = state.paramLog || [];
        state.paramLog.push(...changes);
        if (state.paramLog.length > 200) state.paramLog = state.paramLog.slice(-200);
      }
      if (body.dryRun) return sendJSON(res, 200, { ok: true, dryRun: true, changes, lastChange: changes.length ? changes[changes.length - 1] : null });
      if (body.whatsapp) {
        for (const k of ['phone_number_id', 'token', 'verify_token', 'ceo']) {
          if (body.whatsapp[k] !== undefined) state.config.whatsapp[k] = String(body.whatsapp[k]).trim();
        }
        if (body.whatsapp.managers) {
          for (const k of ['MAM', 'NKZ', 'TCH']) {
            state.config.whatsapp.managers[k] = String(body.whatsapp.managers[k] || '').trim();
          }
        }
      }
      save(state);
      return sendJSON(res, 200, { ok: true, params: state.params, config: state.config, changes, lastChange: changes.length ? changes[changes.length - 1] : null });
    }
    if (req.method === 'GET' && p === '/api/param-log') {
      const state = load();
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 10));
      const log = [...(state.paramLog || [])].slice(-limit).reverse();
      return sendJSON(res, 200, { log, total: (state.paramLog || []).length });
    }
    if (req.method === 'POST' && p === '/api/demo') {
      const state = seedDemo(load());
      save(state);
      return sendJSON(res, 200, { ok: true, summary: computeSummary(state) });
    }
    if (req.method === 'POST' && p === '/api/reset') {
      const state = load();
      state.production = []; state.trips = []; state.stockLog = [];
      state.kioskDebt = []; state.alerts = []; state.log = [];
      save(state);
      return sendJSON(res, 200, { ok: true, summary: computeSummary(state) });
    }

    // ---------- WhatsApp webhook (Meta Cloud API) ----------
    if (p === '/webhook' && req.method === 'GET') {
      const state = load();
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      const expect = state.config.whatsapp.verify_token || process.env.WA_VERIFY_TOKEN || 'bakeguard-verify';
      if (mode === 'subscribe' && token === expect) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(challenge || '');
      }
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('forbidden');
    }
    if (p === '/webhook' && req.method === 'POST') {
      const payload = await readBody(req);
      const state = load();
      const replies = [];
      for (const entry of payload.entry || []) {
        for (const change of (entry.changes || [])) {
          const value = change.value || {};
          for (const msg of value.messages || []) {
            if (msg.type !== 'text' || !msg.text || !msg.text.body) continue;
            const result = ingest(state, { from: 'WhatsApp ' + (msg.from || '?'), text: msg.text.body });
            replies.push({ to: msg.from, text: result.reply });
          }
          // message status callbacks (delivered/read) — ack only
        }
      }
      save(state);
      const delivery = await deliverWhatsApp(state, replies);
      return sendJSON(res, 200, { ok: true, queued: replies.length, delivery });
    }

    return sendJSON(res, 404, { error: 'not found' });
  } catch (e) {
    return sendJSON(res, 500, { error: String((e && e.stack) || e) });
  }
});

// First boot on a fresh instance (Render): no state file yet → restore the bundled
// seed so the dashboard isn't empty. A mounted persistent disk (/var/data) keeps it
// across redeploys; without a disk the seed is re-applied on each cold start.
const { FILE: STATE_FILE, SEED_FILE } = require('./lib/store');
try {
  if (!fs.existsSync(STATE_FILE) && fs.existsSync(SEED_FILE)) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.copyFileSync(SEED_FILE, STATE_FILE);
    console.log('State file not found — seeded from data/state.seed.json');
  }
} catch (e) { console.warn('state seed bootstrap skipped:', e.message); }

server.listen(PORT, '0.0.0.0', () => {
  console.log(`BakeGuard (HOPE Special Bread) listening on http://0.0.0.0:${PORT}`);
  console.log(`WhatsApp webhook: https://<your-host>/webhook`);
});
