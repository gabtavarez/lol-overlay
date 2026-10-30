const spells = require('../data/spells.json');
const { laterItems } = require('./buildPath');

/** Monta o guia do campeão (itens, feitiços, runas, skills) pronto para a UI, só com texto e IDs. */
function buildGuide({ champ, role, build, dd, runeIndex, runeStyles, skills }) {
  if (!champ || !build) return null;
  const item = (id) => {
    const it = dd && dd.item(id);
    return it ? { id, name: it.name, gold: (it.gold && it.gold.total) || 0 } : null;
  };
  const list = (ids) => ids.map(item).filter(Boolean);
  const later = list(laterItems(build));
  const r = build.runes;
  return {
    champion: { id: champ.id, name: champ.name },
    role,
    winRate: build.winRate,
    matchup: build.matchup ? { vs: build.matchup.vs, tip: build.matchup.tip, advantage: build.matchup.advantage, used: build.matchup.used } : null,
    starter: list(build.starter),
    boots: list(build.boots),
    core: list(build.core),
    later,
    spells: build.spells.map((id) => ({ id, name: (spells[id] || {}).name || String(id), key: (spells[id] || {}).key || null })),
    skills: build.skills,
    skillIcons: skills || null,
    starterCounts: countIds(build.starter).map(([id, n]) => ({ ...item(id), count: n })).filter((x) => x.id),
    fullBuild: list(fullBuild(build)),
    runeTree: build.runes ? runeTree(runeStyles, build.runes) : null,
    runes: r && {
      primaryStyleName: r.primaryStyleName,
      subStyleName: r.subStyleName,
      perks: r.perks.map((id) => ({ id, name: (runeIndex && runeIndex[id] && runeIndex[id].name) || String(id), icon: (runeIndex && runeIndex[id] && runeIndex[id].icon) || null })),
      pickRate: r.pickRate,
    },
  };
}

function countIds(ids) {
  const m = new Map();
  for (const id of ids || []) m.set(id, (m.get(id) || 0) + 1);
  return [...m];
}

/** Build completa em ordem: 1º item core, botas, resto do core, depois os itens de fechamento (até 6, sem repetir). */
function fullBuild(build) {
  const core = build.core || [];
  const seq = [core[0], ...(build.boots || []).slice(0, 1), ...core.slice(1), ...laterItems(build)];
  return [...new Set(seq.filter(Boolean))].slice(0, 6);
}

// Fragmentos atuais: 3 linhas, cada uma com 3 opções.
const SHARDS = [
  [[5008, 'Força adaptativa', 'StatModsAdaptiveForceIcon'], [5005, 'Velocidade de ataque', 'StatModsAttackSpeedIcon'], [5007, 'Aceleração de habilidade', 'StatModsCDRScalingIcon']],
  [[5008, 'Força adaptativa', 'StatModsAdaptiveForceIcon'], [5010, 'Velocidade de movimento', 'StatModsMovementSpeedIcon'], [5001, 'Vida por nível', 'StatModsHealthScalingIcon']],
  [[5011, 'Vida', 'StatModsHealthPlusIcon'], [5013, 'Tenacidade e resistência a lentidão', 'StatModsTenacityIcon'], [5001, 'Vida por nível', 'StatModsHealthScalingIcon']],
];

/** Tira as tags do texto da Riot (<b>, <lol-uikit-…>) para virar texto puro. */
const plain = (s) => String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** Árvore completa de runas (todas as opções, marcando as escolhidas), no formato da tela do cliente. */
function runeTree(styles, runes) {
  if (!Array.isArray(styles) || !styles.length) return null;
  const chosen = new Set(runes.perks);
  const styleBtn = (s, sel) => ({ id: s.id, name: s.name, icon: s.icon, selected: s.id === sel });
  const slotRows = (style, from) => (style ? style.slots.slice(from).map((slot) =>
    slot.runes.map((r) => ({ id: r.id, name: r.name, icon: r.icon, desc: plain(r.shortDesc), selected: chosen.has(r.id) }))) : []);
  const primary = styles.find((s) => s.id === runes.primaryStyleId);
  const secondary = styles.find((s) => s.id === runes.subStyleId);
  const statIds = runes.perks.slice(-3);
  return {
    primaryStyles: styles.map((s) => styleBtn(s, runes.primaryStyleId)),
    primary: slotRows(primary, 0),
    secondaryStyles: styles.filter((s) => s.id !== runes.primaryStyleId).map((s) => styleBtn(s, runes.subStyleId)),
    secondary: slotRows(secondary, 1),
    shards: SHARDS.map((row, i) => row.map(([id, name, file]) => ({
      id, name, icon: `perk-images/StatMods/${file}.png`, selected: statIds[i] === id,
    }))),
  };
}

/** runesReforged.json -> { [perkId]: { name, icon } } (estilos, runas e fragmentos do mod). */
function indexRunes(styles) {
  const out = {};
  for (const s of styles || []) {
    out[s.id] = { name: s.name, icon: s.icon };
    for (const slot of s.slots || []) for (const r of slot.runes || []) out[r.id] = { name: r.name, icon: r.icon };
  }
  return out;
}

module.exports = { buildGuide, indexRunes, runeTree, fullBuild };
