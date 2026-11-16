const test = require('node:test');
const assert = require('node:assert');
const { modeFrom, readWindowMode, setBorderless } = require('../src/windowMode');

test('modeFrom: lê o WindowMode das configurações do jogo', () => {
  assert.strictEqual(modeFrom({ General: { WindowMode: 0 } }), 'fullscreen');
  assert.strictEqual(modeFrom({ General: { WindowMode: 1 } }), 'windowed');
  assert.strictEqual(modeFrom({ General: { WindowMode: 2 } }), 'borderless');
  assert.strictEqual(modeFrom({ General: {} }), null);
  assert.strictEqual(modeFrom(null), null);
});

test('readWindowMode: sem cliente devolve null', async () => {
  assert.strictEqual(await readWindowMode(null), null);
  assert.strictEqual(await readWindowMode({ port: 1 }, { get: async () => ({ General: { WindowMode: 0 } }) }), 'fullscreen');
});

test('setBorderless: manda PATCH com WindowMode 2 e confere', async () => {
  let cfg = { General: { WindowMode: 0 } };
  const calls = [];
  const request = async (_c, p, o) => {
    calls.push([p, o.method]);
    if (o.method === 'PATCH') cfg = { General: { ...cfg.General, ...o.json.General } };
    return { status: 204 };
  };
  const get = async () => cfg;
  assert.strictEqual(await setBorderless({ port: 1 }, { request, get }), 'borderless');
  assert.deepStrictEqual(calls[0], ['/lol-game-settings/v1/game-settings', 'PATCH']);
});

test('setBorderless: falha se o cliente não guardou', async () => {
  const request = async () => ({ status: 204 });
  const get = async () => ({ General: { WindowMode: 0 } });
  await assert.rejects(setBorderless({ port: 1 }, { request, get }), /não guardou/);
});
