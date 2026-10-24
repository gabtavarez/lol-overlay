/**
 * Ameaça ao vivo de cada inimigo, a partir do que a Live Client API mostra:
 * KDA, ouro em itens, nível e se é o seu oponente de rota. 1 = ameaça média do time.
 */
function itemGold(e, dd) {
  return (e.items || []).reduce((s, it) => {
    const meta = dd && dd.item(it.id);
    return s + ((meta && meta.gold && meta.gold.total) || 0) * (it.count || 1);
  }, 0);
}

function rawThreat(e, { dd, laneOpponentName, myLevel }) {
  const { kills = 0, deaths = 0, assists = 0 } = e.scores || {};
  const kda = (kills + assists * 0.5) / Math.max(1, deaths);
  const kdaPart = Math.min(3, kda) / 3;                       // 0..1
  const killPart = Math.min(1, Math.max(0, kills - deaths) / 6); // 0..1 (fed de verdade)
  const gold = itemGold(e, dd);
  const lvlDiff = myLevel ? Math.max(-3, Math.min(3, (e.level || 1) - myLevel)) / 3 : 0;
  const lane = laneOpponentName && e.champion === laneOpponentName ? 0.35 : 0;
  return { score: 1 + kdaPart * 0.6 + killPart * 0.8 + lvlDiff * 0.25 + lane, gold, kda, lane: lane > 0 };
}

/** Lista de { e, w, gold, kda, lane, fed }, com w normalizado (média 1) e o peso do ouro relativo. */
function rankThreats(enemies, opts = {}) {
  if (!enemies.length) return [];
  const rows = enemies.map((e) => ({ e, ...rawThreat(e, opts) }));
  const avgGold = rows.reduce((s, r) => s + r.gold, 0) / rows.length || 1;
  for (const r of rows) r.score *= 1 + Math.max(-0.3, Math.min(0.6, (r.gold - avgGold) / avgGold)) * 0.5;
  const avg = rows.reduce((s, r) => s + r.score, 0) / rows.length;
  return rows
    .map((r) => ({ ...r, w: r.score / avg, fed: r.score / avg >= 1.3 }))
    .sort((a, b) => b.w - a.w);
}

const kdaText = (e) => `${e.scores.kills}/${e.scores.deaths}/${e.scores.assists}`;

module.exports = { rankThreats, kdaText, itemGold };
