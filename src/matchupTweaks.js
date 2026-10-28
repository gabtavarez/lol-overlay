/**
 * Ajustes da build para o matchup (o que muda contra o oponente de rota / a comp inimiga):
 * 1) o que o OP.GG já traz para o matchup (itens, feitiços, runas, ordem de habilidades);
 * 2) regras próprias quando o OP.GG não cobre: feitiço (Purificar/Exaustão/Barreira),
 *    fragmento de tenacidade contra muito CC e Determinação na 2ª árvore em matchup difícil.
 * Devolve a build ajustada e a lista "o que muda" (com a fonte de cada mudança).
 */
const defaultFlags = require('../data/champion-flags.json');
const { damageProfile } = require('./recommender');
const { t: tr, spellName, runeName } = require('./i18n');

const SPELL = { flash: 4, ignite: 14, tp: 12, heal: 7, barrier: 21, exhaust: 3, cleanse: 1, ghost: 6, smite: 11 };
const SPELL_PT = { 4: 'Flash', 14: 'Incendiar', 12: 'Teleporte', 7: 'Curar', 21: 'Barreira', 3: 'Exaustão', 1: 'Purificar', 6: 'Fantasma', 11: 'Golpear', 13: 'Clareza', 32: 'Marca' };
const RESOLVE = 8400;
const R = { bonePlating: 8473, secondWind: 8444, overgrowth: 8451 };
const SHARD = { tenacity: 5013, health: 5011, healthScaling: 5001 };

/** Ordem de maximização (Q/W/E) a partir da sequência de níveis. */
function maxOrder(seq) {
  const count = {};
  const order = [];
  for (const k of seq || []) if (k !== 'R' && (count[k] = (count[k] || 0) + 1) === 5) order.push(k);
  const seen = new Set(order);
  for (const k of seq || []) if (k !== 'R' && !seen.has(k)) { seen.add(k); order.push(k); }
  for (const k of ['Q', 'W', 'E']) if (!seen.has(k)) order.push(k);
  return order.slice(0, 3);
}

const same = (a, b) => String(a || '').toLowerCase().replace(/\W/g, '') === String(b || '').toLowerCase().replace(/\W/g, '');

function tweakForMatchup({ base, build, opp = null, enemies = [], role = '', cls = 'ad', mu = null, oppWinRate = null, flags = defaultFlags }) {
  const used = (build.matchup && build.matchup.used) || [];
  const out = { ...build, spells: [...(build.spells || [])], runes: build.runes ? { ...build.runes, perks: [...build.runes.perks] } : null };
  const rules = [];
  const hardCc = enemies.filter((e) => (flags.hardCc || []).includes(e.id));
  const names = (list) => list.slice(0, 3).map((e) => e.name).join(', ');
  const r = String(role || '').toLowerCase();

  // feitiço: só quando o OP.GG não trouxe feitiços do matchup
  if (!used.includes('feitiços') && r !== 'jungle' && out.spells.length === 2) {
    let want = null;
    let why = '';
    const oppBurst = opp && (flags.burst || []).includes(opp.id);
    const oppAd = opp && damageProfile({ championId: opp.id, tags: opp.tags || [] }, flags).ad >= 0.6;
    if (hardCc.length >= 3 && (cls === 'adc' || cls === 'ap') && r !== 'utility') { want = SPELL.cleanse; why = tr('{champs} têm controle forte', { champs: names(hardCc) }); }
    else if (oppBurst && r === 'middle' && cls !== 'tank') { want = oppAd ? SPELL.exhaust : SPELL.barrier; why = oppAd ? tr('corta o combo de {champ}', { champ: opp.name }) : tr('segura o burst de {champ}', { champ: opp.name }); }
    else if (oppBurst && r === 'utility') { want = SPELL.exhaust; why = tr('contra o all-in de {champ}', { champ: opp.name }); }
    if (want && !out.spells.includes(want)) {
      const i = out.spells.findIndex((s) => s !== SPELL.flash && s !== SPELL.smite);
      if (i >= 0) {
        const old = out.spells[i];
        out.spells[i] = want;
        rules.push({ kind: 'spells', text: tr('{new} no lugar de {old}: {why}', { new: spellName(want), old: old ? spellName(old) : tr('o 2º feitiço'), why }) });
      }
    }
  }

  // fragmento: tenacidade contra comp com muito controle de grupo
  if (out.runes && out.runes.perks.length >= 9 && hardCc.length >= 3) {
    const last = out.runes.perks.length - 1;
    if ([SHARD.health, SHARD.healthScaling].includes(out.runes.perks[last])) {
      out.runes.perks[last] = SHARD.tenacity;
      rules.push({ kind: 'shards', text: tr('Fragmento de tenacidade e resistência a lentidão: {champs} prendem muito', { champs: names(hardCc) }) });
    }
  }

  // matchup difícil: Determinação na 2ª árvore (se o OP.GG não trouxe runas do matchup)
  const hard = opp && ((oppWinRate != null && oppWinRate < 0.48) || (mu && mu.laneAdvantage && same(mu.laneAdvantage, opp.name)));
  if (hard && out.runes && out.runes.perks.length === 9 && !used.includes('runas') && cls !== 'tank'
    && out.runes.primaryStyleId !== RESOLVE && out.runes.subStyleId !== RESOLVE) {
    const burst = (flags.burst || []).includes(opp.id);
    const sec = burst ? [R.bonePlating, R.overgrowth] : [R.secondWind, R.overgrowth];
    out.runes = { ...out.runes, subStyleId: RESOLVE, subStyleName: runeName(RESOLVE), perks: [...out.runes.perks.slice(0, 4), ...sec, ...out.runes.perks.slice(6)] };
    rules.push({ kind: 'runes', text: `${tr('{tree} na 2ª árvore ({a} + {b}): matchup difícil', { tree: runeName(RESOLVE), a: runeName(sec[0]), b: runeName(sec[1]) })}${oppWinRate != null ? ` ${tr('({p}% de vitória)', { p: Math.round(oppWinRate * 100) })}` : ''}` });
  }
  return { build: out, rules };
}

/**
 * "O que muda" entre a build geral e a do matchup, em texto. `names`: { item(id), rune(id), spell(id) }.
 * As regras próprias (rules) entram como estão; o resto vem do OP.GG.
 */
function describeChanges(base, final, rules = [], names = {}) {
  const item = names.item || String;
  const rune = names.rune || String;
  const spell = (id) => (names.spell ? names.spell(id) : spellName(id));
  const out = rules.map((x) => ({ ...x, source: 'regra' }));
  const kinds = new Set(rules.map((x) => x.kind));
  const added = (final.core || []).filter((id) => !(base.core || []).includes(id));
  const removed = (base.core || []).filter((id) => !(final.core || []).includes(id));
  if (added.length) out.unshift({ kind: 'items', source: 'OP.GG', text: removed.length ? tr('Itens: {a} no lugar de {b}', { a: added.map(item).join(', '), b: removed.map(item).join(', ') }) : tr('Itens: {a}', { a: added.map(item).join(', ') }) });
  if (!kinds.has('spells') && [...(final.spells || [])].sort().join() !== [...(base.spells || [])].sort().join()) {
    out.push({ kind: 'spells', source: 'OP.GG', text: tr('Feitiços: {list}', { list: (final.spells || []).map(spell).join(' + ') }) });
  }
  if (!kinds.has('runes') && final.runes && base.runes) {
    if (final.runes.perks[0] !== base.runes.perks[0]) out.push({ kind: 'runes', source: 'OP.GG', text: tr('Runa principal: {a} em vez de {b}', { a: rune(final.runes.perks[0]), b: rune(base.runes.perks[0]) }) });
    else if (final.runes.subStyleId !== base.runes.subStyleId) out.push({ kind: 'runes', source: 'OP.GG', text: tr('2ª árvore: {tree}', { tree: final.runes.subStyleName || rune(final.runes.subStyleId) }) });
  }
  const a = maxOrder(base.skills);
  const b = maxOrder(final.skills);
  if ((final.skills || []).length && a.join() !== b.join()) {
    out.push({ kind: 'skills', source: 'OP.GG', text: tr('Habilidades: maximize {a} (em vez de {b})', { a: b.join(' › '), b: a.join(' › ') }) });
  }
  return out;
}

module.exports = { tweakForMatchup, describeChanges, maxOrder, SPELL, SPELL_PT };
