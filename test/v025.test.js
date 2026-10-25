const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { blindSafety, applyBlind } = require('../src/blind');
const { diffChampion, verdict } = require('../src/patchDiff');
const { activityFor, createDiscordRpc, frame, rankText } = require('../src/discord');

test('pick às cegas: seguro, arriscado e reordenação', () => {
  const safe = { weakCounters: [{ name: 'A', oppWinRate: 0.52, games: 900 }, { name: 'B', oppWinRate: 0.51, games: 500 }] };
  const risky = { weakCounters: [{ name: 'A', oppWinRate: 0.57, games: 900 }, { name: 'B', oppWinRate: 0.55, games: 500 }, { name: 'C', oppWinRate: 0.55, games: 300 }] };
  assert.equal(blindSafety(safe).level, 'safe');
  assert.equal(blindSafety(risky).level, 'risky');
  assert.equal(blindSafety({ weakCounters: [] }), null);
  const out = applyBlind([{ id: 'R', score: 70 }, { id: 'S', score: 68 }, { id: 'X', score: 60 }], (c) => (c.id === 'R' ? risky : c.id === 'S' ? safe : null));
  assert.deepEqual(out.map((c) => c.id), ['S', 'R', 'X']);
  assert.equal(out.find((c) => c.id === 'X').blind, undefined);
});

test('patch: diferença de recarga e atributos vira buff/nerf', () => {
  const prev = { stats: { hp: 600, armor: 30 }, spells: [{ name: 'Q', cooldown: [7, 7, 7, 7, 7], cost: [50], range: [800] }] };
  const cur = { stats: { hp: 620, armor: 30 }, spells: [{ name: 'Q', cooldown: [6, 6, 6, 6, 6], cost: [50], range: [800] }] };
  const ch = diffChampion(prev, cur);
  assert.equal(ch.length, 2);
  assert.ok(ch.every((c) => c.buff === true));
  assert.equal(verdict(ch), 'buff');
  assert.equal(verdict(diffChampion(cur, prev)), 'nerf');
  assert.deepEqual(diffChampion(cur, cur), []);
});

test('discord: atividade por fase e frame do IPC', () => {
  assert.equal(rankText({ tier: 'EMERALD', division: 'II', lp: 34 }), 'Esmeralda II · 34 PDL');
  const g = activityFor({ live: { phase: 'ingame', me: { champion: 'Ahri', championId: 'Ahri', position: 'MIDDLE', scores: { kills: 3, deaths: 1, assists: 4, cs: 120 } } }, version: '16.21.1', gameStart: 1000 });
  assert.equal(g.details, 'Ahri · Meio');
  assert.equal(g.state, '3/1/4 · 120 CS');
  assert.match(g.assets.large_image, /champion\/Ahri\.png$/);
  const cs = activityFor({ lcu: { phase: 'champselect', myPosition: 'middle', me: { champion: { id: 'Zed', name: 'Zed' }, locked: true } } });
  assert.equal(cs.state, 'Travou Zed');
  assert.equal(activityFor({ lcu: { phase: 'idle', client: 'closed' } }), null);
  const f = frame(1, { a: 1 });
  assert.equal(f.readInt32LE(0), 1);
  assert.equal(f.readInt32LE(4), f.length - 8);
});

test('discord: handshake, READY e SET_ACTIVITY pelo pipe', async () => {
  const writes = [];
  const sock = new EventEmitter();
  sock.write = (b) => writes.push(b);
  sock.destroy = () => {};
  const rpc = createDiscordRpc({ connectImpl: () => { setImmediate(() => sock.emit('connect')); return sock; }, platform: 'win32' });
  rpc.configure(true, '123456789012345678');
  rpc.set({ details: 'x' });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(JSON.parse(writes[0].slice(8)).client_id, '123456789012345678');
  sock.emit('data', frame(1, { evt: 'READY', cmd: 'DISPATCH' }));
  assert.equal(rpc.status(), 'connected');
  const act = JSON.parse(writes[1].slice(8));
  assert.equal(act.cmd, 'SET_ACTIVITY');
  assert.equal(act.args.activity.details, 'x');
  rpc.stop();
});
