/**
 * Champion fit: campeões que você quase não joga mas combinam com o seu estilo
 * (mesma classe/dano dos seus mais jogados) e estão fortes na sua rota principal.
 */
function championFit({ mastery, dd, tierList, mainRole, limit = 5 }) {
  if (!dd || !mastery || !tierList || !mainRole) return [];
  const top = [...mastery.entries()].sort((a, b) => b[1].points - a[1].points).slice(0, 8)
    .map(([key]) => dd.championByKey(key)).filter(Boolean);
  if (!top.length) return [];
  const tagCount = {};
  for (const c of top) for (const t of c.tags || []) tagCount[t] = (tagCount[t] || 0) + 1;
  const played = new Set([...mastery.entries()].filter(([, m]) => m.points >= 20000).map(([k]) => Number(k)));
  const out = [];
  for (const r of tierList[mainRole] || []) {
    const c = dd.championByRaw(null, r.champion);
    if (!c || played.has(Number(c.key)) || r.tier > 2) continue;
    const tags = c.tags || [];
    const match = tags.reduce((s, t) => s + (tagCount[t] || 0), 0) / top.length;
    if (match <= 0.3) continue;
    const like = top.filter((t) => (t.tags || []).some((x) => tags.includes(x))).slice(0, 2).map((t) => t.name);
    out.push({ id: c.id, name: c.name, score: match + (3 - r.tier) * 0.3 + (r.winRate - 0.5) * 5, tier: r.tier, winRate: r.winRate, reason: `Parecido com ${like.join(' e ')}` });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

module.exports = { championFit };
