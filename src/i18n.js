/**
 * Textos gerados no processo principal (coach, compras, notas, sequência…) no idioma do app.
 * Usa os mesmos dicionários da interface (renderer/locales/<lang>.js): chave = texto em português.
 * Sem tradução, sai o português. Nomes de campeões/itens já chegam no idioma da região (Data Dragon).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dicts = {};
let lang = 'pt';

function load(l) {
  if (l === 'pt' || dicts[l]) return dicts[l];
  try {
    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'locales', `${l}.js`), 'utf8'), ctx);
    dicts[l] = ctx.window.LOCALES[l] || {};
  } catch {
    dicts[l] = {};
  }
  return dicts[l];
}

function setLang(l) { lang = ['pt', 'en', 'es'].includes(l) ? l : 'pt'; load(lang); }
const getLang = () => lang;

/** t('Faltam {n} g', { n: 300 }) */
function t(text, vars) {
  const d = lang === 'pt' ? null : load(lang);
  let out = (d && d[text]) || text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

/*
 * Nomes oficiais do jogo no idioma da região (Data Dragon): feitiços e runas.
 * O main preenche ao carregar os dados; sem eles, usa os nomes em português abaixo.
 */
const SPELL_PT = { 4: 'Flash', 14: 'Incendiar', 12: 'Teleporte', 7: 'Curar', 21: 'Barreira', 3: 'Exaustão', 1: 'Purificar', 6: 'Fantasma', 11: 'Golpear', 13: 'Clareza', 32: 'Marca' };
const SPELL_KEY_ID = { SummonerFlash: 4, SummonerDot: 14, SummonerTeleport: 12, SummonerHeal: 7, SummonerBarrier: 21, SummonerExhaust: 3, SummonerBoost: 1, SummonerHaste: 6, SummonerSmite: 11, SummonerMana: 13, SummonerSnowball: 32 };
const RUNE_PT = { 8400: 'Determinação', 8473: 'Osso Revestido', 8444: 'Segundo Fôlego', 8451: 'Crescimento Excessivo' };
const names = { spells: {}, runes: {} };

/** spells: { id: nome } ; runes: { id: nome } (perks e árvores) */
function setGameNames({ spells, runes } = {}) {
  if (spells) names.spells = spells;
  if (runes) names.runes = runes;
}
/** id numérico (4) ou chave do Data Dragon ('SummonerFlash') -> nome do feitiço no idioma da região. */
function spellName(idOrKey) {
  const id = typeof idOrKey === 'string' && SPELL_KEY_ID[idOrKey] ? SPELL_KEY_ID[idOrKey] : Number(idOrKey);
  return names.spells[id] || SPELL_PT[id] || String(idOrKey);
}
/** { SummonerFlash: 'Flash', … } no idioma do app (para o overlay). */
const spellNamesByKey = () => Object.fromEntries(Object.keys(SPELL_KEY_ID).map((k) => [k, spellName(k)]));
const runeName = (id) => names.runes[id] || RUNE_PT[id] || String(id);

module.exports = { t, setLang, getLang, setGameNames, spellName, spellNamesByKey, runeName };
