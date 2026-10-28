/**
 * Curva de força (early / mid / late) por campeão: listas curtas e editáveis em data/power-curve.json,
 * com padrão pelas tags do Data Dragon. 3 = forte, 2 = médio, 1 = fraco.
 */
const { t: tr } = require('./i18n');
const curves = require('../data/power-curve.json');

function curveOf(champId, tags = []) {
  if (curves.champions[champId]) return curves.champions[champId];
  if (tags.includes('Assassin')) return [3, 3, 1];
  if (tags.includes('Marksman')) return [1, 2, 3];
  if (tags.includes('Tank')) return [2, 2, 3];
  if (tags.includes('Fighter')) return [3, 2, 2];
  if (tags.includes('Mage')) return [2, 2, 3];
  return [2, 2, 2];
}

/** Comparação por fase: [{ phase, label, mine, theirs, verdict, text }]. */
function phaseCompare(me, opp) {
  if (!me || !opp) return null;
  const a = curveOf(me.id, me.tags);
  const b = curveOf(opp.id, opp.tags);
  return ['Early', 'Mid', 'Late'].map((label, i) => {
    const d = a[i] - b[i];
    const verdict = d > 0 ? 'mine' : d < 0 ? 'theirs' : 'even';
    const text = verdict === 'mine' ? tr('Você mais forte') : verdict === 'theirs' ? tr('{champ} mais forte', { champ: opp.name }) : tr('Equilibrado');
    return { phase: i, label, mine: a[i], theirs: b[i], verdict, text };
  });
}

module.exports = { phaseCompare, curveOf };
