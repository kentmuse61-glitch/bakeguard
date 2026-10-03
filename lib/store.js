'use strict';
const fs = require('fs');
const path = require('path');

// Data location: Render's persistent disk at /var/data when mounted (paid plan),
// otherwise ./data inside the project dir (writable at runtime; ephemeral on the
// free plan — the seed bootstrap re-applies the bundled demo on each cold start).
function pickDataDir() {
  if (process.env.BAKEGUARD_DATA_DIR && fs.existsSync(process.env.BAKEGUARD_DATA_DIR)) return process.env.BAKEGUARD_DATA_DIR;
  if (fs.existsSync('/var/data')) return '/var/data';
  return path.join(__dirname, '..', 'data');
}
const DATA_DIR = pickDataDir();
const FILE = path.join(DATA_DIR, 'state.json');
const SEED_FILE = path.join(__dirname, '..', 'data', 'state.seed.json');

function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function defaultState() {
  return {
    params: {
      network: { price: null, debtDays: 3, debtEscalateDays: 7, remGap: 0.5 },
      drivers: {}, // { DRIVER: 'MAM' } — which site a driver loads/sells for (for price reconciliation)
      sites: {
        MAM: { name: 'Mampong', region: 'Ashanti', yield: 100, batch: 2, session: 40, price: null, reorder: 20, coverTarget: 3, varMinor: 2, varCrit: 5, driverGap: 1 },
        NKZ: { name: 'Nkoranza', region: 'Bono East', yield: 100, batch: 2, session: 20, price: null, reorder: 20, coverTarget: 3, varMinor: 2, varCrit: 5, driverGap: 1 },
        TCH: { name: 'Techiman', region: 'Bono East', yield: 100, batch: 2, session: 20, price: null, reorder: 20, coverTarget: 3, varMinor: 2, varCrit: 5, driverGap: 1 },
      },
    },
    production: [],   // {id,date,site,session,bags,expected,actual,variance,variancePct,status,reason,reasonTs,ts}
    trips: [],        // {id,date,driver,trip,dispatched,cashLoaves,crLoaves,retLoaves,short,shortPct,status,ts}
    stockLog: [],     // {date,site,bags,ts}
    kioskDebt: [],    // {kiosk,issued,outstanding,payments:[{amount,date}],ts}
    creditRefusals: [], // {id,date,ts,kiosk,by}
    remittances: [],     // {id,date,driver,expected,actual,gap,gapPct,status,ts}
    nudges: [],          // {id,date,site,ts,text,delivered}
    delayedAcks: [],     // {id,date,site,reason,ts}
    paramLog: [],        // audit trail: {ts,by,scope,field,old,new} — every parameter change, signed and time-stamped
    alerts: [],       // {id,date,ts,level,type,title,body,site?,session?,driver?,resolved,resolution?}
    log: [],          // {id,date,ts,from,text,reply,events:[titles]}
    config: {
      whatsapp: { phone_number_id: '', token: '', verify_token: '', managers: {}, ceo: '' },
    },
  };
}

function load() {
  const base = defaultState();
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const s = { ...base, ...raw };
    s.params = { ...(base.params), ...(raw.params || {}) };
    s.params.network = { ...(base.params.network), ...((raw.params || {}).network || {}) };
    s.params.drivers = { ...(((raw.params || {}).drivers) || {}) };
    s.params.sites = { ...(base.params.sites), ...((raw.params || {}).sites || {}) };
    for (const k of Object.keys(s.params.sites)) {
      s.params.sites[k] = { ...(base.params.sites[k] || {}), ...s.params.sites[k] };
    }
    s.config = { whatsapp: { ...(base.config.whatsapp), ...(((raw.config || {}).whatsapp) || {}) } };
    s.config.whatsapp.managers = { ...(((raw.config || {}).whatsapp || {}).managers) || {} };
    for (const k of ['production','trips','stockLog','kioskDebt','creditRefusals','remittances','nudges','delayedAcks','paramLog','alerts','log']) if (!Array.isArray(s[k])) s[k] = [];
    return s;
  } catch (e) {
    return base;
  }
}

function save(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  try { fs.chmodSync(tmp, 0o600); } catch (e) { /* best effort */ }
  fs.renameSync(tmp, FILE);
  try { fs.chmodSync(FILE, 0o600); } catch (e) { /* best effort */ }
}

module.exports = { load, save, todayStr, defaultState, FILE, SEED_FILE, DATA_DIR };
