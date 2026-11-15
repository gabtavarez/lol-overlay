const test = require('node:test');
const assert = require('node:assert/strict');
const { scrub, createErrorReporter } = require('../src/errorReport');

test('relatório de erro: tira caminho do usuário, e-mail, chave do Pro e Riot ID', () => {
  const out = scrub('falhou em C:\\Users\\Gabriel\\AppData\\x.js para joao@mail.com com LOP-ABCDE-FGHIJ-KLMNO e Tavarez#BR1');
  assert.ok(!/Gabriel|joao@|LOP-ABCDE|Tavarez#BR1/.test(out), out);
});

test('relatório de erro: não envia nada desligado e não repete o mesmo erro', () => {
  const calls = [];
  const fetchImpl = (url, opts) => { calls.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true }); };
  let on = false;
  const r = createErrorReporter({ fetchImpl, server: 'https://x', version: '1.0.0', platform: 'win32', isEnabled: () => on });
  assert.equal(r.report('main', new Error('boom')), false);
  on = true;
  assert.equal(r.report('main', new Error('boom')), true);
  assert.equal(r.report('main', new Error('boom')), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message, 'boom');
});
