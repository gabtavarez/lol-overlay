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
  assert.equal(verifyLicense(good.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), pub), null); // assinatura adulterada
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
