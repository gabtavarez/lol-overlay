/**
 * Pick às cegas: o quanto um campeão aguenta sem saber o oponente de rota.
 * Usa os counters do OP.GG (quem vence este campeão e por quanto): poucos counters
 * duros e o pior matchup perto de 50% = seguro; vários counters fortes = arriscado.
 */

const { t: tr } = require('./i18n');
// WR do campeão contra cada counter (o OP.GG guarda a WR do outro lado)
function counterWrs(build) {
  return ((build && build.weakCounters) || [])
    .filter((c) => (c.games || 0) >= 150)
    .map((c) => ({
      name: c.name,
      wr: c.myWinRate != null ? c.myWinRate : c.oppWinRate != null ? 1 - c.oppWinRate : 0.5 - (c.value || 0) * 0.08,
      games: c.games || 0,
    }))
    .sort((a, b) => a.wr - b.wr);
}

/** -> { level: 'safe' | 'ok' | 'risky', worst: [{ name, wr }], hard, text } ou null sem dados. */
function blindSafety(build) {
  const list = counterWrs(build);
  if (!list.length) return null;
  const hard = list.filter((c) => c.wr <= 0.46).length;
  const worst = list[0].wr;
  const level = hard >= 3 || worst <= 0.44 ? 'risky' : hard <= 1 && worst >= 0.465 ? 'safe' : 'ok';
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  const w = list.slice(0, 2).map((c) => `${c.name} ${pct(c.wr)}`).join(', ');
  const text = level === 'safe' ? tr('Seguro às cegas · pior matchup {champ}', { champ: w.split(',')[0] })
    : level === 'risky' ? tr('Arriscado às cegas · {n} counters duros ({list})', { n: hard, list: w })
      : tr('Às cegas: ok · cuidado com {list}', { list: w });
  return { level, hard, worst: list.slice(0, 3).map((c) => ({ name: c.name, wr: c.wr })), text };
}

/**
 * Sem oponente de rota revelado: marca cada candidato e dá um empurrão pequeno
 * (+4 seguro / -5 arriscado) na nota, reordenando. Candidatos sem build em cache ficam como estão.
 */
function applyBlind(candidates, buildOf) {
  const out = candidates.map((c) => {
    const b = blindSafety(buildOf(c));
    if (!b) return c;
    const delta = b.level === 'safe' ? 4 : b.level === 'risky' ? -5 : 0;
    return { ...c, blind: b, score: Math.max(0, Math.min(100, c.score + delta)) };
  });
  return out.sort((a, b) => b.score - a.score);
}

module.exports = { blindSafety, applyBlind, counterWrs };
