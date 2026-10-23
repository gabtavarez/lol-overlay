const { norm } = require('./util');

/**
 * Sugestão de ban: campeões fortes na sua rota (tier list) e que counteram
 * os picks que você tem mais chance de jogar (dados do OP.GG em cache).
 * Retorna até 5 { id, key, name, score, reasons }.
 */
function recommendBans({ champSelect, picks, getBuild, dd, meta, settings }) {
  if (!dd || champSelect.spectating) return [];
  const role = champSelect.myPosition || null;
  const bannable = new Set((champSelect.bannable || []).map(Number));
  if (!bannable.size) return [];

  const taken = new Set(
    [...champSelect.allies, champSelect.me].filter((p) => p && p.champion).map((p) => p.champion.id),
  );
  const mine = new Set([
    ...(((settings.picker.pool || {})[role]) || []).map(norm),
    ...picks.candidates.slice(0, 3).map((c) => norm(c.id)),
  ]);

  // quanto cada campeão ameaça os meus melhores picks
  const threat = new Map();
  const weightOf = (cand, i) => (cand.score / 100) * (1 - i * 0.15);
  picks.candidates.slice(0, 3).forEach((cand, i) => {
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

  const out = [];
  for (const champ of Object.values(dd.champions)) {
    const key = Number(champ.key);
    if (!bannable.has(key) || taken.has(champ.id) || mine.has(norm(champ.id))) continue;
    const t = threat.get(norm(champ.id));
    const tier = tiers[norm(champ.id)];
    const tierValue = typeof tier === 'string' ? TIER[tier] || 0 : 0;
    if (!t && tierValue < 0.9) continue;
    const reasons = [];
    if (t) reasons.push(`Counter do seu ${[...new Set(t.against)].slice(0, 2).join(' e ')}`);
    if (tierValue >= 0.9) reasons.push(`Tier ${tier} na sua rota`);
    out.push({
      id: champ.id, key, name: champ.name, reasons,
      score: Math.round(100 * Math.min(1, 0.6 * Math.min(1, t ? t.value : 0) + 0.4 * tierValue)),
    });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 5);
}

module.exports = { recommendBans };
