const test = require('node:test');
const assert = require('node:assert');
const { rankThreats } = require('../src/threat');

const p = (champion, k, d, a, level = 9) => ({ champion, level, scores: { kills: k, deaths: d, assists: a }, items: [] });

test('inimigo fed vira a maior ameaça; oponente de rota pesa mais', () => {
  const r = rankThreats([p('Lux', 1, 4, 2), p('Zed', 8, 1, 2), p('Leona', 0, 3, 5)], { myLevel: 9 });
  assert.equal(r[0].e.champion, 'Zed');
  assert.ok(r[0].fed);
  const lane = rankThreats([p('Lux', 2, 2, 2), p('Ahri', 2, 2, 2)], { laneOpponentName: 'Ahri' });
  assert.equal(lane[0].e.champion, 'Ahri');
  assert.ok(lane[0].lane);
});

const { buyAdvice } = require('../src/buys');
const items = { 3111: { name: 'Mercúrio', tags: ['Boots'], gold: { total: 1250 } }, 3047: { name: 'Aço', tags: ['Boots'], gold: { total: 1200 } }, 3020: { name: 'Feiticeiro', tags: ['Boots'], gold: { total: 1100 } }, 1056: { name: 'Doran', tags: [], gold: { total: 400 } } };
const dd = { item: (id) => items[id] || null };
const flags = { healers: [], apOverrides: [], adOverrides: [], hardCc: ['Leona', 'Nautilus', 'Lissandra'] };
const enemy = (champion, tags, k, d, a, position = '') => ({ champion, championId: champion, tags, level: 6, position, scores: { kills: k, deaths: d, assists: a }, items: [] });
const me = (k, d) => ({ champion: 'Lux', tags: ['Mage'], level: 6, gold: 1300, items: [{ id: 1056 }], scores: { kills: k, deaths: d, assists: 0 } });
const bootOf = (adv) => adv.items.find((i) => i.tag === 'boots');

test('bota: ofensiva se a rota está controlada; defensiva se perdendo; Mercúrio contra muito CC', () => {
  const build = { boots: [3020], core: [], damageType: 'AP' };
  const calm = buyAdvice({ dd, flags, build, state: { gameTime: 700, me: me(2, 0), enemies: [enemy('Ahri', ['Mage'], 0, 2, 0, 'MIDDLE'), enemy('Garen', ['Fighter'], 1, 1, 0)], laneOpponent: { champion: 'Ahri' } } });
  assert.equal(bootOf(calm).id, 3020);
  const losing = buyAdvice({ dd, flags, build, state: { gameTime: 700, me: me(0, 4), enemies: [enemy('Zed', ['Assassin'], 5, 0, 1), enemy('Lux2', ['Mage'], 0, 1, 0)], laneOpponent: { champion: 'Zed' } } });
  assert.equal(bootOf(losing).id, 3047);
  const cc = buyAdvice({ dd, flags, build, state: { gameTime: 700, me: me(1, 1), enemies: [enemy('Leona', ['Tank'], 0, 1, 2), enemy('Nautilus', ['Tank'], 0, 1, 1), enemy('Lissandra', ['Mage'], 1, 1, 0)] } });
  assert.equal(bootOf(cc).id, 3111);
});

const { missingGold } = require('../src/buys');
test('ouro faltando desconta componentes (inclusive de componentes) e mostra quais', () => {
  const I = { 6655: { gold: { base: 950 }, from: ['3802', '1052'] }, 3802: { gold: { base: 450 }, from: ['1052', '1027'] }, 1052: { gold: { total: 400 } }, 1027: { gold: { total: 300 } } };
  const d = { item: (id) => I[String(id)] };
  assert.equal(missingGold(d, 6655, []), 950 + 450 + 400 + 300 + 400);
  const used = [];
  assert.equal(missingGold(d, 6655, [3802], used), 950 + 400);
  assert.deepEqual(used, [3802]);
  assert.equal(missingGold(d, 6655, [1052, 1027]), 950 + 450 + 400);
});
