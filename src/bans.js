const { norm } = require('./util');

/**
 * Sugestão de ban: campeões fortes na sua rota (tier list) e que counteram
 * os picks que você tem mais chance de jogar (dados do OP.GG em cache).
 * Retorna até 10 { id, key, name, score, reasons }.
 */
function recommendBans({ champSelect, picks, getBuild, dd, meta, settings, tierRows = [] }) {
  if (!dd || champSelect.spectating) return [];
  const role = champSelect.myPosition || null;
  let bannable = new Set((champSelect.bannable || []).map(Number));
  // O cliente às vezes devolve a lista vazia (ou só um pedaço dela) fora da sua vez ou logo depois
  // de alguém banir: nesses casos usa todos os campeões menos os já banidos.
  const total = Object.keys(dd.champions).length;
  if (bannable.size < total * 0.5) {
    const banned = new Set([...(champSelect.bannedKeys || []), ...(champSelect.bans ? [...champSelect.bans.mine, ...champSelect.bans.theirs] : [])].map(Number));
    bannable = new Set(Object.values(dd.champions).map((c) => Number(c.key)).filter((k) => !banned.has(k)));
  }

  const taken = new Set(
    [...champSelect.allies, champSelect.me].filter((p) => p && p.champion).map((p) => p.champion.id),
  );
  const mine = new Set([
    ...(((settings.picker.pool || {})[role]) || []).map(norm),
    ...picks.candidates.slice(0, 2).map((c) => norm(c.id)),
  ]);

  // quanto cada campeão ameaça os meus melhores picks
  const threat = new Map();
  // Regra 1: o campeão que você já escolheu (hover/travado) pesa mais: banir quem o counteria.
  const chosen = champSelect.me && champSelect.me.champion;
  if (chosen) {
    const build = getBuild({ id: chosen.id }, role);
    for (const c of (build && build.weakCounters) || []) {
      const key = norm(c.name);
      const prev = threat.get(key) || { value: 0, against: [] };
      prev.value += Math.max(0, c.value) * 1.4;
      prev.against.push(chosen.name);
      threat.set(key, prev);
    }
  }
  const weightOf = (cand, i) => (cand.score / 100) * (1 - i * 0.12);
  picks.candidates.slice(0, 5).forEach((cand, i) => {
    const build = getBuild({ id: cand.id }, role);
    for (const c of (build && build.weakCounters) || []) {
      const key = norm(c.name);
      const prev = threat.get(key) || { value: 0, against: [] };
      prev.value += Math.max(0, c.value) * weightOf(cand, i);
      prev.against.push(cand.name);
      threat.set(key, prev);
    }
  });

  const tiers = (meta.tiers && role && meta.tiers[role]) || {};
  const TIER = { 'S+': 1, S: 0.9, A: 0.7, B: 0.45, C: 0.2, D: 0 };
  // tier list completa do OP.GG (com ban rate) quando o meta da rota ainda não carregou
  const rowOf = new Map((tierRows || []).map((r) => [norm(r.champion), r]));
  const LETTER = ['', 'S', 'A', 'B', 'C', 'D'];

  const out = [];
  for (const champ of Object.values(dd.champions)) {
    const key = Number(champ.key);
    if (!bannable.has(key) || taken.has(champ.id) || mine.has(norm(champ.id))) continue;
    const t = threat.get(norm(champ.id));
    const row = rowOf.get(norm(champ.id)) || rowOf.get(norm(champ.name));
    let tier = tiers[norm(champ.id)];
    if (typeof tier !== 'string' && row) tier = row.tier === 1 && row.rank <= 3 ? 'S+' : LETTER[row.tier] || 'C';
    const tierValue = typeof tier === 'string' ? TIER[tier] || 0 : 0;
    const banRate = row ? row.banRate || 0 : 0;
    if (!t && tierValue < 0.7 && banRate < 0.15) continue;
    const reasons = [];
    if (t) reasons.push(`Counter do seu ${[...new Set(t.against)].slice(0, 2).join(' e ')}`);
    if (tierValue >= 0.7) reasons.push(`Tier ${tier} na sua rota`);
    if (banRate >= 0.15) reasons.push(`${Math.round(banRate * 100)}% de ban`);
    out.push({
      id: champ.id, key, name: champ.name, reasons,
      score: Math.round(100 * Math.min(1, 0.55 * Math.min(1, t ? t.value : 0) + 0.35 * tierValue + 0.25 * Math.min(1, banRate / 0.4))),
    });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 10);
}

module.exports = { recommendBans };
