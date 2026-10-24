/**
 * Previsão de rotas do time inimigo no champ select: usa a % de jogos de cada campeão em cada rota
 * (role_rate da tier list do OP.GG) e escolhe a distribuição mais provável (testa todas as permutações).
 */
const ROLES = ['top', 'jungle', 'middle', 'bottom', 'utility'];

/** roleIndex: { champId: { role: share } } a partir da tier list. */
function roleIndex(tierList, dd) {
  const out = {};
  for (const [role, rows] of Object.entries(tierList || {})) {
    for (const r of rows) {
      const c = dd && dd.championByRaw(null, r.champion);
      const id = c ? c.id : r.champion;
      (out[id] ||= {})[role] = r.roleRate || 0.01;
    }
  }
  // normaliza por campeão
  for (const shares of Object.values(out)) {
    const sum = Object.values(shares).reduce((s, v) => s + v, 0) || 1;
    for (const k of Object.keys(shares)) shares[k] /= sum;
  }
  return out;
}

function permutations(list, n) {
  if (n === 0) return [[]];
  const out = [];
  list.forEach((x, i) => {
    for (const rest of permutations([...list.slice(0, i), ...list.slice(i + 1)], n - 1)) out.push([x, ...rest]);
  });
  return out;
}

/**
 * enemies: [{ champion: { id, name }, position }] -> mesma lista com
 * { predicted, confidence, flex: [roles com >= 20%] } nos que não têm rota conhecida.
 */
function predictRoles(enemies, index) {
  const known = new Set(enemies.filter((e) => e.position).map((e) => e.position));
  const open = enemies.filter((e) => e.champion && !e.position);
  if (!open.length || !index) return enemies;
  const free = ROLES.filter((r) => !known.has(r));
  const share = (e, r) => ((index[e.champion.id] || {})[r] || 0) + 0.005;
  let best = null;
  for (const perm of permutations(free, Math.min(open.length, free.length))) {
    let p = 1;
    perm.forEach((r, i) => { p *= share(open[i], r); });
    if (!best || p > best.p) best = { p, perm };
  }
  const assigned = new Map(open.map((e, i) => [e, best ? best.perm[i] : null]));
  return enemies.map((e) => {
    if (!assigned.has(e)) return e;
    const shares = index[e.champion.id] || {};
    const role = assigned.get(e);
    const flex = Object.entries(shares).filter(([, v]) => v >= 0.2).sort((a, b) => b[1] - a[1]).map(([r]) => r);
    return { ...e, predicted: role, confidence: Math.round((shares[role] || 0) * 100), flex: flex.length > 1 ? flex : [] };
  });
}

module.exports = { predictRoles, roleIndex, ROLES };
