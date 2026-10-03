'use strict';

// Strict WhatsApp command parser. Money/counts ambiguous => CLARIFY, never guess.

const SITE_ALIASES = {
  MAM: 'MAM', MAMPONG: 'MAM',
  NKZ: 'NKZ', NKORANZA: 'NKZ',
  TCH: 'TCH', TECHIMAN: 'TCH',
};
function siteCode(s) {
  return SITE_ALIASES[String(s || '').toUpperCase().trim()] || null;
}

function parseMessage(raw) {
  const t = String(raw || '').trim();
  if (!t) return { type: 'CLARIFY', question: 'Message is empty. Please resend the figures.' };

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
    const tripNo = (rest.match(/T\s*-\s*(\d+)/) || rest.match(/\bT(\d+)\b/) || [])[1];
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
    const key = m[1].toUpperCase() === 'YIELD' ? 'yield' : m[1].toUpperCase() === 'BATCH' ? 'batch' : m[1].toUpperCase() === 'SESSION' ? 'session' : 'price';
    const site = m[3] ? siteCode(m[3]) : null;
    if (m[3] && !site) return { type: 'CLARIFY', question: `Unknown site "${m[3]}". Use MAM, NKZ or TCH.` };
    return { type: 'CONFIG', key, value: parseFloat(m[2].replace(',', '.')), site };
  }

  return { type: 'FREE', text: t };
}

module.exports = { parseMessage, siteCode };
