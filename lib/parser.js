'use strict';
// BakeGuard message parser — two layers:
//   1. Strict commands (PROD / TRIP / STOCK / KIOSK / ...) — backward compatible.
//   2. Natural English (Ghanaian WhatsApp register, voice-to-text friendly,
//      number words included):
//        "stock is 30 bags at Mampong"
//        "we baked 80 bags, 4000 and 3800"
//        "KAN loaded 1000, cash 800 credit 200"
//        "Adu kiosk owes 300"
//        "selling at one point fifty"
// Rule: money/counts ambiguous => CLARIFY, never guess.

const SITE_ALIASES = {
  MAM: 'MAM', MAMPONG: 'MAM',
  NKZ: 'NKZ', NKORANZA: 'NKZ',
  TCH: 'TCH', TECHIMAN: 'TCH',
};
function siteCode(s) {
  return SITE_ALIASES[String(s || '').toUpperCase().trim()] || null;
}

// ---------------- number words (voice-to-text friendly) ----------------
const ONES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMW = '(?:' + Object.keys(ONES).concat(Object.keys(TENS), ['hundred', 'thousand', 'point', 'and', 'a', 'half', 'zero']).join('|') + ')';

function wordsToNumber(run) {
  const toks = run.toLowerCase().split(/\s+/);
  let total = 0, cur = 0, ok = false;
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk in ONES) { cur += ONES[tk]; ok = true; }
    else if (tk in TENS) { cur += TENS[tk]; ok = true; }
    else if (tk === 'zero') { ok = true; }
    else if (tk === 'hundred') { cur = (cur || 1) * 100; ok = true; }
    else if (tk === 'thousand') { total += (cur || 1) * 1000; cur = 0; ok = true; }
    else if (tk === 'half') { cur += 0.5; ok = true; }
    else if (tk === 'and' || tk === 'a') { /* connectives */ }
    else if (tk === 'point') {
      // "point five" -> .5 · "point one five" -> .15 · "point fifty" -> .50
      let digits = '';
      for (let j = i + 1; j < toks.length; j++) {
        const r = toks[j];
        if (r in ONES && ONES[r] < 10) digits += ONES[r];
        else if (r in TENS) digits += String(TENS[r] / 10);
        else if (r === 'zero') digits += '0';
        else break;
      }
      if (!digits) return null;
      return total + cur + parseFloat('0.' + digits);
    }
    else return null;
  }
  if (!ok) return null;
  return total + cur;
}

// Extract every number in the text: digits ("40", "1.5", "1,500") and words
// ("forty", "one point five", "two thousand"). Times like 5:30 are ignored.
function extractNumbers(t) {
  const s = ' ' + t + ' ';
  const low = s.toLowerCase();
  const out = [];
  let m;
  const reD = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d+)/g;
  while ((m = reD.exec(s)) !== null) {
    const prev = s[m.index - 1], next = s[m.index + m[0].length];
    if (prev === ':' || next === ':') continue; // time (5:30)
    let raw = m[0];
    if (/^\d{1,3}(,\d{3})+$/.test(raw)) raw = raw.replace(/,/g, '');
    else if (/^\d+,\d{1,2}$/.test(raw)) raw = raw.replace(',', '.');
    out.push({ v: parseFloat(raw), at: m.index, raw: m[0], end: m.index + m[0].length });
  }
  const reW = new RegExp('\\b(' + NUMW + '(?:\\s+' + NUMW + ')+)\\b', 'g');
  while ((m = reW.exec(low)) !== null) {
    const v = wordsToNumber(m[1]);
    if (v != null) out.push({ v, at: m.index, raw: m[1], end: m.index + m[1].length });
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

function findSite(t) {
  const up = String(t || '').toUpperCase();
  for (const [alias, code] of Object.entries(SITE_ALIASES)) {
    if (new RegExp('\\b' + alias + '\\b').test(up)) return code;
  }
  return null;
}

// Number closest to (ending before) a word, within maxGap chars.
function numBeforeWord(t, words, nums, maxGap = 14) {
  const low = t.toLowerCase();
  let best = null;
  for (const w of words) {
    let i = low.indexOf(w);
    while (i !== -1) {
      for (const n of nums) {
        if (n.end <= i && i - n.end <= maxGap && (!best || n.at > best.at)) best = n;
      }
      i = low.indexOf(w, i + 1);
    }
  }
  return best;
}
// Number starting right after a word, within maxGap chars.
function numAfterWord(t, words, nums, maxGap = 14) {
  const low = t.toLowerCase();
  let best = null;
  for (const w of words) {
    let i = low.indexOf(w);
    while (i !== -1) {
      const start = i + w.length;
      for (const n of nums) {
        if (n.at >= start && n.at - start <= maxGap && (!best || n.at < best.at)) best = n;
      }
      i = low.indexOf(w, i + 1);
    }
  }
  return best;
}

function pickDriver(t, state) {
  const low = ' ' + String(t || '').toLowerCase() + ' ';
  const drivers = Object.keys((state && state.params && state.params.drivers) || {});
  for (const d of drivers) {
    if (d && d.length >= 2 && new RegExp('\\b' + d.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(low)) return d.toUpperCase();
  }
  return null;
}

function pickKiosk(t, state) {
  const low = String(t || '').toLowerCase();
  const known = (state && state.kioskDebt || []).map(k => k.kiosk);
  for (const k of known) {
    if (k && new RegExp('\\b' + k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(low)) return k;
  }
  // "Adu kiosk", "kiosk Adu" — a word adjacent to 'kiosk'
  const m = String(t || '').match(/\b([A-Z][A-Za-z]+)\s+kiosk\b|\bkiosk\s+([A-Z][A-Za-z]+)/);
  if (m) return (m[1] || m[2]).toUpperCase();
  // "<Name> owes/paid" — capitalized word right before owes/paid
  const m2 = String(t || '').match(/\b([A-Z][A-Za-z]+)\s+(?:owes|owe|paid)\b/);
  if (m2) return m2[1].toUpperCase();
  return null;
}

// ---------------- Layer 2: natural language ----------------
function parseNatural(t, state) {
  const nums = extractNumbers(t);
  const site = findSite(t);
  const driver = pickDriver(t, state);
  const low = String(t || '').toLowerCase();

  // --- PRICE: "price is 1.5 at Nkoranza", "selling at one point fifty" ---
  if (/(price|selling|sold at|per loaf|a loaf|each loaf|one loaf)/.test(low) && nums.length) {
    let n = numAfterWord(low, ['price', 'selling', 'sold at', 'is'], nums) || numBeforeWord(low, ['price', 'per loaf', 'a loaf', 'each loaf'], nums);
    if (!n) {
      const small = nums.filter(x => x.v < 100);
      n = small.length === 1 ? small[0] : (nums.length === 1 ? nums[0] : null);
    }
    if (!n) return { type: 'CLARIFY', question: 'I heard a price but not the number. Try: "price is 1.5 at Mampong".' };
    if (n.v >= 100) return { type: 'CLARIFY', question: `GHS ${n.v}/loaf seems too high — which number is the price per loaf?` };
    return { type: 'CONFIG', key: 'price', value: n.v, site };
  }

  // --- PROD: "we baked 80 bags, 4000 and 3800", "Mampong 80 bags, S1 4000 S2 3800" ---
  if (/(oven|baked|produced|we did|\bs[12]\b)/.test(low) && nums.length >= 1) {
    const bagsN = numBeforeWord(low, ['bags'], nums, 20);
    const rest = nums.filter(n => n !== bagsN);
    const actuals = rest.filter(n => n.v >= 100).slice(0, 2);
    const bags = bagsN ? Math.round(bagsN.v) : (nums.length >= 2 ? Math.min(...nums.filter(n => n !== bagsN).map(n => n.v)) : null);
    if (!site) return { type: 'CLARIFY', question: `Which site — Mampong, Nkoranza or Techiman? (e.g. "we baked 40 bags at Mampong, 2000 and 1800")` };
    if (!bags || bags < 1 || actuals.length < 2) {
      if (bags) {
        return { type: 'CLARIFY', question: `${bags} bags at ${site} noted as planned — but I need the oven actuals to check the yield. Send e.g. "4000 and 3800" (S1, S2).` };
      }
      return { type: 'CLARIFY', question: `How many bags total, and what did each oven produce? Try: "we baked 80 bags at Mampong, 4000 and 3800".` };
    }
    return { type: 'PROD', site, bags, sessions: actuals.map((a, i) => ({ n: i + 1, loaves: Math.round(a.v) })) };
  }

  // --- STOCK: "stock is 30 bags at Mampong", "we have 30 bags left Nkoranza" ---
  if (/(stock|left|remaining|in store|warehouse|bags left)/.test(low) && nums.length) {
    let n = numAfterWord(low, ['stock', 'is'], nums, 24) || numBeforeWord(low, ['stock', 'left', 'bags', 'remaining'], nums, 20);
    if (!n && nums.length === 1) n = nums[0];
    if (!n) return { type: 'CLARIFY', question: 'Which number is the stock? Try: "stock is 30 bags at Mampong".' };
    if (nums.length >= 2 && !n) return { type: 'CLARIFY', question: 'I caught two numbers — which is the stock? Try: "stock 30 at Mampong".' };
    if (!site) return { type: 'CLARIFY', question: `Stock of ${Math.round(n.v)} bags — which site, Mampong / Nkoranza / Techiman?` };
    return { type: 'STOCK', site, bags: Math.round(n.v) };
  }

  // --- REMITTED: "KAN remitted 3300", "KAN sent 3,300 cedis" ---
  // ("sent 1000 out" is a trip, not a remittance — require remit/money wording)
  const isRemit = /(remit|paid me|money)/.test(low) || (/\bsent\b/.test(low) && /\b(ghs|cedis|cedi)\b/.test(low) && !/sent\s+out/.test(low));
  if (driver && isRemit && nums.length) {
    let n = numAfterWord(low, ['remit', 'remitted', 'sent', 'paid'], nums, 24) || numBeforeWord(low, ['cedis', 'cedi', 'ghs'], nums, 12);
    if (!n && nums.length === 1) n = nums[0];
    if (!n) return { type: 'CLARIFY', question: `What amount did ${driver} remit? Try: "KAN remitted 3300".` };
    return { type: 'REMITTED', driver, amount: n.v };
  }

  // --- TRIP: "KAN loaded 1000, cash 800 credit 200" ---
  // tight adjacency (gap ≤ 3 chars) so "800 cash and 200 credit" doesn't leak across words
  if (driver && /(loaded|trip|dispatched|sold|went out|out)/.test(low) && nums.length >= 1) {
    const tightAfter = words => numAfterWord(low, words, nums, 3);
    const tightBefore = words => numBeforeWord(low, words, nums, 3);
    const disp = tightAfter(['loaded', 'dispatched', 'trip']) || tightBefore(['out', 'dispatched', 'loaded']) || nums[0];
    let cash = tightAfter(['cash']) || tightBefore(['cash']);
    let cr = tightAfter(['credit', 'cr']) || tightBefore(['credit']);
    let ret = tightAfter(['return', 'returns']) || tightBefore(['return', 'returns']) || null;
    if (!cash && !cr && nums.length >= 3) { cash = nums[1]; cr = nums[2]; } // "KSI 1000, 800 cash, 200 credit" style
    if (!cash || !cr) {
      return { type: 'CLARIFY', question: `${driver}'s trip: I need CASH and CREDIT in loaves. Try: "KAN loaded 1000, cash 800, credit 200".` };
    }
    return { type: 'TRIP', driver, dispatched: Math.round(disp.v), cashLoaves: Math.round(cash.v), crLoaves: Math.round(cr.v), retLoaves: ret ? Math.round(ret.v) : 0, tripNo: null };
  }

  // --- KIOSK debt: "Adu kiosk owes 300", "Adu paid 500" ---
  if (/(kiosk|owes|owe|paid|debt)/.test(low) && nums.length) {
    const kiosk = pickKiosk(t, state);
    let n = numAfterWord(low, ['owes', 'owe', 'paid', 'debt'], nums, 24) || numBeforeWord(low, ['cedis', 'cedi', 'ghs'], nums, 12) || (nums.length === 1 ? nums[0] : null);
    if (!n) return { type: 'CLARIFY', question: 'Which amount? Try: "Adu kiosk owes 300" or "Adu paid 500".' };
    if (!kiosk) return { type: 'CLARIFY', question: `GHS ${n.v} — which kiosk?` };
    const action = /(paid|repaid|cleared)/.test(low) ? 'paid' : 'owes';
    return { type: 'KIOSK', kiosk, action, amount: n.v };
  }

  // --- REFUSED CREDIT: "Adu refused credit" ---
  if (/(refused|declined|no credit|denied)/.test(low) && /credit/.test(low)) {
    const kiosk = pickKiosk(t, state);
    if (!kiosk) return { type: 'CLARIFY', question: 'Which kiosk refused credit? (e.g. "Adu kiosk refused credit")' };
    return { type: 'REFUSED_CREDIT', kiosk };
  }

  // --- CONFIG params: "yield is 95 per bag at Mampong", "session is 40", "batch is 2" ---
  const mCfg = low.match(/\b(yield|batch|session)\b\s*(?:is|at|of)?\s*/);
  if (mCfg && nums.length) {
    const key = mCfg[1];
    let n = numAfterWord(low, [key, 'is'], nums, 24) || (nums.length === 1 ? nums[0] : null);
    if (!n) return { type: 'CLARIFY', question: `What ${key} value? Try: "${key} is 40".` };
    return { type: 'CONFIG', key, value: n.v, site };
  }

  // --- REASON: "S2 scale was faulty at Mampong" ---
  const mRe = t.match(/\bS(\d)\b/i);
  if (mRe && site && /(reason|scale|faulty|broken|yeast|power|off|wrong)/.test(low)) {
    const reason = t.replace(new RegExp('\\bS' + mRe[1] + '\\b', 'i'), '')
      .replace(new RegExp('\\b' + site + '\\b', 'i'), '')
      .replace(new RegExp('Mampong|Nkoranza|Techiman', 'i'), '')
      .replace(/[.,;\s]+/g, ' ')
      .replace(/^(the|it|so|because)\s+/i, '')
      .replace(/\s+(at|in|for)\s*$/, '')
      .trim();
    if (reason.length >= 3) return { type: 'REASON', site, session: parseInt(mRe[1], 10), reason };
  }

  return null;
}

// ---------------- Layer 1: strict commands (unchanged behaviour) --------
function parseStrict(t) {
  // PROD MAM 80 S1-4000 S2-3800
  let m = t.match(/^PROD\s+([A-Za-z]+)\s+(\d+)\s+(.+)$/i);
  if (m) {
    const site = siteCode(m[1]);
    if (!site) return { type: 'CLARIFY', question: `Unknown site "${m[1]}". Use MAM, NKZ or TCH.` };
    const bags = parseInt(m[2], 10);
    const sessions = [];
    const re = /S(\d+)\s*-\s*(\d+)/g;
    let mm;
    while ((mm = re.exec(m[3])) !== null) sessions.push({ n: parseInt(mm[1], 10), loaves: parseInt(mm[2], 10) });
    if (!sessions.length) {
      return { type: 'CLARIFY', question: `I saw "${m[2]} bags" but no session actuals. Format: PROD MAM 80 S1-4000 S2-3800` };
    }
    sessions.sort((a, b) => a.n - b.n);
    return { type: 'PROD', site, bags, sessions };
  }

  // REASON MAM S2 scale was faulty
  m = t.match(/^REASON\s+([A-Za-z]+)\s+S(\d+)\s+(.+)$/i);
  if (m) {
    const site = siteCode(m[1]);
    if (!site) return { type: 'CLARIFY', question: `Unknown site "${m[1]}". Use MAM, NKZ or TCH.` };
    return { type: 'REASON', site, session: parseInt(m[2], 10), reason: m[3].trim() };
  }

  // TRIP KSI 1000 CASH-800 CR-200 RET-5 T2
  m = t.match(/^TRIP\s+([A-Za-z0-9]+)\s+(\d+)(?:\s+(.*))?$/i);
  if (m) {
    const driver = m[1].toUpperCase();
    const dispatched = parseInt(m[2], 10);
    const rest = (m[3] || '').toUpperCase();
    const cash = (rest.match(/CASH\s*-\s*(\d+)/) || [])[1];
    const cr = (rest.match(/CR\s*-\s*(\d+)/) || [])[1];
    const ret = (rest.match(/RET\s*-\s*(\d+)/) || [])[1];
    const tripNo = (rest.match(/\bT\s*-\s*(\d+)/) || rest.match(/\bT(\d+)\b/) || [])[1];
    if (cash === undefined || cr === undefined) {
      return { type: 'CLARIFY', question: `TRIP ${driver}: I need CASH and CR in loaves. Example: TRIP KSI 1000 CASH-800 CR-200` };
    }
    return {
      type: 'TRIP', driver, dispatched,
      cashLoaves: parseInt(cash, 10),
      crLoaves: parseInt(cr, 10),
      retLoaves: ret ? parseInt(ret, 10) : 0,
      tripNo: tripNo ? parseInt(tripNo, 10) : null,
    };
  }

  // STOCK MAM 15
  m = t.match(/^STOCK\s+([A-Za-z]+)\s+(\d+)$/i);
  if (m) {
    const site = siteCode(m[1]);
    if (!site) return { type: 'CLARIFY', question: `Unknown site "${m[1]}". Use MAM, NKZ or TCH.` };
    return { type: 'STOCK', site, bags: parseInt(m[2], 10) };
  }

  // KIOSK <name> PAID-500 | OWES-300
  m = t.match(/^KIOSK\s+(.+?)\s+(PAID|OWES)\s*-\s*([\d.,]+)$/i);
  if (m) {
    return { type: 'KIOSK', kiosk: m[1].trim().toUpperCase(), action: m[2].toUpperCase() === 'PAID' ? 'paid' : 'owes', amount: parseFloat(m[3].replace(',', '.')) };
  }

  // REFUSED-CREDIT ADU KIOSK
  m = t.match(/^REFUSED\s*[-_ ]?\s*CREDIT\s+(.+)$/i);
  if (m) return { type: 'REFUSED_CREDIT', kiosk: m[1].trim().toUpperCase() };

  // DRIVER-SITE KSI MAM
  m = t.match(/^DRIVER\s*[-_ ]\s*SITE\s+([A-Za-z0-9]+)\s+([A-Za-z]+)$/i);
  if (m) {
    const site = siteCode(m[2]);
    if (!site) return { type: 'CLARIFY', question: `Unknown site "${m[2]}". Use MAM, NKZ or TCH.` };
    return { type: 'DRIVER_SITE', driver: m[1].toUpperCase(), site };
  }

  // REMITTED KSI 3300 [GHS]
  m = t.match(/^REMITTED\s+([A-Za-z0-9]+)\s+([\d.,]+)\s*(GHS|CEDI|CEDIS)?$/i);
  if (m) return { type: 'REMITTED', driver: m[1].toUpperCase(), amount: parseFloat(m[2].replace(',', '.')) };

  // YIELD 95 MAM | BATCH 2 MAM | SESSION 40 MAM | PRICE 1.50 MAM
  m = t.match(/^(YIELD|BATCH|SESSION|PRICE)\s+([\d.,]+)\s*([A-Za-z]+)?$/i);
  if (m) {
    const up = m[1].toUpperCase();
    const key = up === 'YIELD' ? 'yield' : up === 'BATCH' ? 'batch' : up === 'SESSION' ? 'session' : 'price';
    const site = m[3] ? siteCode(m[3]) : null;
    if (m[3] && !site) return { type: 'CLARIFY', question: `Unknown site "${m[3]}". Use MAM, NKZ or TCH.` };
    return { type: 'CONFIG', key, value: parseFloat(m[2].replace(',', '.')), site };
  }

  return null;
}

function parseMessage(raw, state) {
  const t = String(raw || '').trim();
  if (!t) return { type: 'CLARIFY', question: 'Message is empty. Please resend the figures.' };

  const strict = parseStrict(t);
  if (strict) return strict;

  const natural = parseNatural(t, state);
  if (natural) return natural;

  return { type: 'FREE', text: t };
}

module.exports = { parseMessage, siteCode, extractNumbers, wordsToNumber, findSite };
