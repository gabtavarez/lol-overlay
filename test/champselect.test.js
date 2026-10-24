const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { startMockLcu, CHAMPION_FIXTURE, SESSION } = require('../mock/mockLcu');
const { DataDragon } = require('../src/ddragon');
const { parseCommandLine, parseLockfile } = require('../src/lcu');
const { loadProfile, laneToPosition, aggregateHistory } = require('../src/profile');
const { buildChampSelectState, puuidsToResolve } = require('../src/champSelect');
const { recommendPicks } = require('../src/picker');
const { createLcuEngine } = require('../src/lcuEngine');
const { toOpggRegion, buildMultisearchUrl } = require('../src/opgg');
const { sanitize, createSettingsStore, DEFAULTS } = require('../src/settings');
const { normalizeMeta, loadMeta } = require('../src/meta');
const { pickState } = require('../src/router');

const PICKABLE = [222, 51, 22, 145, 81, 119, 202, 99, 16];
const EMPTY_META = { tiers: {}, counters: {} };

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'champselect-test-'));
}

async function makeDd() {
  const data = Object.fromEntries(CHAMPION_FIXTURE.map((c) => [c.id, c]));
  const fetchImpl = async (url) => {
    const body = url.endsWith('versions.json') ? ['99.1.1']
      : url.endsWith('champion.json') ? { data }
      : url.endsWith('item.json') ? { data: {} }
      : null;
    return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404 };
  };
  const dd = new DataDragon({ cacheDir: await tmpDir(), fetchImpl });
  await dd.init();
  return dd;
}

async function withLcu(opts, fn) {
  const server = await startMockLcu(0, opts);
  const creds = { port: server.address().port, token: (opts && opts.token) || 'mock', protocol: 'http' };
  try {
    return await fn(creds);
  } finally {
    server.close();
  }
}

function state(dd, overrides = {}) {
  const names = new Map([['aaaaaaaa-0000-0000-0000-000000000001', { gameName: 'AliadoJg', tagLine: 'BR1' }]]);
  return { ...buildChampSelectState(SESSION, { names, dd, pickable: PICKABLE }), ...overrides };
}

const settingsWith = (patch) => sanitize(patch, DEFAULTS);
const ids = (r) => r.candidates.map((c) => c.id);

test('opgg: regiões e URL da multisearch', () => {
  assert.equal(toOpggRegion('BR1'), 'br');
  assert.equal(toOpggRegion('EUW1'), 'euw');
  assert.equal(toOpggRegion('SG2'), 'sea');
  assert.equal(toOpggRegion('xx'), null);

  const url = buildMultisearchUrl(
    [{ gameName: 'A B', tagLine: 'BR1' }, { gameName: '', tagLine: '' }, { gameName: 'C', tagLine: 'X' }],
    'br',
  );
  assert.ok(url.startsWith('https://op.gg/lol/multisearch/br?summoners='));
  assert.equal(decodeURIComponent(url.split('summoners=')[1]), 'A B#BR1,C#X');
  assert.equal(buildMultisearchUrl([{ gameName: '', tagLine: '' }], 'br'), null);
  assert.equal(buildMultisearchUrl([{ gameName: 'A', tagLine: '1' }], null), null);
});

test('lcu: parsers de linha de comando e lockfile', () => {
  const line = '"C:\\Riot Games\\LeagueClientUx.exe" "--riotclient-auth-token=abc" "--app-port=54321" "--remoting-auth-token=Tok_en-123" "--region=BR"';
  assert.deepEqual(parseCommandLine(line), { port: 54321, token: 'Tok_en-123', protocol: 'https' });
  assert.equal(parseCommandLine('nada'), null);
  assert.deepEqual(parseLockfile('LeagueClient:1234:5555:segredo:https'), { port: 5555, token: 'segredo', protocol: 'https' });
  assert.equal(parseLockfile('lixo'), null);
});

test('profile: rotas do histórico e agregação', () => {
  assert.equal(laneToPosition('BOTTOM', 'DUO_CARRY'), 'bottom');
  assert.equal(laneToPosition('BOTTOM', 'DUO_SUPPORT'), 'utility');
  assert.equal(laneToPosition('MIDDLE', 'SOLO'), 'middle');
  assert.equal(laneToPosition('JUNGLE', 'NONE'), 'jungle');
  assert.equal(laneToPosition('NONE', 'NONE'), null);

  const aram = { mapId: 12, participants: [{ championId: 1, stats: { win: true }, timeline: { lane: 'MIDDLE', role: 'SOLO' } }] };
  const sr = { mapId: 11, participants: [{ championId: 1, stats: { win: true }, timeline: { lane: 'MIDDLE', role: 'SOLO' } }] };
  const { roleStats, analyzed } = aggregateHistory([{ games: { games: [aram, sr, {}] } }, null]);
  assert.equal(analyzed, 1);
  assert.deepEqual(roleStats.middle[1], { games: 1, wins: 1 });
});

test('profile: carrega maestria e histórico do cliente (com autenticação)', async () => {
  await withLcu({}, async (creds) => {
    const profile = await loadProfile(creds);
    assert.equal(profile.summoner.gameName, 'Gabriel');
    assert.equal(profile.mastery.size, 7);
    assert.equal(profile.mastery.get(222).level, 7);
    assert.equal(profile.gamesAnalyzed, 30); // 20 da primeira página + 10 da segunda
    assert.deepEqual(profile.roleStats.bottom[222], { games: 12, wins: 8 });
  });
  await withLcu({}, async (creds) => {
    await assert.rejects(loadProfile({ ...creds, token: 'errado' }), /HTTP 401/);
  });
});

test('champ select: nomes ocultos continuam ocultos; visíveis são resolvidos', async () => {
  const dd = await makeDd();
  assert.deepEqual(puuidsToResolve(SESSION), ['aaaaaaaa-0000-0000-0000-000000000001']);

  const s = state(dd);
  assert.equal(s.myPosition, 'bottom');
  assert.equal(s.action, 'pick');
  assert.equal(s.me.gameName, 'Gabriel');
  assert.equal(s.allies.find((p) => p.position === 'jungle').gameName, 'AliadoJg'); // via lookup
  assert.equal(s.allies.find((p) => p.position === 'jungle').champion.id, 'Vi'); // só hover
  assert.ok(s.enemies.every((e) => e.nameHidden && e.gameName === ''));
  assert.equal(s.enemies.find((e) => e.position === 'middle').champion.id, 'Ahri');
  assert.equal(s.assets.version, '99.1.1');
});

test('picker: maestria + histórico na rota ordenam as sugestões', async () => {
  const dd = await makeDd();
  await withLcu({}, async (creds) => {
    const profile = await loadProfile(creds);
    const r = recommendPicks({ champSelect: state(dd), profile, dd, settings: settingsWith({}), meta: EMPTY_META });

    assert.equal(r.role, 'bottom');
    assert.equal(r.candidates[0].id, 'Jinx');
    assert.ok(r.candidates[0].reasons.some((t) => t.startsWith('Maestria 7')));
    assert.ok(r.candidates[0].score <= 100);
    assert.ok(r.signalsUsed.includes('personal'));
    assert.ok(!r.signalsUsed.includes('meta') && !r.signalsUsed.includes('counter'));
    assert.ok(r.notes.some((n) => n.includes('Sem dados de meta/counters')));
    // filtro de rota: nenhum campeão que o time já travou nem quem nunca jogou de atirador
    assert.ok(!ids(r).includes('Ornn') && !ids(r).includes('Leona'));
    assert.ok(!ids(r).includes('Soraka'));
  });
});

test('picker: banidos, blacklist e pool personalizável', async () => {
  const dd = await makeDd();
  await withLcu({}, async (creds) => {
    const profile = await loadProfile(creds);
    const base = state(dd);

    const banned = recommendPicks({
      champSelect: { ...base, bans: { mine: [222], theirs: [] } },
      profile, dd, settings: settingsWith({}), meta: EMPTY_META,
    });
    assert.ok(!ids(banned).includes('Jinx'));

    const blacklisted = recommendPicks({
      champSelect: base, profile, dd, meta: EMPTY_META,
      settings: settingsWith({ picker: { blacklist: ["Kai'Sa", 'jinx'] } }),
    });
    assert.ok(!ids(blacklisted).includes('Jinx') && !ids(blacklisted).includes('Kaisa'));

    const withPool = recommendPicks({
      champSelect: base, profile, dd, meta: EMPTY_META,
      settings: settingsWith({ picker: { pool: { bottom: ['Jhin'] }, poolBonus: 0.5 } }),
    });
    const jhin = withPool.candidates.find((c) => c.id === 'Jhin');
    assert.ok(jhin, 'Jhin entra pelo pool mesmo sem histórico na rota');
    assert.ok(jhin.reasons.includes('No seu pool'));
  });
});

test('picker: meta e counters mudam o ranking conforme os pesos', async () => {
  const dd = await makeDd();
  await withLcu({}, async (creds) => {
    const profile = await loadProfile(creds);
    const base = state(dd);
    // inimigo de bot revelado (Ashe) para o sinal de counter
    const enemies = base.enemies.map((e) => (e.position === 'bottom'
      ? { ...e, championKey: 22, champion: { id: 'Ashe', name: 'Ashe', tags: ['Marksman', 'Support'] } }
      : e));

    const meta = normalizeMeta({
      tiers: { bottom: { Caitlyn: 'S', Jinx: 'D', Kaisa: 'B' } },
      counters: { Ashe: { Caitlyn: 1, Jinx: -0.8 } },
    });

    const onlyMeta = recommendPicks({
      champSelect: base, profile, dd, meta,
      settings: settingsWith({ picker: { weights: { mastery: 0, meta: 1, counter: 0, comp: 0 } } }),
    });
    assert.equal(onlyMeta.candidates[0].id, 'Caitlyn');
    assert.ok(onlyMeta.candidates[0].reasons.includes('Tier S'));

    const onlyCounter = recommendPicks({
      champSelect: { ...base, enemies }, profile, dd, meta,
      settings: settingsWith({ picker: { weights: { mastery: 0, meta: 0, counter: 1, comp: 0 } } }),
    });
    assert.equal(onlyCounter.candidates[0].id, 'Caitlyn');
    assert.ok(onlyCounter.candidates[0].reasons.includes('Bom contra Ashe'));
    const jinx = onlyCounter.candidates.find((c) => c.id === 'Jinx');
    assert.ok(jinx.reasons.includes('Sofre contra Ashe'));
    assert.ok(onlyCounter.signalsUsed.includes('counter'));

    const onlyMastery = recommendPicks({
      champSelect: { ...base, enemies }, profile, dd, meta,
      settings: settingsWith({ picker: { weights: { mastery: 1, meta: 0, counter: 0, comp: 0 } } }),
    });
    assert.equal(onlyMastery.candidates[0].id, 'Jinx');
  });
});

test('picker: sem perfil e sem dados ainda devolve algo e avisa', async () => {
  const dd = await makeDd();
  const r = recommendPicks({ champSelect: state(dd), profile: null, dd, settings: settingsWith({}), meta: EMPTY_META });
  assert.ok(r.notes.some((n) => n.includes('Carregando')));
  assert.ok(Array.isArray(r.candidates));

  const none = recommendPicks({ champSelect: state(dd), profile: null, dd: null, settings: settingsWith({}), meta: EMPTY_META });
  assert.deepEqual(none.candidates, []);
  const spec = recommendPicks({ champSelect: state(dd, { spectating: true }), profile: null, dd, settings: settingsWith({}), meta: EMPTY_META });
  assert.deepEqual(spec.candidates, []);
});

test('settings: valida, limita e persiste', async () => {
  const s = sanitize(
    {
      region: 'BR1',
      picker: { weights: { mastery: 150, meta: -5, counter: 'x', hack: 1 }, blacklist: ['  Yasuo ', ''], maxResults: 99, poolBonus: 9 },
      __proto__x: 1,
    },
    DEFAULTS,
  );
  assert.equal(s.region, 'br');
  assert.equal(s.picker.weights.mastery, 1);
  assert.equal(s.picker.weights.meta, 0);
  assert.equal(s.picker.weights.counter, DEFAULTS.picker.weights.counter);
  assert.equal('hack' in s.picker.weights, false);
  assert.deepEqual(s.picker.blacklist, ['Yasuo']);
  assert.equal(s.picker.maxResults, 10);
  assert.equal(s.picker.poolBonus, 0.5);
  assert.equal(sanitize({ region: 'zz' }, DEFAULTS).region, 'auto');

  const file = path.join(await tmpDir(), 'settings.json');
  const store = createSettingsStore(file);
  store.update({ picker: { pool: { bottom: ['Jinx', "Kai'Sa"] } } });
  assert.deepEqual(createSettingsStore(file).get().picker.pool.bottom, ['Jinx', "Kai'Sa"]);
});

test('meta: normaliza nomes, ignora comentários e mescla arquivos', async () => {
  const m = normalizeMeta({
    _help: 'texto',
    tiers: { _x: {}, bottom: { "Kai'Sa": 'A', MissFortune: 0.7 } },
    counters: { _c: {}, Ahri: { Zed: 5, 'Miss Fortune': -2, Lux: 'x' } },
  });
  assert.equal(m.tiers.bottom.kaisa, 'A');
  assert.equal(m.tiers._x, undefined);
  assert.equal(m.counters.ahri.zed, 1); // limitado a [-1, 1]
  assert.equal(m.counters.ahri.missfortune, -1);
  assert.equal(m.counters.ahri.lux, undefined);

  const dir = await tmpDir();
  await fs.writeFile(path.join(dir, 'a.json'), JSON.stringify({ tiers: { bottom: { Jinx: 'B' } } }));
  await fs.writeFile(path.join(dir, 'b.json'), JSON.stringify({ tiers: { bottom: { Jinx: 'S' } } }));
  const merged = loadMeta([path.join(dir, 'a.json'), path.join(dir, 'nao-existe.json'), path.join(dir, 'b.json')]);
  assert.equal(merged.tiers.bottom.jinx, 'S');
});

test('router: partida > champ select > aguardando', () => {
  const live = { phase: 'ingame' };
  const cs = { phase: 'champselect' };
  assert.equal(pickState(live, cs), live);
  assert.equal(pickState({ phase: 'waiting' }, cs), cs);
  assert.deepEqual(pickState({ phase: 'waiting' }, { phase: 'idle', client: 'open' }), { phase: 'waiting', client: 'open' });
  assert.deepEqual(pickState({ phase: 'waiting' }, { phase: 'idle' }), { phase: 'waiting', client: 'closed' });
});

test('engine LCU: champ select completo com sugestões e link do OP.GG', async () => {
  const dd = await makeDd();
  await withLcu({ isActive: () => true }, async (creds) => {
    const states = [];
    const engine = createLcuEngine({
      credsProvider: async () => creds,
      getDd: () => dd,
      getSettings: () => DEFAULTS,
      getMeta: () => EMPTY_META,
      onState: (s) => states.push(s),
    });

    let last;
    for (let i = 0; i < 40; i++) {
      await engine.tick();
      last = states.at(-1);
      if (last.advice && !last.advice.profileLoading) break;
      await new Promise((r) => setTimeout(r, 75));
    }

    assert.equal(last.phase, 'champselect');
    assert.equal(last.advice.profileLoading, false);
    assert.equal(last.myPosition, 'bottom');
    assert.equal(last.advice.picks.candidates[0].id, 'Jinx');

    // nomes: os que o cliente mostra aparecem; os inimigos continuam ocultos
    assert.equal(last.allies.find((p) => p.position === 'jungle').gameName, 'AliadoJg');
    assert.ok(last.enemies.every((e) => e.nameHidden));
    assert.equal(last.opgg.region, 'br');
    assert.equal(last.opgg.enemies, null);
    const summoners = decodeURIComponent(last.opgg.allies.split('summoners=')[1]).split(',');
    assert.deepEqual(summoners.sort(), ['AliadoJg#BR1', 'AliadoMid#BR1', 'AliadoSup#BR1', 'AliadoTop#BR1', 'Gabriel#BR1']);
  });
});

test('engine LCU: sem champ select, cliente fechado e token inválido', async () => {
  await withLcu({ isActive: () => false }, async (creds) => {
    const states = [];
    const engine = createLcuEngine({ credsProvider: async () => creds, getDd: () => null, getSettings: () => DEFAULTS, getMeta: () => EMPTY_META, onState: (s) => states.push(s) });
    await engine.tick();
    assert.deepEqual({ ...states.at(-1), home: undefined }, { phase: 'idle', client: 'open', home: undefined });

    const bad = createLcuEngine({ credsProvider: async () => ({ ...creds, token: 'errado' }), getDd: () => null, getSettings: () => DEFAULTS, getMeta: () => EMPTY_META, onState: (s) => states.push(s) });
    await bad.tick();
    assert.equal(states.at(-1).phase, 'error');
  });

  const states = [];
  const closed = createLcuEngine({ credsProvider: async () => ({ port: 1, token: 'x', protocol: 'http' }), getDd: () => null, getSettings: () => DEFAULTS, getMeta: () => EMPTY_META, onState: (s) => states.push(s) });
  await closed.tick();
  assert.deepEqual(states.at(-1), { phase: 'idle', client: 'closed' });

  const none = createLcuEngine({ credsProvider: async () => null, getDd: () => null, getSettings: () => DEFAULTS, getMeta: () => EMPTY_META, onState: (s) => states.push(s) });
  await none.tick();
  assert.deepEqual(states.at(-1), { phase: 'idle', client: 'closed' });
});
