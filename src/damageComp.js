/**
 * Composição de dano dos dois times no champ select: % de dano físico (AD), mágico (AP) e verdadeiro.
 * Cada campeão escolhido pesa 1; o perfil vem das tags/overrides (recommender.damageProfile) e de uma
 * tabela de dano verdadeiro (champion-flags.trueDamage). Aproximado: não sabe a build que cada um vai fazer.
 */
const defaultFlags = require('../data/champion-flags.json');
const { damageProfile } = require('./recommender');
const { t: tr } = require('./i18n');

function champProfile(c, flags) {
  const p = damageProfile({ championId: c.id, tags: c.tags || [] }, flags);
  const tru = Math.min(0.5, Number((flags.trueDamage || {})[c.id]) || 0);
  return { ad: p.ad * (1 - tru), ap: p.ap * (1 - tru), true: tru };
}

function teamComp(champs, flags) {
  const list = champs.filter(Boolean);
  if (!list.length) return null;
  const sum = { ad: 0, ap: 0, true: 0 };
  for (const c of list) { const p = champProfile(c, flags); sum.ad += p.ad; sum.ap += p.ap; sum.true += p.true; }
  const pct = (x) => Math.round((x / list.length) * 100);
  const out = { ad: pct(sum.ad), ap: pct(sum.ap), true: pct(sum.true), n: list.length, champs: list.map((c) => c.id) };
  out.ad = 100 - out.ap - out.true; // arredondamento fecha em 100
  return out;
}

/** -> { allies, enemies, notes: [] } (null se ninguém escolheu ainda) */
function damageComp(state, flags = defaultFlags) {
  const pick = (p) => (p && p.champion ? p.champion : null);
  const allies = teamComp([pick(state.me), ...(state.allies || []).map(pick)], flags);
  const enemies = teamComp((state.enemies || []).map(pick), flags);
  if (!allies && !enemies) return null;
  const notes = [];
  const one = (comp, who) => {
    if (!comp || comp.n < 3) return;
    if (comp.ad >= 70) notes.push(tr(who === 'enemies' ? 'Inimigos quase só AD ({p}%): armadura rende muito.' : 'Seu time quase só AD ({p}%): um pick AP equilibra.', { p: comp.ad }));
    else if (comp.ap >= 70) notes.push(tr(who === 'enemies' ? 'Inimigos quase só AP ({p}%): resistência mágica rende muito.' : 'Seu time quase só AP ({p}%): um pick AD equilibra.', { p: comp.ap }));
    if (who === 'enemies' && comp.true >= 15) notes.push(tr('Inimigos com bastante dano verdadeiro ({p}%): vida rende mais que armadura.', { p: comp.true }));
  };
  one(enemies, 'enemies');
  one(allies, 'allies');
  return { allies, enemies, notes };
}

module.exports = { damageComp, teamComp, champProfile };
