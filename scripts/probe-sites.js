/** Sonda manual: roda o provider do Lolalytics de verdade (geral, elo e confronto). */
const fs = require('fs');
const { createLolalytics } = require('../src/providers/lolalytics');
(async () => {
  fs.mkdirSync('audit/probe', { recursive: true });
  const styles = (await (await fetch('https://ddragon.leagueoflegends.com/cdn/16.22.1/data/en_US/runesReforged.json')).json()).map((st) => ({ id: st.id, slots: st.slots.map((sl) => sl.runes) }));
  let tier = 'DIAMOND_PLUS';
  const l = createLolalytics({ log: console.log, getStyles: () => styles, getTier: () => tier });
  const run = (c, r, vs) => new Promise((res) => l.ensure(c, r, () => res(l.get(c, r, vs)), vs));
  const out = {};
  const sum = (d) => d && (d.error ? { error: d.error } : { patch: d.patch, games: d.games, core: d.cores[0], boots: d.boots[0], rune: d.runes[0], skills: d.skills[0], slot4: d.slots[3] && d.slots[3][0] });
  out.ahriDia = sum(await run('Ahri', 'middle'));
  out.ahriVsZed = sum(await run('Ahri', 'middle', 'Zed'));
  out.jinx = sum(await run('Jinx', 'bottom'));
  out.wukongVsBelveth = sum(await run('MonkeyKing', 'jungle', 'Belveth'));
  tier = 'ALL';
  out.ahriAll = sum(await run('Ahri', 'middle'));
  fs.writeFileSync('audit/probe/lola3.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
})();
