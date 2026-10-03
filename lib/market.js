'use strict';
// 🧭 Expansion Radar — neighboring-town market intelligence for the 3 sites.
// Distances are approximate road km; town classes and demand notes are curated
// from public geographic/census data. Verify on the ground with drivers.

const TOWN_CLASS = { 1: 'village cluster', 2: 'settlement', 3: 'town / district capital', 4: 'regional capital' };

const TOWNS = {
  MAM: [
    { town: 'Kibi', dist: 15, dir: 'W', cls: 3, note: 'Market town on the N1 corridor toward Cape Coast; steady commuter + retail traffic.' },
    { town: 'Adansi Manso / Nawin', dist: 12, dir: 'E', cls: 2, note: 'Twin suburbs on the Kumasi road — high-density retail pockets.' },
    { town: 'Boankra', dist: 20, dir: 'NW', cls: 2, note: 'Hill-town crossroads on the Ejura–Kumasi road.' },
    { town: 'Akomadan', dist: 18, dir: 'NE', cls: 1, note: 'Growing settlement toward Ejura.' },
    { town: 'Ejura', dist: 36, dir: 'N', cls: 3, note: 'District capital (Sekyere-Dumasi), major market; strong weekend demand.' },
    { town: 'Nsawam', dist: 42, dir: 'NE', cls: 3, note: 'Town on the Accra–Kumasi highway; busy but competitive.' },
    { town: 'Tafo / Kenyase', dist: 44, dir: 'SW', cls: 3, note: 'Kumasi northern suburbs (~50k); high volume, watch competition.' },
  ],
  NKZ: [
    { town: 'Wiele', dist: 15, dir: 'S', cls: 1, note: 'Farming community along the Berekum road.' },
    { town: 'Kpometa / Gbanga', dist: 12, dir: 'N', cls: 1, note: 'Village clusters toward Yendi.' },
    { town: 'Techiman', dist: 27, dir: 'E', cls: 4, note: 'Regional capital — your TCH site already serves it; NKZ should focus WEST, not east.' },
    { town: 'Berekum', dist: 34, dir: 'NW', cls: 4, note: 'Bono regional capital; gateway to the whole Bono region.' },
    { town: 'Yendi', dist: 58, dir: 'N', cls: 3, note: 'Gonja headquarters; cross-border trade (Burkina Faso) traffic.' },
    { town: 'Atebubu', dist: 68, dir: 'N', cls: 3, note: 'District capital on the northern edge — a future play, not this month.' },
  ],
  TCH: [
    { town: 'Tuobodom', dist: 8, dir: 'W', cls: 1, note: 'Immediate suburb of Techiman (Techiman North). The easiest first drop.' },
    { town: 'Nkawkaw', dist: 35, dir: 'S', cls: 3, note: 'Market town on the Wenchi road (Bono); border-area trade.' },
    { town: 'Kintampo / Jema', dist: 40, dir: 'S', cls: 3, note: 'South of Techiman; Jema is the Kintampo South market point.' },
    { town: 'Agogo', dist: 50, dir: 'W', cls: 2, note: 'Toward the western Bono villages.' },
    { town: 'Sefwi Wiaso', dist: 55, dir: 'SE', cls: 2, note: 'Across the Tano; mining-adjacent demand, rougher road.' },
    { town: 'Berekum', dist: 62, dir: 'NW', cls: 4, note: 'Bono regional capital; also reachable from NKZ — coordinate, don\'t double-cover.' },
    { town: 'Wenchi', dist: 70, dir: 'E', cls: 3, note: 'Ahafo market town; longer haul.' },
  ],
};

const OWN_SITES = { MAM: 'Mampong', NKZ: 'Nkoranza', TCH: 'Techiman' };

function expansionRadar(state) {
  const out = [];
  for (const code of Object.keys(state.params.sites)) {
    const towns = (TOWNS[code] || []).map(t => {
      // Opportunity score: bigger market class + closer = better (transparent heuristic)
      let score = t.cls * 10 + Math.max(0, 45 - t.dist);
      const own = Object.entries(OWN_SITES).find(([c, n]) => c !== code && n.toLowerCase() === t.town.toLowerCase());
      if (own) {
        // A company site — already covered by its own plant; never recommend as a "new" drop.
        score = 0;
        t.note = `${t.note} Already covered by your own ${own[0]} site — no duplicate route.`;
      }
      return { ...t, ownSite: !!own, clsName: TOWN_CLASS[t.cls] || '—', score };
    }).sort((a, b) => b.score - a.score);
    out.push({ site: code, name: state.params.sites[code].name, towns });
  }
  return out;
}

function topPick(site) {
  return site.towns.find(t => !t.ownSite) || site.towns[0];
}

function radarAdvice(state) {
  // Data-gated expansion advice: the radar only recommends when operations justify it.
  const { daySummary, readinessScore, daysOfCover } = require('./rules');
  const { todayStr } = require('./store');
  const date = todayStr();
  const s = daySummary(state, date);
  const r = readinessScore(state, date);
  const lowCovers = Object.keys(state.params.sites)
    .map(c => ({ c, cover: daysOfCover(state, c) }))
    .filter(x => x.cover != null && x.cover < 3);
  const radar = expansionRadar(state);

  if (lowCovers.length) {
    return {
      gate: 'supply-first',
      line: `Supply first: ${lowCovers.map(x => `${state.params.sites[x.c].name} (${x.cover.toFixed(1)}d cover)`).join(', ')} — fix flour before adding drop points.`,
      radar,
    };
  }
  if (r.score < 60) {
    return {
      gate: 'fix-ops-first',
      line: `Operations at ${r.score}/100 — stabilize variance, driver accountability and debt before new routes.`,
      radar,
    };
  }
  const picks = radar.map(x => ({ site: x.site, name: x.name, pick: topPick(x) })).filter(x => x.pick);
  return {
    gate: 'ready',
    line: `Next drops: ${picks.map(x => `${x.pick.town} (~${x.pick.dist} km ${x.pick.dir} of ${x.name})`).join(' · ')}.`,
    nextBranch: 'Strategic next branch: Berekum — Bono regional capital reachable from BOTH Nkoranza (≈34 km NW) and Techiman (≈62 km NW); a plant or full route there opens the whole Bono region.',
    radar,
  };
}

module.exports = { TOWNS, TOWN_CLASS, expansionRadar, radarAdvice, topPick };
