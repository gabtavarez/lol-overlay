const fs = require('fs/promises');
const path = require('path');
const { lcuGetJson } = require('./lcu');

/**
 * Aba Perfil (estilo Buildzcrank): maestria, estilo de jogo, coleção e sugestões de skins.
 * Tudo vem do cliente do LoL (maestria, histórico, inventário) + CommunityDragon (lista de skins).
 */

const CDRAGON_SKINS = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/pt_br/v1/skins.json';
const DAY = 24 * 3600 * 1000;

const RARITY = {
  kUltimate: { rank: 6, label: 'Suprema', rp: 3250 },
  kTranscendent: { rank: 5, label: 'Transcendente', rp: null },
  kExalted: { rank: 5, label: 'Exaltada', rp: null },
  kMythic: { rank: 4, label: 'Mítica', rp: null },
  kLegendary: { rank: 3, label: 'Lendária', rp: 1820 },
  kEpic: { rank: 2, label: 'Épica', rp: 1350 },
  kNoRarity: { rank: 1, label: 'Comum', rp: null },
};
const rarityOf = (s) => RARITY[s.rarity] || RARITY.kNoRarity;

const QUEUE = { 420: 'Ranqueada Solo/Duo', 440: 'Ranqueada Flex', 400: 'Normal (escolha)', 430: 'Normal', 490: 'Partida rápida', 480: 'Partida rápida', 450: 'ARAM', 1700: 'Arena', 1710: 'Arena', 900: 'URF', 1900: 'URF', 1300: 'Nexus Blitz', 3100: 'ARAM: Desordem', 2400: 'ARAM: Desordem' };
const CLASS_PT = { Marksman: 'Atiradores', Mage: 'Magos', Fighter: 'Lutadores', Assassin: 'Assassinos', Tank: 'Tanques', Support: 'Suportes' };
const PROFILE_PT = { Marksman: 'Franco-atirador', Mage: 'Mago', Fighter: 'Lutador', Assassin: 'Assassino', Tank: 'Tanque', Support: 'Suporte' };
const ROLE_PT = { top: 'Topo', jungle: 'Selva', middle: 'Meio', bottom: 'Atirador', utility: 'Suporte' };

/* ---------- CommunityDragon: lista de skins (pt-BR), enxuta e em cache por 7 dias ---------- */

function createSkinCatalog({ cacheDir, fetchImpl = fetch, log = () => {} }) {
  const file = path.join(cacheDir, 'skins.json');
  let mem = null;
  return async function catalog() {
    if (mem) return mem;
    try {
      const st = await fs.stat(file);
      if (Date.now() - st.mtimeMs < 7 * DAY) { mem = JSON.parse(await fs.readFile(file, 'utf8')); return mem; }
    } catch { /* sem cache */ }
    try {
      const res = await fetchImpl(CDRAGON_SKINS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const slim = {};
      for (const s of Object.values(raw)) {
        slim[s.id] = { id: s.id, name: s.name, rarity: s.rarity || 'kNoRarity', legacy: Boolean(s.isLegacy), base: Boolean(s.isBase), chromas: (s.chromas || []).map((c) => c.id), lines: (s.skinLines || []).map((l) => l.id) };
      }
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(file, JSON.stringify(slim));
      mem = slim;
      return mem;
    } catch (err) {
      log(`skins (CommunityDragon): ${err.message}`);
      try { mem = JSON.parse(await fs.readFile(file, 'utf8')); return mem; } catch { return null; }
    }
  };
}

/* ---------- inventário do cliente ---------- */

async function loadInventory(creds, summonerId) {
  const ids = (list) => new Set((Array.isArray(list) ? list : []).map((x) => Number(x.itemId != null ? x.itemId : x.id)).filter(Boolean));
  let skins = null;
  let champions = null;
  try { skins = ids(await lcuGetJson(creds, '/lol-inventory/v2/inventory/CHAMPION_SKIN')); } catch { /* tenta o outro caminho */ }
  if (!skins || !skins.size) {
    try {
      const list = await lcuGetJson(creds, `/lol-champions/v1/inventories/${summonerId}/skins-minimal`);
      skins = new Set((list || []).filter((s) => s.ownership && s.ownership.owned && !s.isBase).map((s) => Number(s.id)));
    } catch { /* sem skins */ }
  }
  try { champions = ids(await lcuGetJson(creds, '/lol-inventory/v2/inventory/CHAMPION')); } catch { /* tenta o outro */ }
  if (!champions || !champions.size) {
    try { champions = new Set((await lcuGetJson(creds, '/lol-champions/v1/owned-champions-minimal') || []).map((c) => Number(c.id))); } catch { /* sem campeões */ }
  }
  let score = null;
  try { score = await lcuGetJson(creds, '/lol-champion-mastery/v1/local-player/champion-mastery-score'); } catch { /* soma os níveis */ }
  return { skins: skins || new Set(), champions: champions || new Set(), score: typeof score === 'number' ? score : null };
}

/* ---------- maestria ---------- */

/** Pontos por dia de cada campeão a partir de fotos diárias (mastery-history.json). */
async function masteryPace(file, mastery, now = Date.now()) {
  let hist = {};
  try { hist = JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* primeira vez */ }
  const today = new Date(now).toISOString().slice(0, 10);
  if (!hist[today]) {
    hist[today] = Object.fromEntries([...mastery].filter(([, m]) => m.points > 0).map(([k, m]) => [k, m.points]));
    const days = Object.keys(hist).sort();
    while (days.length > 30) delete hist[days.shift()];
    try { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(hist)); } catch { /* só memória */ }
  }
  const days = Object.keys(hist).sort();
  const old = days.find((d) => (now - Date.parse(d)) / DAY >= 1 && (now - Date.parse(d)) / DAY <= 30);
  if (!old) return {};
  const span = Math.max(1, (now - Date.parse(old)) / DAY);
  const pace = {};
  for (const [k, m] of mastery) {
    const before = hist[old][k];
    if (before != null && m.points > before) pace[k] = (m.points - before) / span;
  }
  return pace;
}

const GRADE_ORDER = ['S+', 'S', 'S-', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-'];
function milestoneText(next) {
  const req = next && next.requireGradeCounts;
  if (!req || !Object.keys(req).length) return null;
  return Object.entries(req).map(([g, n]) => `${n}× ${g} ou melhor`).join(' + ');
}

function buildMastery({ mastery, dd, score, pace = {}, now = Date.now() }) {
  const rows = [...mastery].map(([key, m]) => {
    const c = dd.championByKey(key);
    if (!c) return null;
    const perDay = pace[key] || 0;
    return {
      id: c.id, name: c.name, tags: c.tags || [], key: Number(key),
      level: m.level, points: m.points, lastPlayTime: m.lastPlayTime, untilNext: m.untilNext, sinceLast: m.sinceLast,
      progress: m.untilNext > 0 ? m.sinceLast / (m.sinceLast + m.untilNext) : 1,
      marks: m.marks, marksNeeded: m.marksNeeded, grades: m.grades || [], milestone: milestoneText(m.nextMilestone),
      daysToNext: perDay > 0 && m.untilNext > 0 ? Math.ceil(m.untilNext / perDay) : null,
    };
  }).filter(Boolean).sort((a, b) => b.points - a.points);
  const total = rows.reduce((s, r) => s + r.points, 0);
  const played = rows.filter((r) => r.points > 0);
  const buckets = [[1, 4], [5, 9], [10, 19], [20, 49], [50, Infinity]].map(([a, b]) => ({ label: b === Infinity ? `Nv. ${a}+` : `Nv. ${a}–${b}`, count: played.filter((r) => r.level >= a && r.level <= b).length }));
  const forgotten = rows.filter((r) => r.level >= 7 && r.lastPlayTime && now - r.lastPlayTime > 120 * DAY).slice(0, 5)
    .map((r) => ({ id: r.id, name: r.name, since: r.lastPlayTime }));
  return {
    score: score != null ? score : played.reduce((s, r) => s + r.level, 0),
    total, played: played.length, champions: Object.keys(dd.champions).length,
    main: rows[0] ? { id: rows[0].id, name: rows[0].name, share: total ? rows[0].points / total : 0 } : null,
    rows, buckets, forgotten,
  };
}

/* ---------- estilo de jogo ---------- */

function buildStyle({ games, dd }) {
  const recent = games.filter((g) => !g.remake).slice(0, 50);
  const sr = games.filter((g) => g.mapId === 11 && !g.remake);
  const byChamp = new Map();
  for (const g of recent) byChamp.set(g.championId, (byChamp.get(g.championId) || 0) + 1);
  const pool = [...byChamp].map(([key, n]) => { const c = dd.championByKey(key); return c ? { id: c.id, name: c.name, games: n, tags: c.tags || [] } : null; })
    .filter(Boolean).sort((a, b) => b.games - a.games);
  const roles = {};
  for (const g of sr) if (g.position) roles[g.position] = (roles[g.position] || 0) + 1;
  const roleTotal = Object.values(roles).reduce((a, b) => a + b, 0) || 1;
  const classes = {};
  for (const p of pool) { const t = p.tags[0]; if (t) classes[t] = (classes[t] || 0) + p.games; }
  const classTotal = Object.values(classes).reduce((a, b) => a + b, 0) || 1;
  const modes = {};
  for (const g of games) { const m = QUEUE[g.queueId] || 'Outros'; modes[m] = (modes[m] || 0) + 1; }
  const wins = recent.filter((g) => g.win).length;
  const topClass = Object.entries(classes).sort((a, b) => b[1] - a[1])[0];
  const topRole = Object.entries(roles).sort((a, b) => b[1] - a[1])[0];
  const ranked = games.filter((g) => g.queueId === 420).length;
  return {
    analyzed: games.length, recent: recent.length, unique: pool.length,
    mainIndex: pool[0] && recent.length ? { name: pool[0].name, share: pool[0].games / recent.length } : null,
    srGames: sr.length, winRate: recent.length ? wins / recent.length : null,
    mainRole: topRole ? { role: topRole[0], label: ROLE_PT[topRole[0]], share: topRole[1] / roleTotal } : null,
    soloShare: games.length ? ranked / games.length : 0,
    roles: Object.keys(ROLE_PT).map((r) => ({ role: r, label: ROLE_PT[r], share: (roles[r] || 0) / roleTotal })),
    classes: Object.entries(classes).sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ tag: t, label: CLASS_PT[t] || t, share: n / classTotal })),
    profile: topClass ? PROFILE_PT[topClass[0]] || topClass[0] : null,
    modes: Object.entries(modes).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, games: n })),
    pool: pool.slice(0, 16),
  };
}

/* ---------- coleção + sugestões ---------- */

function buildCollection({ inv, catalog, dd }) {
  const all = Object.values(catalog || {});
  const skins = all.filter((s) => !s.base);
  const chromaIds = new Set(all.flatMap((s) => s.chromas));
  const ownedSkins = skins.filter((s) => inv.skins.has(s.id));
  const ownedChromas = [...inv.skins].filter((id) => chromaIds.has(id)).length;
  const champOf = (s) => dd.championByKey(Math.floor(s.id / 1000));
  const byRarity = ['kUltimate', 'kExalted', 'kTranscendent', 'kMythic', 'kLegendary', 'kEpic', 'kNoRarity']
    .map((r) => ({ key: r, label: RARITY[r].label, count: ownedSkins.filter((s) => s.rarity === r).length }))
    .filter((r) => r.count || ['kUltimate', 'kMythic', 'kLegendary', 'kEpic', 'kNoRarity'].includes(r.key));
  const jewels = [...ownedSkins].sort((a, b) => rarityOf(b).rank - rarityOf(a).rank || b.id - a.id).slice(0, 4)
    .map((s) => { const c = champOf(s); return c ? { id: s.id, name: s.name, rarity: rarityOf(s).label, champion: c.id, num: s.id % 1000 } : null; }).filter(Boolean);
  const per = new Map();
  for (const s of skins) {
    const k = Math.floor(s.id / 1000);
    const row = per.get(k) || { owned: 0, total: 0 };
    row.total += 1;
    if (inv.skins.has(s.id)) row.owned += 1;
    per.set(k, row);
  }
  const most = [...per].filter(([, r]) => r.owned).sort((a, b) => b[1].owned - a[1].owned).slice(0, 8)
    .map(([k, r]) => { const c = dd.championByKey(k); return c ? { id: c.id, name: c.name, ...r } : null; }).filter(Boolean);
  return {
    champions: { owned: inv.champions.size, total: Object.keys(dd.champions).length },
    skins: { owned: ownedSkins.length, total: skins.length },
    chromas: ownedChromas, legacy: ownedSkins.filter((s) => s.legacy).length,
    byRarity, jewels, most,
  };
}

/* ---------- preços (catálogo do cliente) e lista completa ---------- */

/**
 * Preços e datas pelo catálogo da loja do cliente (RP, Essência Mítica, promoção, lançamento).
 * Se o cliente não responder, o preço sai pela raridade (tabela padrão da Riot).
 */
async function loadPrices(creds) {
  const out = new Map();
  let items = null;
  try { items = await lcuGetJson(creds, '/lol-catalog/v1/items/CHAMPION_SKIN'); } catch { /* sem catálogo */ }
  for (const it of Array.isArray(items) ? items : []) {
    const id = Number(it.itemId);
    if (!id) continue;
    const pick = (list) => {
      const p = { rp: null, me: null };
      for (const x of Array.isArray(list) ? list : []) {
        const cur = String(x.currency || '').toLowerCase();
        if (cur === 'rp') p.rp = x.cost;
        else if (/mythic|essence_mythic|me$/.test(cur)) p.me = x.cost;
      }
      return p;
    };
    const base = pick(it.prices);
    const sale = it.sale && pick(it.sale.prices);
    const rel = it.releaseDate ? (typeof it.releaseDate === 'number' ? it.releaseDate : Date.parse(it.releaseDate)) : null;
    out.set(id, { ...base, sale: sale && (sale.rp || sale.me) ? { rp: sale.rp, me: sale.me, end: it.sale.endDate || null } : null, released: Number.isFinite(rel) ? rel : null, active: it.active !== false });
  }
  return out;
}

const DEFAULT_RP = { kUltimate: 3250, kLegendary: 1820, kEpic: 1350 };
/** { kind: 'rp' | 'me' | 'gacha' | 'legacy' | 'unknown', amount, sale } */
function priceOf(s, prices) {
  const p = prices && prices.get(s.id);
  if (s.rarity === 'kExalted' || s.rarity === 'kTranscendent') return { kind: 'gacha', amount: null };
  if (p && p.rp) return { kind: 'rp', amount: p.rp, sale: p.sale && p.sale.rp ? p.sale.rp : null };
  if (p && p.me) return { kind: 'me', amount: p.me, sale: p.sale && p.sale.me ? p.sale.me : null };
  if (s.legacy) return { kind: 'legacy', amount: null };
  if (s.rarity === 'kMythic') return { kind: 'me', amount: null };
  if (DEFAULT_RP[s.rarity]) return { kind: 'rp', amount: DEFAULT_RP[s.rarity], estimated: true };
  return { kind: 'unknown', amount: null };
}

/** Todas as skins (sem as padrão), para a galeria com filtros. */
function buildSkinList({ inv, catalog, dd, prices }) {
  const out = [];
  for (const s of Object.values(catalog || {})) {
    if (s.base) continue;
    const c = dd.championByKey(Math.floor(s.id / 1000));
    if (!c) continue;
    const p = prices && prices.get(s.id);
    out.push({
      id: s.id, name: s.name, champion: c.id, championName: c.name, num: s.id % 1000,
      rarity: rarityOf(s).label, rank: rarityOf(s).rank, legacy: s.legacy, owned: inv.skins.has(s.id),
      chromas: s.chromas.length, price: priceOf(s, prices), released: p ? p.released : null,
    });
  }
  return out.sort((a, b) => a.championName.localeCompare(b.championName) || a.num - b.num);
}

/**
 * Sugestões de skins que valem o investimento (não tem, à venda ou de gacha, Lendária para cima):
 * - mine: dos campeões que você mais joga (até 2 por campeão)
 * - recent: lançamentos mais recentes de qualquer campeão (precisa da data do catálogo do cliente)
 * - sale: em promoção agora, os seus campeões primeiro
 */
function suggestSkins({ inv, catalog, dd, mastery, games, prices = null, mode = 'mine', limit = 40, perChampion = 2 }) {
  if (!catalog) return [];
  const recent = new Map();
  for (const g of games.filter((x) => !x.remake).slice(0, 50)) recent.set(g.championId, (recent.get(g.championId) || 0) + 1);
  const masteryOf = (k) => (mastery.get(k) || {}).points || 0;
  const maxM = Math.max(1, ...[...mastery.values()].map((m) => m.points || 0));
  const fitOf = (k) => (recent.get(k) || 0) / 10 + masteryOf(k) / maxM;
  const pref = (s) => rarityOf(s).rank + (DEFAULT_RP[s.rarity] ? 1.5 : 0);
  const make = (s, c, score) => {
    const r = rarityOf(s);
    const k = Number(c.key);
    const g = recent.get(k) || 0;
    const why = [g ? `${g} partidas recentes` : null, masteryOf(k) ? `${Math.round(masteryOf(k) / 1000)} mil pts de maestria` : null].filter(Boolean).join(' · ');
    const p = prices && prices.get(s.id);
    return { id: s.id, name: s.name, champion: c.id, championName: c.name, num: s.id % 1000, rarity: r.label, rarityKey: s.rarity,
      price: priceOf(s, prices), released: p ? p.released : null, why, score };
  };
  const all = Object.values(catalog).filter((s) => !s.base && !inv.skins.has(s.id) && rarityOf(s).rank >= 3
    && (!s.legacy || ['kExalted', 'kTranscendent'].includes(s.rarity)));

  if (mode === 'recent') {
    if (!prices || !prices.size) return [];
    return all.map((s) => ({ s, c: dd.championByKey(Math.floor(s.id / 1000)), rel: (prices.get(s.id) || {}).released }))
      .filter((x) => x.c && x.rel).sort((a, b) => b.rel - a.rel).slice(0, limit)
      .map((x) => make(x.s, x.c, fitOf(Number(x.c.key))));
  }
  if (mode === 'sale') {
    if (!prices || !prices.size) return [];
    return all.filter((s) => (prices.get(s.id) || {}).sale)
      .map((s) => ({ s, c: dd.championByKey(Math.floor(s.id / 1000)) })).filter((x) => x.c)
      .map((x) => make(x.s, x.c, fitOf(Number(x.c.key)) + rarityOf(x.s).rank / 6))
      .sort((a, b) => b.score - a.score).slice(0, limit);
  }
  const champs = [...new Set([...recent.keys(), ...[...mastery].sort((a, b) => b[1].points - a[1].points).slice(0, 25).map(([k]) => k)])]
    .map((k) => ({ k: Number(k), fit: fitOf(Number(k)) }))
    .filter((x) => (recent.get(x.k) || 0) >= 2 || masteryOf(x.k) / maxM >= 0.08)
    .sort((a, b) => b.fit - a.fit).slice(0, 25);
  const out = [];
  for (const { k, fit } of champs) {
    const c = dd.championByKey(k);
    if (!c) continue;
    all.filter((s) => Math.floor(s.id / 1000) === k).sort((a, b) => pref(b) - pref(a) || b.id - a.id)
      .slice(0, perChampion).forEach((s, i) => out.push(make(s, c, fit + rarityOf(s).rank / 6 - i * 0.35)));
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

module.exports = { createSkinCatalog, loadInventory, loadPrices, priceOf, buildSkinList, masteryPace, buildMastery, buildStyle, buildCollection, suggestSkins, RARITY, GRADE_ORDER };
