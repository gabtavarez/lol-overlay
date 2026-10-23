const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { startMock } = require('../mock/mockServer');
const { fetchAllGameData, getJson } = require('../src/liveClient');
const { DataDragon } = require('../src/ddragon');
const { buildState } = require('../src/state');
const { recommend } = require('../src/recommender');
const { createEngine } = require('../src/engine');

const champ = (id, tags) => [id, { id, name: id, tags }];
const FAKE_CHAMPIONS = Object.fromEntries([
  champ('Jinx', ['Marksman']),
  champ('Ornn', ['Tank', 'Fighter']),
  champ('Vi', ['Fighter', 'Assassin']),
  champ('Orianna', ['Mage', 'Support']),
  champ('Leona', ['Tank', 'Support']),
  champ('Aatrox', ['Fighter', 'Tank']),
  champ('Warwick', ['Fighter', 'Tank']),
  champ('Ahri', ['Mage', 'Assassin']),
  champ('Caitlyn', ['Marksman']),
  champ('Soraka', ['Support', 'Mage']),
]);
const FAKE_ITEMS = {
  3072: { name: 'Sanguine Blade', tags: ['LifeSteal', 'Damage'] },
  3153: { name: 'Blade of the Ruined King', tags: ['LifeSteal', 'Damage'] },
  1055: { name: "Doran's Blade", tags: ['Damage', 'Lane'] },
};

function fakeFetch(calls = []) {
  return async (url) => {
    calls.push(url);
    const body = url.endsWith('versions.json') ? ['99.1.1', '99.0.1']
      : url.endsWith('champion.json') ? { data: FAKE_CHAMPIONS }
      : url.endsWith('item.json') ? { data: FAKE_ITEMS }
      : null;
    if (!body) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => body };
  };
}

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ddragon-test-'));
}

test('DataDragon baixa, grava em cache e funciona offline depois', async () => {
  const cacheDir = await tmpDir();
  const online = new DataDragon({ cacheDir, fetchImpl: fakeFetch() });
  await online.init();
  assert.equal(online.version, '99.1.1');
  assert.equal(online.item(1055).name, "Doran's Blade");

  const offline = new DataDragon({ cacheDir, fetchImpl: async () => { throw new Error('sem rede'); } });
  await offline.init();
  assert.equal(offline.version, '99.1.1');
  assert.equal(offline.championByRaw('game_character_displayname_Jinx', 'Jinx').id, 'Jinx');
  assert.equal(offline.championByRaw('algo_estranho', 'Caitlyn').id, 'Caitlyn');
});

test('liveClient recusa hosts fora do loopback', async () => {
  await assert.rejects(getJson('https://example.com/x'), /host não permitido/);
});

test('pipeline completo: mock -> estado -> recomendador', async () => {
  const server = await startMock(0, { speed: 60 });
  const port = server.address().port;
  try {
    const dd = new DataDragon({ cacheDir: await tmpDir(), fetchImpl: fakeFetch() });
    await dd.init();

    await new Promise((r) => setTimeout(r, 1200)); // ~72s de jogo simulado
    const raw = await fetchAllGameData(`http://127.0.0.1:${port}`);
    const state = buildState(raw, dd);

    assert.equal(state.phase, 'ingame');
    assert.equal(state.me.champion, 'Jinx');
    assert.equal(state.enemies.length, 5);
    assert.equal(state.allies.length, 4);
    assert.equal(state.laneOpponent.championId, 'Caitlyn');
    assert.equal(state.enemies.find((e) => e.championId === 'Soraka').tags.includes('Support'), true);

    const advice = recommend(state);
    assert.ok(advice.hints.some((h) => h.id === 'antiheal' && h.level === 'warn'), 'Soraka + Warwick => corta-cura');
    assert.ok(advice.hints.some((h) => h.id === 'armor'), 'maioria AD => armadura');
    assert.deepEqual(advice.buildSuggestions, []);
  } finally {
    server.close();
  }
});

test('contagem de objetivos e nome malicioso preservado como texto', async () => {
  const server = await startMock(0, { speed: 600 }); // >5min de jogo quase na hora
  const port = server.address().port;
  try {
    await new Promise((r) => setTimeout(r, 700));
    const state = buildState(await fetchAllGameData(`http://127.0.0.1:${port}`), null);
    assert.equal(state.objectives.dragons.CHAOS, 1);
    assert.equal(state.objectives.dragons.ORDER, 0);
    // sem Data Dragon ainda funciona, e o nome com HTML vem intacto (o renderer usa textContent)
    assert.ok(state.enemies.some((e) => e.name.startsWith('<b>')));
    assert.equal(state.assets.version, null);
  } finally {
    server.close();
  }
});

test('engine: sem partida => waiting; com partida => ingame com advice', async () => {
  const states = [];
  const dead = createEngine({ baseUrl: 'http://127.0.0.1:1', getDd: () => null, onState: (s) => states.push(s) });
  await dead.tick();
  assert.equal(states.at(-1).phase, 'waiting');

  const server = await startMock(0);
  try {
    const live = createEngine({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      getDd: () => null,
      onState: (s) => states.push(s),
    });
    await live.tick();
    assert.equal(states.at(-1).phase, 'ingame');
    assert.ok(states.at(-1).advice.hints.length > 0);
  } finally {
    server.close();
  }
});
