const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { tiltReport, byHour } = require('../src/tilt');
const { modeRole } = require('../src/champSelect');
const { createRemoteData } = require('../src/providers/remote');
const { targetsFor, liveGoals } = require('../src/goals');

const H = 3600 * 1000;
const NOW = Date.UTC(2026, 9, 27, 22, 0); // 19h em UTC-3
const game = (hAgo, win, champ = 103) => ({ at: NOW - hAgo * H, duration: 1800, win, championId: champ, remake: false });

test('tilt: 2 derrotas seguidas na sessão = pausa, com campeão de conforto', () => {
  const games = [game(0.6, false, 238), game(1.2, false, 238), game(1.8, true), game(30, true), game(31, true), game(32, true)];
  const t = tiltReport(games, { now: NOW, tzOffsetMin: 180 });
  assert.equal(t.status, 'pause');
  assert.deepEqual(t.streak, { type: 'loss', count: 2 });
  assert.equal(t.session.games, 3);
  assert.equal(t.comfort.championId, 103);
});

test('tilt: 3 derrotas = parar; derrotas de ontem não contam como sessão', () => {
  assert.equal(tiltReport([game(0.6, false), game(1.2, false), game(1.8, false)], { now: NOW, tzOffsetMin: 180 }).status, 'stop');
  assert.equal(tiltReport([game(20, false), game(21, false), game(22, false)], { now: NOW, tzOffsetMin: 180 }).status, 'ok');
});

test('tilt: vitórias seguidas e remakes ignorados', () => {
  const games = [{ ...game(0.3, false), remake: true }, game(0.6, true), game(1.2, true), game(1.8, true)];
  const t = tiltReport(games, { now: NOW, tzOffsetMin: 180 });
  assert.equal(t.status, 'hot');
  assert.equal(t.recent.length, 3);
});

test('tilt: % de vitória por horário (hora local)', () => {
  const rows = byHour([game(0, true), game(24, false)], 180); // 19h local
  const noite = rows.find((r) => r.key === 'noite');
  assert.equal(noite.games, 2);
  assert.equal(noite.winRate, 0.5);
});

test('modo: fila/gameMode viram aram/arena; metas de farm somem no modo', () => {
  assert.equal(modeRole({ queueId: 450 }), 'aram');
  assert.equal(modeRole({ gameMode: 'CHERRY' }), 'arena');
  assert.equal(modeRole({ queueId: 420 }), null);
  assert.equal(targetsFor('GOLD', 'aram').cs, null);
  assert.equal(liveGoals({ phase: 'ingame', gameTime: 600, me: { scores: { cs: 50 } } }, 'GOLD', 'aram'), null);
});

test('builds: ARAM pede game_mode aram; Arena usa a ranqueada com aviso', async () => {
  const calls = [];
  const client = { analysis: async (champ, role) => { calls.push(role); return { core: [1], later: [], fromRole: undefined }; } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-'));
  const remote = createRemoteData({ cacheDir: dir, isEnabled: () => true, client });
  await remote.ensureBuild({ id: 'Ahri', tags: ['Mage'] }, 'aram');
  await remote.ensureBuild({ id: 'Ahri', tags: ['Mage'] }, 'arena');
  assert.deepEqual(calls, ['aram', 'middle']);
  assert.equal(remote.getBuild({ id: 'Ahri' }, 'arena').modeFallback, 'arena');
  assert.equal(remote.getBuild({ id: 'Ahri' }, 'arena').fromRole, 'middle');
});

test('perfil: página repetida do cliente não duplica partidas (sequência falsa)', () => {
  const { aggregateHistory } = require('../src/profile');
  const g = (id, win, at) => ({ gameId: id, gameCreation: at, gameDuration: 1800, mapId: 11, queueId: 420, participants: [{ championId: 245, stats: { win }, timeline: { lane: 'MIDDLE', role: 'SOLO' } }] });
  const page = { games: { games: [g(3, true, 300), g(2, true, 200), g(1, false, 100)] } };
  const out = aggregateHistory([page, page, page, page]);
  assert.equal(out.games.length, 3);
  assert.equal(out.analyzed, 3);
  assert.deepEqual(tiltReport(out.games, { now: 400, tzOffsetMin: 180 }).streak, { type: 'win', count: 2 });
});

test('novidades: curtas (até 4 itens de até 90 caracteres, título curto)', () => {
  const log = require('../data/changelog.json');
  for (const e of log) {
    assert.ok(e.title.length <= 40, `título longo em ${e.version}`);
    assert.ok(e.items.length >= 1 && e.items.length <= 4, `itens demais em ${e.version}`);
    for (const i of e.items) assert.ok(i.length <= 90, `item longo em ${e.version}: ${i}`);
    for (const l of ['en', 'es']) { // tradução de cada versão, com os mesmos itens
      assert.ok(e[l] && e[l].title && e[l].items.length === e.items.length, `${l} faltando em ${e.version}`);
      for (const i of e[l].items) assert.ok(i.length <= 100, `item ${l} longo em ${e.version}: ${i}`);
    }
  }
  assert.equal(log[0].version, require('../package.json').version); // toda versão nova tem novidade
});

test('composição de dano: % AD/AP/verdadeiro por time e aviso de time quase só AD', () => {
  const { damageComp } = require('../src/damageComp');
  const c = (id, tags) => ({ champion: { id, tags } });
  const out = damageComp({ me: c('Ahri', ['Mage']), allies: [], enemies: [c('Vayne', ['Marksman']), c('Zed', ['Assassin']), c('Darius', ['Fighter']), c('Jinx', ['Marksman'])] });
  assert.equal(out.allies.ap, 100);
  assert.equal(out.enemies.ad + out.enemies.ap + out.enemies.true, 100);
  assert.ok(out.enemies.true > 0);
  assert.ok(out.notes.some((n) => /AD/.test(n)));
  assert.equal(damageComp({ me: { champion: null }, allies: [], enemies: [] }), null);
});

test('plano: desligado libera tudo; ligado exige licença assinada e válida', () => {
  const crypto = require('crypto');
  const { createPlan, verifyLicense } = require('../src/plan');
  assert.equal(createPlan({ paywall: false }).can('laneCoach'), true);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const sign = (p) => { const body = Buffer.from(JSON.stringify(p)).toString('base64url'); return `${body}.${crypto.sign(null, Buffer.from(body), privateKey).toString('base64url')}`; };
  const good = sign({ email: 'a@b.c', plan: 'pro', exp: Date.now() + 86400e3 });
  assert.equal(verifyLicense(good, pub).plan, 'pro');
  const [b, sg] = good.split('.');
  const bad = Buffer.from(sg, 'base64url'); bad[10] ^= 0xff; // muda um byte de verdade (o último caractere base64 pode ser só preenchimento)
  assert.equal(verifyLicense(`${b}.${bad.toString('base64url')}`, pub), null); // assinatura adulterada
  assert.equal(verifyLicense(sign({ plan: 'pro', exp: Date.now() - 10 * 86400e3 }), pub), null); // vencida
  const off = createPlan({ paywall: true, publicKey: pub, getLicense: () => '' });
  assert.equal(off.can('laneCoach'), false);
  assert.equal(off.can('picks'), true);
  assert.equal(createPlan({ paywall: true, publicKey: pub, getLicense: () => good }).can('laneCoach'), true);
});

test('desempenho: cache do OP.GG grava em lote (assíncrono) e descarta entradas velhas', async () => {
  const client = { analysis: async () => ({ core: [1], later: [] }) };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-'));
  const file = path.join(dir, 'opgg-cache.json');
  const old = { builds: { 'velho:middle': { at: Date.now() - 30 * 86400e3, data: { core: [] } } } };
  fs.writeFileSync(file, JSON.stringify(old));
  const remote = createRemoteData({ cacheDir: dir, isEnabled: () => true, client });
  await remote.ensureBuild({ id: 'Ahri', tags: ['Mage'] }, 'middle');
  await remote.ensureBuild({ id: 'Lux', tags: ['Mage'] }, 'middle');
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).builds['velho:middle']); // ainda não gravou (agrupado)
  remote.flushSync();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.builds['velho:middle'], undefined);
  assert.equal(Object.keys(saved.builds).length, 2);
});

test('build: itens do guia trazem o custo em ouro (caminho de compras)', () => {
  const { buildGuide } = require('../src/guide');
  const dd = { item: (id) => ({ name: `I${id}`, gold: { total: id === 3020 ? 1100 : 3000 } }) };
  const g = buildGuide({ champ: { id: 'Ahri', name: 'Ahri' }, role: 'middle', dd, build: { starter: [1056], boots: [3020], core: [6655], later: [], spells: [], skills: [], runes: null } });
  assert.equal(g.fullBuild.find((x) => x.id === 3020).gold, 1100);
  assert.equal(g.fullBuild.find((x) => x.id === 6655).gold, 3000);
});

test('missão do atirador: bota no 7º espaço (fora da Live API) não gera sugestão de outra bota', () => {
  const { buyAdvice, createBootMemory } = require('../src/buys');
  const flags = require('../data/champion-flags.json');
  const I = { 3006: { name: 'Grevas do Berserker', tags: ['Boots'], gold: { total: 1100 } }, 3047: { name: 'Botas Galvanizadas de Aço', tags: ['Boots', 'Armor'], gold: { total: 1200 } },
    6672: { name: 'Matador de Krakens', tags: [], gold: { total: 3000 } }, 3031: { name: 'Gume do Infinito', tags: [], gold: { total: 3450 } }, 1001: { name: 'Botas', tags: ['Boots'], gold: { total: 300 } } };
  const dd = { item: (id) => I[id] || null };
  const E = (c) => ({ champion: c, championId: c, tags: ['Marksman'], level: 10, position: 'BOTTOM', scores: { kills: 3, deaths: 1, assists: 0 }, items: [] });
  const me = { champion: 'Jhin', championId: 'Jhin', tags: ['Marksman'], level: 10, gold: 1500, position: 'BOTTOM', scores: { kills: 3, deaths: 1, assists: 2 },
    items: [{ id: 6672, slot: 0 }, { id: 3006, slot: 1 }, { id: 3340, slot: 6 }] };
  const mem = createBootMemory();
  mem.apply(me, dd); // viu a bota
  me.items = [{ id: 6672, slot: 0 }, { id: 3340, slot: 6 }]; // missão completa: a bota some da Live API
  mem.apply(me, dd);
  assert.ok(me.items.some((i) => i.id === 3006 && i.questSlot));
  const adv = buyAdvice({ dd, flags, build: { damageType: 'AD', core: [6672, 3031], boots: [3006] }, state: { gameTime: 900, myRole: 'bottom', me, enemies: [E('Jhin'), E('Kaisa')] } });
  assert.ok(!adv.items.some((i) => I[i.id] && I[i.id].tags.includes('Boots')), adv.items.map((i) => i.name).join());
  // ID novo/desconhecido com nome de bota também conta
  const me2 = { items: [{ id: 999006, name: 'Grevas do Berserker', slot: 7 }] };
  createBootMemory().apply(me2, dd);
  assert.ok(me2.items[0].boots);
});
