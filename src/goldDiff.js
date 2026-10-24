const { itemGold } = require('./threat');

const ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const LABEL = { TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte' };

/** Ordena um time por rota (posição da Live API; sem ela, mantém a ordem do jogo). */
function byRole(team) {
  const withPos = team.filter((p) => ORDER.includes(p.position));
  if (withPos.length === team.length && new Set(withPos.map((p) => p.position)).size === team.length) {
    return [...team].sort((a, b) => ORDER.indexOf(a.position) - ORDER.indexOf(b.position));
  }
  return team;
}

/**
 * Comparação de ouro cara a cara pelo valor dos itens (a Live API não mostra o ouro dos outros,
 * então usamos o que todo mundo vê: o inventário). Ouro no bolso não entra para ninguém.
 */
function goldCompare(state, dd) {
  if (!state || !state.me || !dd) return null;
  const allies = byRole([state.me, ...(state.allies || [])]);
  const enemies = byRole(state.enemies || []);
  const row = (p) => p && { name: p.champion, champId: p.championId, gold: itemGold(p, dd), me: p === state.me };
  const lanes = [];
  for (let i = 0; i < Math.max(allies.length, enemies.length); i++) {
    const a = row(allies[i]);
    const e = row(enemies[i]);
    const pos = (allies[i] && allies[i].position) || (enemies[i] && enemies[i].position) || '';
    lanes.push({ role: LABEL[pos] || '', ally: a, enemy: e, diff: (a ? a.gold : 0) - (e ? e.gold : 0) });
  }
  const sum = (list) => list.reduce((s, p) => s + itemGold(p, dd), 0);
  const ally = sum(allies);
  const enemy = sum(enemies);
  return { lanes, team: { ally, enemy, diff: ally - enemy } };
}

module.exports = { goldCompare, byRole };
