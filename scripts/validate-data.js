/**
 * Confere os dados editáveis contra o Data Dragon atual (roda no CI antes de cada release):
 * todo ID de item precisa existir e estar à venda em Summoner's Rift, e todo campeão citado precisa existir.
 * Falha a build se algo quebrar num patch novo.
 */
const reactive = require('../data/reactive-items.json');
const flags = require('../data/champion-flags.json');
const alerts = require('../data/enemy-alerts.json');
const curves = require('../data/power-curve.json');

const DD = 'https://ddragon.leagueoflegends.com';
const collectIds = (v, out = new Set()) => {
  if (typeof v === 'number') out.add(v);
  else if (Array.isArray(v)) v.forEach((x) => collectIds(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!k.startsWith('_')) collectIds(x, out);
  return out;
};

(async () => {
  const version = (await (await fetch(`${DD}/api/versions.json`)).json())[0];
  const items = (await (await fetch(`${DD}/cdn/${version}/data/en_US/item.json`)).json()).data;
  const champs = (await (await fetch(`${DD}/cdn/${version}/data/en_US/champion.json`)).json()).data;
  const problems = [];
  const itemIds = new Set([...collectIds(reactive), ...Object.keys(alerts.items).map(Number), 1001, 3006, 3020, 3047, 3111, 3158]);
  for (const id of itemIds) {
    const it = items[id];
    if (!it) problems.push(`item ${id} não existe no patch ${version}`);
    else if (!(it.maps && it.maps['11']) || !it.gold.purchasable) problems.push(`item ${id} (${it.name}) não está à venda em Summoner's Rift`);
  }
  const ALIASES = new Set(['Wukong']); // nome alternativo usado de propósito
  const champIds = new Set();
  for (const [k, list] of Object.entries(flags)) if (Array.isArray(list)) list.forEach((c) => champIds.add(c));
  Object.keys(curves.champions).forEach((c) => champIds.add(c));
  const lower = new Map(Object.keys(champs).map((c) => [c.toLowerCase(), c]));
  for (const c of champIds) {
    if (champs[c] || ALIASES.has(c)) continue;
    problems.push(`campeão "${c}" não existe${lower.has(c.toLowerCase()) ? ` (use "${lower.get(c.toLowerCase())}")` : ''}`);
  }
  console.log(`Data Dragon ${version}: ${itemIds.size} itens e ${champIds.size} campeões conferidos.`);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
})().catch((err) => { console.error(err); process.exit(1); });
