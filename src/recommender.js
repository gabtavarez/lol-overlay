const { t: tr } = require('./i18n');
const defaultFlags = require('../data/champion-flags.json');

const HEAL_ITEM_TAGS = ['LifeSteal', 'SpellVamp'];

/** Estimativa de tipo de dano de um campeão: { ad, ap } somando 1. */
function damageProfile(enemy, flags) {
  const id = enemy.championId;
  if (flags.apOverrides.includes(id)) return { ad: 0, ap: 1 };
  if (flags.adOverrides.includes(id)) return { ad: 1, ap: 0 };
  const ap = enemy.tags.includes('Mage') ? 1 : 0;
  const ad = ['Marksman', 'Fighter', 'Assassin'].filter((t) => enemy.tags.includes(t)).length;
  if (!ap && !ad) return { ad: 0.5, ap: 0.5 }; // Tank/Suporte puro: sem sinal claro
  const total = ap + ad;
  return { ad: ad / total, ap: ap / total };
}

function countItemsWithTag(enemies, tags) {
  return enemies.reduce(
    (sum, e) => sum + e.items.filter((it) => it.tags.some((t) => tags.includes(t))).length,
    0,
  );
}

/**
 * Camada de análise. Hoje só mede ameaças do time inimigo e gera dicas
 * genéricas. `buildSuggestions` fica vazio de propósito: é o ponto de encaixe
 * para "melhores builds do matchup" + conhecimento geral de macro.
 */
function recommend(state, flags = defaultFlags) {
  const enemies = state.enemies;
  const n = enemies.length || 1;

  const dmg = enemies.map((e) => damageProfile(e, flags));
  const adShare = dmg.reduce((s, d) => s + d.ad, 0) / n;
  const apShare = dmg.reduce((s, d) => s + d.ap, 0) / n;

  const healChampions = enemies.filter((e) => flags.healers.includes(e.championId));
  const healItemCount = countItemsWithTag(enemies, HEAL_ITEM_TAGS);
  const healSources = healChampions.length + (healItemCount >= 2 ? 1 : 0);

  const armorItemCount = countItemsWithTag(enemies, ['Armor']);
  const mrItemCount = countItemsWithTag(enemies, ['SpellBlock']);

  const fed = enemies.filter(
    (e) => e.scores.kills >= 5 && e.scores.kills - e.scores.deaths >= 4,
  );

  const hints = [];

  if (healChampions.length >= 2) {
    hints.push({
      id: 'antiheal',
      level: 'warn',
      text: tr('Corta-cura: {champs} curam.', { champs: healChampions.map((e) => e.champion).join(', ') }),
    });
  } else if (healSources >= 1) {
    const who = healChampions.length
      ? healChampions[0].champion
      : 'itens de roubo de vida inimigos';
    hints.push({ id: 'antiheal', level: 'info', text: tr('Considere corta-cura ({champs}).', { champs: who }) });
  }

  if (apShare >= 0.6) {
    hints.push({ id: 'mr', level: 'warn', text: tr('Time inimigo majoritariamente AP: priorize RM.') });
  } else if (adShare >= 0.6) {
    hints.push({ id: 'armor', level: 'warn', text: tr('Time inimigo majoritariamente AD: priorize armadura.') });
  } else {
    hints.push({ id: 'mixed', level: 'info', text: tr('Dano misto: equilibre armadura e RM.') });
  }

  if (armorItemCount >= 3) {
    hints.push({ id: 'armorpen', level: 'info', text: tr('Inimigos empilhando armadura: considere penetração de armadura.') });
  }
  if (mrItemCount >= 3) {
    hints.push({ id: 'magicpen', level: 'info', text: tr('Inimigos empilhando RM: considere penetração mágica.') });
  }

  for (const e of fed) {
    const s = e.scores;
    hints.push({
      id: `fed-${e.championId}`,
      level: 'warn',
      text: tr('{champ} está forte ({kda}).', { champ: e.champion, kda: `${s.kills}/${s.deaths}/${s.assists}` }),
    });
  }

  return {
    summary: {
      adShare: Number(adShare.toFixed(2)),
      apShare: Number(apShare.toFixed(2)),
      healSources,
      armorItemCount,
      mrItemCount,
      fed: fed.map((e) => e.championId),
    },
    hints,
    buildSuggestions: [], // TODO: melhores builds do matchup + regras de macro
  };
}

module.exports = { recommend, damageProfile };
