const { t: tr } = require('./i18n');
const { damageProfile } = require('./recommender');
const defaultFlags = require('../data/champion-flags.json');
const { norm, clamp } = require('./util');

const TIER = { 'S+': 1, S: 0.9, A: 0.75, B: 0.5, C: 0.25, D: 0 };
const OFF_META = 0.1; // campeão ausente de uma tier list que existe para a rota
const DAY_MS = 86_400_000;

function tierValue(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return clamp(raw, 0, 1);
  if (typeof raw === 'string') {
    const t = TIER[raw.trim().toUpperCase()];
    return t === undefined ? null : t;
  }
  return null;
}

/** Procura um campeão num mapa com chaves normalizadas, por ID e por nome. */
function lookup(map, champ) {
  if (!map) return undefined;
  const byId = map[norm(champ.id)];
  return byId !== undefined ? byId : map[norm(champ.name)];
}

function fmtPoints(points) {
  return points >= 1000 ? `${Math.round(points / 1000)}k pts` : `${points} pts`;
}

function champIndex(dd) {
  const index = new Map();
  for (const c of Object.values(dd.champions)) {
    index.set(norm(c.id), c);
    index.set(norm(c.name), c);
  }
  return index;
}

function resolveIds(names, index) {
  const out = new Set();
  for (const n of names || []) {
    const c = index.get(norm(n));
    if (c) out.add(c.id);
  }
  return out;
}

/** Maestria (log), recência e desempenho na rota, combinados num único sinal pessoal. */
function personalSignal(champ, role, profile, now) {
  if (!profile) return null;
  const key = Number(champ.key);
  const reasons = [];
  const m = profile.mastery.get(key);

  // Três termos com folga para não saturar em 1: maestria (log), recência e desempenho na rota.
  const mastery = m ? Math.min(1, Math.log1p(m.points) / Math.log1p(250_000)) : 0;
  let recency = 0;
  if (m) {
    reasons.push(tr('Maestria {lvl} · {pts}', { lvl: m.level, pts: fmtPoints(m.points) }));
    const days = (now - m.lastPlayTime) / DAY_MS;
    recency = m.lastPlayTime && days >= 0 ? Math.exp(-days / 60) : 0;
  }

  let performance = 0.5; // neutro quando não há partidas na rota
  const rs = role && profile.roleStats && profile.roleStats[role] && profile.roleStats[role][key];
  if (rs && rs.games > 0) {
    const winRate = (rs.wins + 2) / (rs.games + 4); // suavizado: poucas partidas não decidem
    performance = 0.5 + (winRate - 0.5) * Math.min(1, rs.games / 10);
    reasons.push(`${rs.games} partida(s) na rota · ${Math.round((100 * rs.wins) / rs.games)}% vit.`);
  }

  return { value: 0.6 * mastery + 0.2 * recency + 0.2 * performance, reasons };
}

function metaSignal(champ, role, meta) {
  const tiers = role && meta.tiers && meta.tiers[role];
  if (!tiers || !Object.keys(tiers).length) return null;
  const raw = lookup(tiers, champ);
  const value = tierValue(raw);
  if (value === null) return { value: OFF_META, reasons: [] };
  const label = typeof raw === 'string' ? `Tier ${raw.toUpperCase()}` : tr('Meta {p}%', { p: Math.round(value * 100) });
  return { value, reasons: [label] };
}

/**
 * Média dos counters contra os inimigos já visíveis (o oponente de rota pesa o dobro).
 * Inimigo sem nenhum dado de counter é ignorado; par ausente para um inimigo com dados vale neutro.
 */
function counterSignal(champ, enemies, role, meta) {
  let sum = 0;
  let weightSum = 0;
  const reasons = [];
  for (const enemy of enemies) {
    const row = lookup(meta.counters, enemy.champion);
    if (!row) continue;
    const raw = lookup(row, champ);
    const v = typeof raw === 'number' ? raw : 0;
    const weight = role && enemy.position === role ? 2 : 1;
    sum += v * weight;
    weightSum += weight;
    if (v >= 0.3) reasons.push(tr('Bom contra {champ}', { champ: enemy.champion.name }));
    else if (v <= -0.3) reasons.push(tr('Sofre contra {champ}', { champ: enemy.champion.name }));
  }
  if (!weightSum) return null;
  return { value: (sum / weightSum + 1) / 2, reasons };
}

/** Sinergia com aliados já escolhidos (OP.GG): média dos valores; aliado sem dados é ignorado. */
function synergySignal(champ, allies, meta) {
  if (!meta.synergies) return null;
  let sum = 0;
  let n = 0;
  const reasons = [];
  for (const a of allies) {
    if (!a.champion) continue;
    const row = lookup(meta.synergies, a.champion);
    if (!row) continue;
    const raw = lookup(row, champ);
    const v = typeof raw === 'number' ? raw : 0;
    sum += v;
    n += 1;
    if (v >= 0.3) reasons.push(tr('Boa dupla com {champ}', { champ: a.champion.name }));
  }
  if (!n) return null;
  return { value: (sum / n + 1) / 2, reasons };
}

function allyDamage(allies, flags) {
  const picked = allies.filter((a) => a.champion);
  const sum = picked.reduce(
    (acc, a) => {
      const d = damageProfile({ championId: a.champion.id, tags: a.champion.tags }, flags);
      return { ad: acc.ad + d.ad, ap: acc.ap + d.ap };
    },
    { ad: 0, ap: 0 },
  );
  return { ...sum, n: picked.length };
}

/** Quanto o campeão aproxima o time de um dano equilibrado AD/AP. */
function compSignal(champ, team, flags, allies = []) {
  const picked = allies.filter((a) => a.champion);
  const engager = picked.find((a) => (flags.engage || []).includes(a.champion.id));
  if (team.n < 2 && !engager) return null;
  const c = damageProfile({ championId: champ.id, tags: champ.tags || [] }, flags);
  const reasons = [];
  let value = 0.5;
  if (team.n >= 2) {
    const adShareNow = team.ad / team.n;
    const adShareWith = (team.ad + c.ad) / (team.n + 1);
    value = 1 - Math.min(1, Math.abs(adShareWith - 0.5) * 2);
    // 3 fontes de dano físico: força dano mágico (o inimigo empilharia armadura)
    if (team.ad >= 2.6 && c.ap >= 0.5) { value = 1; reasons.push(tr('Time já tem 3 fontes AD: dano mágico')); }
    else if (team.ad >= 2.6 && c.ad >= 0.6) value *= 0.5;
    else if (adShareNow >= 0.65 && c.ap >= 0.5) reasons.push(tr('Equilibra o dano (time muito AD)'));
    else if (adShareNow <= 0.35 && c.ad >= 0.5) reasons.push(tr('Equilibra o dano (time muito AP)'));
  }
  // engage no time -> campeões de follow-up / dano em área
  if (engager && (flags.followUp || []).includes(champ.id)) {
    value = Math.min(1, value + 0.35);
    reasons.push(`Follow-up para o engage de ${engager.champion.name}`);
  }
  return { value, reasons };
}

/**
 * Sugere picks no champ select combinando quatro sinais, com pesos ajustáveis:
 * pessoal (maestria + histórico na rota), meta (tier da rota), counters
 * (contra os inimigos já visíveis) e composição (equilíbrio AD/AP do time).
 * Sinais sem dado são descartados e os pesos restantes são reescalados.
 */
function recommendPicks({ champSelect, profile, dd, settings, meta, flags = defaultFlags, now = Date.now() }) {
  const role = champSelect.myPosition || null;
  const result = { role, candidates: [], notes: [], signalsUsed: [] };

  if (!dd) {
    result.notes.push(tr('Aguardando os dados do Data Dragon…'));
    return result;
  }
  if (champSelect.spectating) {
    result.notes.push(tr('Modo espectador: sem sugestões.'));
    return result;
  }

  const cfg = settings.picker;
  const metaData = meta || { tiers: {}, counters: {} };
  const index = champIndex(dd);
  const blacklist = resolveIds(cfg.blacklist, index);
  const poolIds = role
    ? resolveIds(cfg.pool[role], index)
    : resolveIds(Object.values(cfg.pool).flat(), index);

  // 1) quem pode ser escolhido
  const pickable = new Set((champSelect.pickable || []).map(Number));
  let pool = Object.values(dd.champions);
  if (pickable.size) {
    pool = pool.filter((c) => pickable.has(Number(c.key)));
  } else {
    const known = new Set(profile ? [...profile.mastery.keys()] : []);
    pool = pool.filter((c) => known.has(Number(c.key)) || poolIds.has(c.id));
    result.notes.push(tr('Lista de campeões disponíveis indisponível: usando campeões que você já joga.'));
  }

  const taken = new Set(
    [...champSelect.allies, ...champSelect.enemies].filter((p) => p.locked).map((p) => p.championKey),
  );
  // bans da sessão antiga (bans.*) + bans concluídos nas ações do draft atual (o cliente novo só informa por ali)
  const banned = new Set([...champSelect.bans.mine, ...champSelect.bans.theirs, ...(champSelect.bannedKeys || [])].map(Number));
  pool = pool.filter(
    (c) => !taken.has(Number(c.key)) && !banned.has(Number(c.key)) && !blacklist.has(c.id),
  );

  // 2) filtro de rota: pool do usuário, histórico na rota ou tier list da rota
  if (role) {
    const roleTiers = (metaData.tiers && metaData.tiers[role]) || {};
    const allowed = pool.filter((c) => {
      const games = profile && profile.roleStats[role] && profile.roleStats[role][Number(c.key)];
      return (
        poolIds.has(c.id) ||
        (games && games.games >= Math.max(1, cfg.minGamesForRole)) ||
        lookup(roleTiers, c) !== undefined
      );
    });
    if (allowed.length) pool = allowed;
    else result.notes.push(tr('Sem histórico, pool ou tier list para esta rota: mostrando tudo por maestria.'));
  }

  // 3) pontuação
  const enemies = champSelect.enemies.filter((e) => e.champion);
  const team = allyDamage(champSelect.allies, flags);
  const weights = {
    personal: cfg.weights.mastery,
    meta: cfg.weights.meta,
    counter: cfg.weights.counter,
    comp: cfg.weights.comp,
    synergy: cfg.weights.synergy === undefined ? 0.1 : cfg.weights.synergy,
  };
  const used = new Set();

  const scored = pool.map((champ) => {
    const signals = {
      personal: personalSignal(champ, role, profile, now),
      meta: metaSignal(champ, role, metaData),
      counter: counterSignal(champ, enemies, role, metaData),
      comp: compSignal(champ, team, flags, champSelect.allies),
      synergy: synergySignal(champ, champSelect.allies, metaData),
    };
    let num = 0;
    let den = 0;
    let plain = 0;
    let count = 0;
    for (const [name, s] of Object.entries(signals)) {
      if (!s) continue;
      used.add(name);
      num += weights[name] * s.value;
      den += weights[name];
      plain += s.value;
      count += 1;
    }
    let total = den > 0 ? num / den : count ? plain / count : 0;

    // Motivos por relevância: o que é específico desta partida vem antes do histórico.
    const reasons = [];
    if (poolIds.has(champ.id)) {
      total += cfg.poolBonus;
      reasons.push(tr('No seu pool'));
    }
    for (const name of ['counter', 'synergy', 'meta', 'comp', 'personal']) {
      if (signals[name]) reasons.push(...signals[name].reasons);
    }

    return {
      total,
      candidate: {
        id: champ.id,
        key: Number(champ.key),
        name: champ.name,
        score: Math.round(100 * clamp(total, 0, 1)),
        reasons: reasons.slice(0, 4),
        signals: Object.fromEntries(
          Object.entries(signals).map(([k, s]) => [k, s ? Number(s.value.toFixed(2)) : null]),
        ),
      },
    };
  });

  scored.sort((a, b) => b.total - a.total || a.candidate.name.localeCompare(b.candidate.name));
  result.candidates = scored.slice(0, cfg.maxResults).map((s) => s.candidate);
  result.signalsUsed = [...used];

  const hasTiers = Object.values(metaData.tiers || {}).some((o) => Object.keys(o).length);
  const hasCounters = Object.keys(metaData.counters || {}).length > 0;
  if (!hasTiers && !hasCounters) {
    result.notes.push(tr('Sem dados de meta/counters: usando maestria, histórico e composição.'));
  }
  if (!profile) result.notes.push(tr('Carregando maestria e histórico…'));
  return result;
}

module.exports = { recommendPicks };
