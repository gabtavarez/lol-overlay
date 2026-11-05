/** Sonda manual: skins da linha "Santuário" no CommunityDragon e como o app as enxerga. */
const fs = require('fs');
const B = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/pt_br/v1/';
(async () => {
  fs.mkdirSync('audit/probe', { recursive: true });
  const out = {};
  const skins = Object.values(await (await fetch(B + 'skins.json')).json());
  const lines = await (await fetch(B + 'skinlines.json')).json();
  const lname = Object.fromEntries(lines.map((l) => [l.id, l.name]));
  out.lineMatches = lines.filter((l) => /santu|sanct/i.test(l.name)).map((l) => ({ id: l.id, name: l.name }));
  const ids = new Set(out.lineMatches.map((l) => l.id));
  out.inLine = skins.filter((s) => (s.skinLines || []).some((l) => ids.has(l.id))).map((s) => ({ id: s.id, name: s.name, rarity: s.rarity, legacy: s.isLegacy, base: s.isBase, lines: (s.skinLines || []).map((l) => lname[l.id]) }));
  out.byChamp = {};
  for (const c of [122, 86, 84, 28]) out.byChamp[c] = skins.filter((s) => Math.floor(s.id / 1000) === c && s.id % 1000 > 0).sort((a, b) => b.id - a.id).slice(0, 5).map((s) => ({ id: s.id, name: s.name, rarity: s.rarity, lines: (s.skinLines || []).map((l) => lname[l.id]) }));
  const v = (await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json())[0];
  out.v = v;
  out.imgs = [];
  for (const s of out.inLine.slice(0, 10)) {
    const cid = Math.floor(s.id / 1000);
    out.imgs.push({ id: s.id, name: s.name, cdragonTile: (await fetch(`https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-tiles/${cid}/${s.id}.jpg`)).status });
  }
  fs.writeFileSync('audit/probe/sanct.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
})();
