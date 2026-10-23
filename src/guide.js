const spells = require('../data/spells.json');
const { laterItems } = require('./buildPath');

/** Monta o guia do campeão (itens, feitiços, runas, skills) pronto para a UI, só com texto e IDs. */
function buildGuide({ champ, role, build, dd, runeIndex }) {
  if (!champ || !build) return null;
  const item = (id) => {
    const it = dd && dd.item(id);
    return it ? { id, name: it.name } : null;
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
    runes: r && {
      primaryStyleName: r.primaryStyleName,
      subStyleName: r.subStyleName,
      perks: r.perks.map((id) => ({ id, name: (runeIndex && runeIndex[id] && runeIndex[id].name) || String(id), icon: (runeIndex && runeIndex[id] && runeIndex[id].icon) || null })),
      pickRate: r.pickRate,
    },
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

module.exports = { buildGuide, indexRunes };
