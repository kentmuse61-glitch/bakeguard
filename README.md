# 🛡️ BakeGuard Ops — HOPE Special Bread Virtual COO

A complete, zero-dependency operations system for **HOPE Special Bread** (Mampong · Nkoranza · Techiman). It ingests WhatsApp-style messages from managers and drivers, runs the **Golden Rules** math engine (yield, variance, driver accountability, debt ageing, procurement, cross-check), keeps a full audit trail, and generates the exact **10:00 PM CEO briefing** in WhatsApp format.

**Built with plain Node.js — no npm packages to install or update.**

---

## 🚀 Run it

```bash
node server.js          # http://0.0.0.0:3000  (PORT env var to override)
```

- **CEO view (demo):** `http://localhost:3000/ceo` — the 3 big numbers an owner actually needs: **💸 Money missing today** (who), **🫓 Lost dough 7-day %** (worst site), **📦 Stock alert** (days of cover) + readiness / silent-sites / forecast strip. No tabs, phone-first, auto-refreshes.
- **Full dashboard (ops):** `http://localhost:3000` — the 9 working tabs for you and your managers.
- **Admin (engineer-only, hidden):** `http://localhost:3000/admin` — **per-site parameters (fully editable + audited)**, network thresholds, driver→site mapping, WhatsApp config, parameter change log, **Seed demo week** and **Reset all history**. Deliberately off the main nav so the owner can't wipe evidence by accident. The CEO view never shows parameters or history — results only.
- Engine API: `/api/*`
- WhatsApp webhook: `/webhook`
- Data persists to `data/state.json` (atomic writes, survives restarts)

**Red-alert banners** appear at the top of the Dashboard automatically: a site leaking >5% over 7 days (or a critical single-day bake) raises `🚨 <SITE> LEAKING`, and readiness <60 raises `⚠️ READINESS …/100 — call the managers`.

Open **Admin** → **Seed a demo week** to load 7 days of realistic history (one ⚠️ variance day, one driver shortage, one critical low-stock, one overdue kiosk debt) so every predictive feature has a baseline. **Reset all history** gives you a clean live start (parameters kept).

---

## 📲 WhatsApp infusion (Meta Cloud API)

The webhook and reply sender are already implemented — you only need to connect a Meta Business WhatsApp number:

1. **Meta developer portal** (developers.facebook.com) → *Create App* → type **Business** → add the **WhatsApp** product.
2. In *WhatsApp → API Setup*, set:
   - **Callback URL:** `https://YOUR-HOST/webhook`
   - **Verify token:** whatever you put in Settings → WhatsApp (default `bakeguard-verify`)
   - Meta does a `GET` verification handshake — this app answers it automatically (tested).
3. Get a **permanent token**: Meta Business Suite → System Users → generate token with `whatsapp_business_messaging` + `whatsapp_business_management`.
4. Get your **Phone Number ID** (same page, or via Graph API).
5. Paste both into the dashboard → **Settings → WhatsApp integration** (or use env vars `WA_PHONE_NUMBER_ID` / `WA_TOKEN`).
6. Subscribe your number to receive messages (Meta test number during dev, your production number for live).

That's it. From then on:

- Manager/driver texts your number → `POST /webhook` → same parser + Golden Rules engine as the dashboard → reply sent back on the same number via the Graph API (tested payload format).
- Every inbound/outbound message is logged in the dashboard **Message Log**.
- **Scheduled jobs (built into the server, Ghana = UTC):**
  - **21:00** — silent-site nudge to the Manager phone numbers set in Settings (logged even without numbers)
  - **22:00** — Daily Briefing pushed to the CEO phone number (Settings)
  - **Sundays 22:00** — Weekly Business Review pushed as well
  - Boot catch-up: if the server starts after 9/10 PM, it runs whatever was missed.
  - No numbers set yet? Everything is still generated and appears in the **Message Log** — add the numbers in Settings when ready.

> The in-app composer at the bottom of the dashboard mirrors exactly what happens on WhatsApp — pick a sender role (Manager MAM, Driver KSI, …), type the command, and watch the COO reply.

---

## 💬 WhatsApp commands (plain English or short commands — ambiguous money/counts get a clarifying question, never a guess)

| Command | Example | Effect |
|---|---|---|
| `PROD` | `PROD MAM 80 S1-4000 S2-3800` | Logs sessions; expected = bags × yield; variance thresholds (default 0–2% ✅ / 2–5% ⚠️ / >5% 🚨, Admin-editable per site); auto Manager alert |
| `REASON` | `REASON MAM S2 scale was faulty` | Manager's explanation, logged verbatim, shown in the CEO briefing |
| `TRIP` | `TRIP KSI 1000 CASH-800 CR-200 RET-5 T1` | Per-trip accountability (Dispatched = Cash + Credit + Returns, all loaves); gap above driver-gap % (default 1%, Admin-editable per site) → 🚨 DRIVER SHORTAGE; cross-check vs production + carried buffer before any theft call |
| `STOCK` | `STOCK MAM 15` | Sets flour stock; below reorder trigger (default 20 bags) **or** below days-of-cover target (default 3) — both Admin-editable per site → ready-to-send reorder draft |
| `KIOSK` | `KIOSK ADU KIOSK OWES-350` / `KIOSK ADU KIOSK PAID-100` | Debt ledger in GHS; above debt-alert days (default 3) ⚠️ immediate collection + **NO CREDIT**, above escalate days (default 7) 🚨 CEO escalation — both Admin-editable |
| `REFUSED-CREDIT` | `REFUSED-CREDIT ADU KIOSK` | Driver refused credit to an overdue kiosk and demanded cash — logged as a **discipline signal** in the briefing (warns you if the kiosk wasn't actually overdue) |
| `REMITTED` | `REMITTED KSI 3300` | Manager confirms the driver's cash; reconciled at the driver's **site price** (map drivers with `DRIVER-SITE`). Gap above remittance-gap % (default 0.5%, Admin-editable) → 🚨 CASH HANDLING ALERT |
| `REASON` | `REASON MAM S2 scale recalibrated` | Manager's explanation for a flagged session, logged verbatim for the CEO briefing |
| `DELAYED` | `DELAYED oven maintenance` | Manager's reply to a 9 PM nudge — clears the blind spot, reason logged |
| `YIELD` / `BATCH` / `SESSION` / `PRICE` | `PRICE 1.50` (network) · `PRICE 1.60 MAM` | Live parameters — never hardcoded. Sites without a price inherit the network default (marked as assumption) |
| `DRIVER-SITE` | `DRIVER-SITE KSI MAM` | Maps a driver to the site he loads/sells for → exact cash reconciliation |
| Free text | anything else | Echoed back with a request for the actual figures |

Site codes: **MAM** Mampong (Ashanti) · **NKZ** Nkoranza (Bono East) · **TCH** Techiman (Bono East). Full site names also accepted.

---

## 🧠 The Golden Rules, where they live (`lib/rules.js`)

1. **Yield** — `Expected = Bags × configured yield` (default 100/bag, per site, `YIELD` overridable)
2. **Variance** — per session *and* per day, 0–2% ✅ / 2–5% ⚠️ Manager flag / >5% 🚨 + investigation demand
3. **Driver accountability** — per driver per day; gap >1% → shortage alert with "recount returns" instruction
4. **Money** — GHS = loaves × configured `PRICE`; kiosk debt in GHS
5. **Debt ageing** — >3d ⚠️, >7d 🚨 escalation
6. **Procurement** — <20 bags OR <3 days cover (7-day usage average) → reorder draft with suggested quantity (5-day cover)
7. **Cross-check** — dispatch > production + carried buffer → *reconciliation error* first; theft is the last diagnosis
8. **Sessions** — per-site, per-day, never mixed

**v3 accountability rules:**
9. **Credit Approval** — overdue kiosks (> 3 days) are on the *NO CREDIT list* in the briefing + Debt tab; `REFUSED-CREDIT` logs driver discipline as a positive signal.
10. **Data Gap Escalation** — 21:00: silent sites get a WhatsApp nudge to their Manager (phone numbers set in Settings); `DELAYED <reason>` clears it; still silent at briefing time → **🚨 OPERATIONAL BLIND SPOT**.
11. **Cash Reconciliation** — `REMITTED <driver> <GHS>` vs driver-reported cash at the driver's site price; > 0.5% → 🚨 CASH HANDLING ALERT.
12. **Admin parameters — per site, fully audited** — every operational number the engine uses is editable per site (MAM / NKZ / TCH independently) from `/admin`: yield (loaves/bag), batch (bags), session (bags), price (GHS/loaf), reorder trigger (bags), days-of-cover target, variance minor/critical %, driver gap %; plus network thresholds: default price, debt alert/escalate days, remittance gap %. The engine **never** hardcodes a threshold — it reads the store on every calculation. Every change is **audited** (old → new · who · when, last 200 kept), applies to **future calculations only** (past days keep the values they ran with — reconstructed by replaying the audit log), and is gated by a confirmation modal ("This affects all future calculations. Continue?"). The 10 PM CEO briefing flags any parameter changed in the last 24 h. Admin has **Reset site to default**; the CEO view never shows parameters, history, or reset. Endpoints: `POST /api/config` (all fields, `dryRun: true` previews the diff without saving, `resetDefault: 'MAM'`), `GET /api/param-log?limit=`.
13. **Reports (one dropdown, every period)** — 📈 Reports tab: Daily / Weekly / Monthly / Yearly, generated on demand and copyable for WhatsApp. Weekly = Sundays 22:00 (auto-pushed if CEO number set): 7-day production & money, top/bottom-3 routes, chronic debt > 7 days (write-off/legal), 7-day readiness trend, radar, CEO verdict. Monthly adds week-over-week cash, debt aging buckets, credit-recovery % and period driver consistency. Yearly adds month-by-month totals + a "ledger is young" foundation-year verdict until 60+ days of data. Every report ends with **COO recommendations** (reorder, debt chase, driver coaching, scale signal). Also in the tab: 14-day cash trend chart, driver leaderboard (🏆 Driver of the week) and debt aging & recovery. Endpoints: `GET /api/report?type=daily|weekly|monthly|yearly&date=` (and legacy `GET /api/weekly?date=`).

**Expansion Radar** (`lib/market.js`, dashboard tab): curated neighboring-town intelligence for all 3 sites — Kibi/Ejura/Boankra/Nsawam/Tafo around Mampong; Berekum/Yendi/Atebubu around Nkoranza; Tuobodom/Nkawkaw/Kintampo/Sefwi Wiaso/Wenchi around Techiman (≈ road km, market class, demand notes). Recommendations are **gated by live ops**: supply cover < 3 days → "fix flour first"; readiness < 60 → "stabilize first"; otherwise the best scored drop per site + strategic next branch (Berekum).

**Predictive engine** (computed silently, surfaced in the dashboard + briefing):
- Days of flour cover per site
- Tomorrow's forecast (7-day average: loaves, dispatch, cash)
- 7-day trend baselines for variance, accountability, debt ageing
- Route score (revenue per trip per driver)
- **Scale-Up Readiness 0–100** = 40 (variance ≤2%) + 30 (accountability ≥99%) + 20 (no debt >3d) + 10 (all sites ≥3d cover). ≥80 → "deploy the next driver/branch". <60 → "do not scale until X is fixed".

**CEO Insight** picks the worst live signal (critical variance → shortage → low stock → readiness) and always pairs the insight with one concrete *Do this* action.

---

## 🔌 API

| Method & path | Purpose |
|---|---|
| `GET /api/state` | Full dashboard state (params, last 120 production rows, last 120 trips, summary) |
| `POST /api/ingest` | `{from, text}` → run the engine → `{reply, events, summary}` |
| `GET /api/briefing?date=YYYY-MM-DD` | The 10 PM briefing text (exact WhatsApp format) |
| `GET /api/report?type=daily\|weekly\|monthly\|yearly&date=` | Any-period report from the 📈 Reports tab (exact WhatsApp format, ends with COO recommendations) |
| `POST /api/config` | `{sites: {MAM: {yield, batch, session, price, reorder, coverTarget, varMinor, varCrit, driverGap}}, network: {price, debtDays, debtEscalateDays, remGap}, drivers: {...}, whatsapp: {...}}` — every numeric change is audited (old → new · who · when). `dryRun: true` previews the diff without saving; `resetDefault: 'MAM'` restores one site |
| `GET /api/param-log?limit=` | Parameter change history (newest first; last 10 in the Admin GUI) |
| `POST /api/demo` | Seed 7 days of demo history |
| `POST /api/reset` | Clear history, keep parameters |
| `GET /webhook?hub.mode=…` | Meta verification handshake |
| `POST /webhook` | Meta Cloud API inbound messages → engine → Graph API reply |

---

## 🗂️ Files

```
server.js            HTTP server + routes + webhook (no dependencies)
lib/store.js         JSON persistence + defaults (MAM/NKZ/TCH)
lib/parser.js        Strict WhatsApp command parser
lib/rules.js         Golden Rules engine + predictive engine + readiness score
lib/reporter.js      10:00 PM CEO briefing generator (exact format)
lib/seed.js          Demo-week seeder
public/index.html    Dashboard SPA (ops tabs — no settings/reset here)
public/ceo.html      CEO view: 3 big numbers + readiness strip (demo-ready)
public/admin.html    Admin: parameters, WhatsApp, seed/reset (engineer-only)
public/app.js        Dashboard logic (vanilla JS) + red-alert banners
public/style.css     Dark ops theme
data/state.json      Runtime data (created on first write)
```

## 📜 First-day checklist for the CEO

1. `SESSION <bags> NKZ` and `SESSION <bags> TCH` (Mampong defaults to 40 bags/session, 2 bags/batch).
2. `PRICE <GHS/loaf>` per site on the first driver report (until then the COO reports revenue in loaves and says so).
3. `STOCK MAM <bags>` / `STOCK NKZ <bags>` / `STOCK TCH <bags>` — opens the days-of-cover engine.
4. Test the brain: `PROD MAM 80 S1-4000 S2-3800` → must answer **−200 loaves (−2.5%) → ⚠️ Minor Loss, Manager flagged**.

---

## 🗣️ Natural language + honesty rules

**The robot speaks plain WhatsApp English** (voice-to-text friendly, number words included). Short commands still work exactly as before.

| You can type | Recorded as |
|---|---|
| `stock is 30 bags at Mampong` / `we have 30 bags left at Nkoranza` | STOCK |
| `we baked 80 bags at Mampong, 4000 and 3800` | PROD (yield checked per session) |
| `Mampong 80 bags, S1 4000 S2 3800` | PROD |
| `KAN loaded 1000, cash 800, credit 200` | TRIP (gap checked) |
| `selling at one point fifty` / `price is 1.6` | PRICE |
| `KAN remitted 3,300 cedis` | REMITTED (reconciled vs expected cash) |
| `Adu kiosk owes 300` / `Adu paid 500` | KIOSK debt ledger |
| `Adu kiosk refused credit` | Credit refusal |
| `yield is 95 per bag at Mampong` / `session is 40` | Parameter (audited) |
| `the scale was faulty at S2 Mampong` | REASON attached to the alert |

Ambiguous numbers are **never guessed** — the robot asks which figure is which.

**No input ⇒ no processed output.** The engine reports only figures it actually received:
- A day with zero reports produces a short honest briefing (`⏸️ No reports received today — nothing processed`), not computed KPIs.
- With an empty ledger the **readiness score shows “—”**, not a healthy-looking default number.
- The 9 PM nudge still runs (it exists to *collect* input); the 10 PM briefing only turns into full numbers when reports arrive.
- New deployments start with an **empty ledger** — the demo week is loaded only by the explicit **Load demo** button in `/admin` (for pitches).

---

## 🔒 Security model
**WhatsApp webhook (fail-closed — refuses work until configured):**

| Control | Behaviour |
|---|---|
| `WA_APP_SECRET` env | **Required** for `POST /webhook`. Every payload is verified with `X-Hub-Signature-256` = HMAC-SHA256(raw body, secret), compared in constant time. No secret → `403 webhook disabled` — the webhook cannot be abused to inject fake data. |
| Sender allow-list | Only digits-normalised numbers configured in **/admin → WhatsApp** (CEO + MAM/NKZ/TCH managers) are processed. Unknown numbers are logged (`webhook-reject`) and answered with a refusal. **No numbers configured = every sender rejected.** |
| `WA_VERIFY_TOKEN` env (or /admin field) | Used for the Meta GET handshake. **No built-in default** — if unset, the handshake is refused, so the webhook URL can't be "verified" by a stranger. |
| Rate limit | 20 requests/min per IP on `/webhook`. |

**Login wall (whole site):**

- The **dashboard (`/`), CEO view (`/ceo`) and `/admin` all sit behind one password** — plus **every read API** (`/api/state`, `/api/report`, …) and the app assets, so the data can't be pulled straight from the URL either.
- Login sets an `HttpOnly` cookie (30 days); **`/logout`** clears it. Login attempts are rate-limited (8/min/IP); every access/denial/login is logged with client IP.
- Set the password with the `BAKEGUARD_ADMIN_PASS` env var (Render). A default ships in code and **should be changed**. `/ping` (health check) and the Meta webhook remain open.
- Every `POST /api/*` from a browser must be **same-origin** (cross-origin requests get `403`), and is rate-limited to 30/min per IP. Non-browser clients (curl/cron — no `Origin` header) are allowed but still admin-gated + rate-limited.
- `/api/reset` writes an automatic **pre-reset backup** (`state_backup_pre_reset_<ts>.json`) before wiping history.

**Platform hardening (audited & tested):**

- **Sessions, not password cookies:** login sets a random 48-hex-char session token (in-memory, 30-day expiry) — the cookie never contains the password; logout kills the session server-side. Cookie flags: `HttpOnly; Secure; SameSite=Lax`.
- **CSP with per-response script nonces** (`script-src 'self' 'nonce-…'`, no `unsafe-inline`), `frame-ancestors 'none'` + `X-Frame-Options: DENY` (clickjacking), `nosniff`, `no-referrer`, HSTS.
- **XSS:** every user-controlled string (log text, replies, kiosk names, driver names, reasons, alert bodies) is HTML-escaped at render; the 3 previously unescaped sinks (remittance driver `<option>`, stock-alert action, CEO silent-site strip) are fixed.
- **500 errors never leak stack traces** (logged server-side, generic message to client).
- **Prototype-pollution guard** on `/api/config` (`__proto__`/`constructor`/`prototype` keys rejected).
- **WhatsApp token is never echoed**: masked (`•••set•••`) in every API response; the admin field is write-only.
- **Rate limits:** 240 req/min global per IP, 30/min per write endpoint, 20/min webhook, 8/min login attempts.
- **Method hygiene:** only GET/POST accepted (405 otherwise); 1 MB body cap on all request bodies; static serving locked to the app directory with a strict path check.
- **Constant-time comparisons** for the admin password and webhook token.
- **SSRF: no attack surface** — the only outbound request is the Meta Graph API with a pinned host (`graph.facebook.com`); no user-controlled URLs anywhere.
- **CSRF: double-blocked** — `SameSite=Lax` cookie + same-origin `Origin` check on every browser `POST /api/*` (cross-origin → 403). Non-browser clients (curl/cron/WhatsApp) send no Origin and are admin-gated + rate-limited.

**Residual risks (honest list):** the admin password default (`hope2026`) ships in code and `render.yaml` — set `BAKEGUARD_ADMIN_PASS` in the environment and treat the repo value as compromised-adjacent. Sessions live in memory, so a redeploy asks everyone to log in again (by design). Login brute force is limited per-IP; an attacker rotating many IPs is not covered at this scale (the password itself is the last line).

**Deploy checklist (Render):** set `WA_APP_SECRET` (Meta App Secret) and `BAKEGUARD_ADMIN_PASS`; optionally `WA_VERIFY_TOKEN`. Then enter the CEO + manager numbers in /admin **before** pointing the Meta webhook at the site — until then the webhook accepts nothing.
