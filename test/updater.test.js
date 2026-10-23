const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createUpdater } = require('../src/updater');

function fake() {
  const au = new EventEmitter();
  au.checkForUpdates = async () => { au.emit('checking-for-update'); };
  au.quitAndInstall = () => { au.installed = true; };
  return au;
}

test('updater: fluxo disponível -> baixando -> pronto -> instala', () => {
  const au = fake();
  const seen = [];
  const u = createUpdater({ autoUpdater: au, send: (s) => seen.push(s.state) });
  au.emit('update-available', { version: '0.8.0' });
  au.emit('download-progress', { percent: 42.4 });
  assert.equal(u.get().percent, 42);
  u.install();
  assert.ok(!au.installed, 'não instala antes de baixar');
  au.emit('update-downloaded', { version: '0.8.0' });
  u.install();
  assert.ok(au.installed);
  assert.deepEqual(seen, ['downloading', 'downloading', 'ready']);
});

test('updater: erro vira mensagem amigável e check automático respeita a configuração', async () => {
  const au = fake();
  const u = createUpdater({ autoUpdater: au, send() {}, isEnabled: () => false });
  await u.check();
  assert.equal(u.get().state, 'idle');
  au.emit('error', new Error('x'));
  assert.equal(u.get().state, 'error');
});
