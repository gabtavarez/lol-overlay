/**
 * Champion fit: campeões que você ainda não joga, fortes na SUA rota principal e parecidos
 * com os que você mais joga NESSA rota (mesma classe principal e mesmo tipo de dano).
 */
const defaultFlags = require('../data/champion-flags.json');
const { damageProfile } = require('./recommender');

const POS = { TOP: 'top', JUNGLE: 'jungle', MID: 'middle', MIDDLE: 'middle', ADC: 'bottom', BOTTOM: 'bottom', SUPPORT: 'utility', UTILITY: 'utility' };

/** Rota principal: partidas recentes do OP.GG (mais confiável) ou o histórico do cliente. */
function mainRoleOf({ matches, roles }) {
  const count = {};
  for (const g of matches || []) {
    const r = g.me && POS[String(g.me.position || '').toUpperCase()];
    if (r) count[r] = (count[r] || 0) + 1;
  }
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] >= 3) return best[0];
  return roles && roles[0] ? roles[0].role : null;
}

function championFit({ mastery, dd, tierList, mainRole, roleStats, flags = defaultFlags, limit = 5 }) {
  if (!dd || !mastery || !tierList || !mainRole) return [];
  // seus campeões na rota principal (por partidas); sem histórico da rota, os de maior maestria
  const inRole = Object.entries((roleStats || {})[mainRole] || {}).sort((a, b) => b[1].games - a[1].games).map(([key]) => dd.championByKey(key)).filter(Boolean);
  const byMastery = [...mastery.entries()].sort((a, b) => b[1].points - a[1].points).map(([key]) => dd.championByKey(key)).filter(Boolean);
  const top = (inRole.length >= 2 ? inRole : byMastery).slice(0, 6);
  if (!top.length) return [];
  const primary = new Set(top.map((c) => (c.tags || [])[0]).filter(Boolean));
  const dmg = (c) => damageProfile({ championId: c.id, tags: c.tags || [] }, flags);
  const apShare = top.reduce((s, c) => s + dmg(c).ap, 0) / top.length;
  const played = new Set([...mastery.entries()].filter(([, m]) => m.points >= 20000).map(([k]) => Number(k)));
  const out = [];
  for (const r of tierList[mainRole] || []) {
    const c = dd.championByRaw(null, r.champion);
    if (!c || played.has(Number(c.key)) || r.tier > 2 || (r.roleRate || 1) < 0.4) continue;
    const tags = c.tags || [];
    if (!primary.has(tags[0])) continue; // mesma classe principal (mago com mago, assassino com assassino…)
    const d = dmg(c);
    if ((apShare >= 0.6 && d.ap < 0.5) || (apShare <= 0.4 && d.ad < 0.5)) continue; // mesmo tipo de dano
    const like = top.filter((t) => (t.tags || [])[0] === tags[0]).slice(0, 2).map((t) => t.name);
    out.push({ id: c.id, name: c.name, tier: r.tier, winRate: r.winRate, reason: `Parecido com ${like.join(' e ')}`, score: (3 - r.tier) * 0.5 + (r.winRate - 0.5) * 10 + like.length * 0.2 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

module.exports = { championFit, mainRoleOf };
