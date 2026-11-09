const test = require('node:test');
const assert = require('node:assert');
const { mergeOpts, rank, labView } = require('../src/buildLab');
const { parseMatchup } = require('../src/providers/opggMcp');

test('lab: confronto do OP.GG vira listas de builds com partidas e vitórias', () => {
  const d = { data: {
    core_items: [{ ids: [3118, 4645, 3157], play: 675, win: 343, pick_rate: 0.11 }, { ids: [3118, 3157, 4645], play: 444, win: 246 }],
    boots: [{ ids: [3020], play: 5161, win: 2599 }], starter_items: [{ ids: [1056, 2003, 2003], play: 9501, win: 4693 }],
    summoner_spells: [{ ids: [4, 14], play: 6944, win: 3437 }],
    skills: [{ order: ['Q', 'W', 'E'], play: 4492, win: 2500 }],
    runes: [{ primary_page_id: 8100, secondary_page_id: 8200, primary_rune_ids: [8112, 8139, 8140, 8106], secondary_rune_ids: [8210, 8226], stat_mod_ids: [5005, 5008, 5001], play: 7118, win: 3459 }],
    opponent_champion_tip: 'dica',
  } };
  const m = parseMatchup(JSON.stringify(d));
  assert.equal(m.opts.cores.length, 2);
  assert.deepEqual(m.opts.runes[0].perks, [8112, 8139, 8140, 8106, 8210, 8226, 5005, 5008, 5001]);
  assert.equal(m.core.length, 3); // campos antigos continuam
});

test('lab: soma confrontos, ordena por mais jogada e por maior win rate com amostra mínima', () => {
  const a = { cores: [{ ids: [1, 2, 3], play: 1000, win: 500 }, { ids: [1, 4, 5], play: 300, win: 180 }, { ids: [9, 9, 9], play: 10, win: 9 }] };
  const b = { cores: [{ ids: [1, 2, 3], play: 1000, win: 520 }, { ids: [1, 4, 5], play: 100, win: 60 }] };
  const m = mergeOpts([a, b]);
  const play = rank(m.cores, 'play');
  assert.deepEqual(play[0].ids, [1, 2, 3]);
  assert.equal(play[0].play, 2000);
  const wr = rank(m.cores, 'wr');
  assert.deepEqual(wr[0].ids, [1, 4, 5]); // 60% com 400 jogos
  assert.ok(!wr.some((o) => o.ids[0] === 9), 'build com 10 jogos não entra no maior win rate');
  assert.equal(labView(m).cores.length, 3);
});

test('U.GG: overview mundial Esmeralda+ vira build com win rate e opções de 4º/5º/6º item', () => {
  const { parseOverview } = require('../src/providers/ugg');
  const r = parseOverview(require('./fixtures/ugg-ahri.json'), 'middle');
  assert.equal(r.rank, '17');
  assert.deepEqual(r.cores[0].ids, [3118, 3020, 3100]);
  assert.ok(r.cores[0].win < r.cores[0].play);
  assert.equal(r.runes[0].perks.length, 9);
  assert.equal(r.slots.length, 3);
  assert.ok(r.slots[0][0].win <= r.slots[0][0].play);
  assert.equal(parseOverview(require('./fixtures/ugg-ahri.json'), 'top'), null); // sem a rota no arquivo
});

test('Lolalytics: lê o estado Qwik da página e monta build, opções por posição e runas', () => {
  const { qwikObjects, parseBuild } = require('../src/providers/lolalytics');
  // objs: 0 = dados da build (referências em base 36), demais = valores
  const objs = [
    { header: '1', itemSets: '2', item1: '3', item2: '4', item3: '5', item4: '6', boots: '7', spells: '8', skillOrder: '9', startSet: 'a', runes: 'b' },
    { patch: '16.21', wr: 53.1, n: 1000 }, {},
    [[3118, 53.1, 60, 1000, 11]], [[4645, 53, 30, 600, 20]], [[3157, 56.5, 20, 400, 25]], [[3089, 60.7, 8, 200, 31]],
    [[3020, 53.8, 57, 900, 13]], [['4_14', 53.5, 70, 800]], [['QWE', 53.4, 91, 950]], [['1056_2003_2003', 53.1, 99, 990]],
    { stats: {} },
  ];
  const html = `<html><script type="qwik/json">${JSON.stringify({ objs })}</script></html>`;
  const b = parseBuild(qwikObjects(html), []);
  assert.deepEqual(b.cores[0].ids, [3118, 4645, 3157]);
  assert.equal(b.cores[0].play, 400);
  assert.equal(b.slots.length, 5);
  assert.deepEqual(b.spells[0].ids, [4, 14]);
  assert.deepEqual(b.skills[0].order, ['Q', 'W', 'E']);
  assert.throws(() => qwikObjects('<html>sem dados</html>'), /formato/);
});

test('Lolalytics: runas aceitam a árvore no formato do Data Dragon (slots[].runes)', () => {
  const { topRunePage } = require('../src/providers/lolalytics');
  const R = (id) => ({ id });
  const styles = [
    { id: 8100, slots: [{ runes: [R(8112), R(8128)] }, { runes: [R(8126), R(8139)] }, { runes: [R(8136), R(8140)] }, { runes: [R(8135), R(8106)] }] },
    { id: 8200, slots: [{ runes: [R(8214)] }, { runes: [R(8224), R(8226)] }, { runes: [R(8210), R(8234)] }, { runes: [R(8237), R(8236)] }] },
  ];
  const stats = { 8112: [[80, 53, 1000]], 8139: [[70, 53, 900]], 8140: [[60, 53, 800]], 8106: [[90, 53, 950]], 8226: [[0, 0, 0], [50, 52, 400]], 8210: [[0, 0, 0], [40, 52, 300]] };
  const p = topRunePage(stats, styles);
  assert.equal(p.primaryStyleId, 8100);
  assert.equal(p.subStyleId, 8200);
  assert.deepEqual(p.perks.slice(0, 6), [8112, 8139, 8140, 8106, 8226, 8210]);
});

test('Laboratório: build escolhida é validada e entra por cima da build do OP.GG', () => {
  const { cleanPatch, applyPatch } = require('../src/buildLab');
  const p = cleanPatch({ core: ['3118', 4645, 'x'], boots: [], spells: [4, 14], skills: ['Q', 'W', 'E', 'zz'],
    runes: { primaryStyleId: 8100, subStyleId: 8200, perks: [8112, 8139, 8140, 8106, 8226, 8210, 5005, 5008, 5001] },
    later: [[{ ids: [3089], pick: 1e9 }, { ids: [], pick: 1 }], 'lixo'] });
  assert.deepEqual(p.core, [3118, 4645]);
  assert.equal(p.boots, undefined); // vazio: mantém a do OP.GG
  assert.deepEqual(p.skills, ['Q', 'W', 'E']);
  assert.equal(p.later.length, 1);
  assert.equal(cleanPatch({ runes: { primaryStyleId: 8100, perks: [1] } }).runes, undefined); // página incompleta
  const base = { core: [1, 2, 3], boots: [3020], spells: [4, 12], matchup: { vs: 'Zed' }, winRate: 0.5 };
  const b = applyPatch(base, p, { source: 'lola', label: 'Lolalytics' });
  assert.deepEqual(b.core, [3118, 4645]);
  assert.deepEqual(b.boots, [3020]);
  assert.deepEqual(b.spells, [4, 14]);
  assert.equal(b.matchup, null);
  assert.equal(b.chosen.source, 'lola');
  assert.equal(applyPatch(null, p), null);
});

test('Lolalytics: URL respeita o elo e a página por confronto', () => {
  const { buildUrl } = require('../src/providers/lolalytics');
  assert.equal(buildUrl('Ahri', 'middle', { tier: 'DIAMOND_PLUS' }), 'https://lolalytics.com/lol/ahri/build/?lane=middle&tier=diamond_plus');
  assert.equal(buildUrl('MonkeyKing', 'top', { vs: 'Belveth', tier: 'ALL' }), 'https://lolalytics.com/lol/wukong/vs/belveth/build/?lane=top&vslane=top&tier=all');
  assert.equal(buildUrl('Ahri', 'utility', { tier: 'xx' }), 'https://lolalytics.com/lol/ahri/build/?lane=support&tier=emerald_plus');
});

test('Lolalytics: página por confronto (sem itemSets) e WR da runa principal', () => {
  const { qwikObjects, parseBuild } = require('../src/providers/lolalytics');
  const objs = [
    { header: '1', item1: '2', item2: '3', item3: '4', boots: '5', runes: '6' },
    { patch: '16.22', wr: 50.9, vsWinRate: 51.4, n: 5457 },
    [[3118, 51, 62, 3425, 11]], [[3020, 51.4, 50, 3036, 12]], [[4645, 52, 30, 1435, 20]], [[3020, 51.3, 55, 3029, 14]],
    { stats: { 8112: [[86.9, 50.8, 4744]] } },
  ];
  const z = qwikObjects(`<script type="qwik/json">${JSON.stringify({ objs })}</script>`);
  const R = (id) => ({ id });
  const styles = [{ id: 8100, slots: [[R(8112)], [R(8139)], [R(8140)], [R(8106)]] }, { id: 8200, slots: [[R(8214)], [R(8226)], [R(8210)], [R(8237)]] }];
  const b = parseBuild(z, styles);
  assert.deepEqual(b.cores[0].ids, [3118, 3020, 4645]);
  assert.equal(b.runes[0].play, 4744);
  assert.equal(Math.round((b.runes[0].win / b.runes[0].play) * 1000), 508);
});
