const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extract } = require('../scripts/i18n-extract');

function locale(lang) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'locales', `${lang}.js`), 'utf8'), ctx);
  return ctx.window.LOCALES[lang];
}

for (const lang of ['en', 'es']) {
  test(`i18n ${lang}: todo texto da interface tem tradução, com as mesmas variáveis e espaços`, () => {
    const dict = locale(lang);
    const missing = extract().filter((s) => !(s in dict));
    assert.deepEqual(missing, [], `sem tradução em ${lang}: ${missing.join(' | ')}`);
    for (const [k, v] of Object.entries(dict)) {
      assert.ok(typeof v === 'string' && v.trim(), `vazio: ${k}`);
      const vars = (x) => (x.match(/\{\w+\}/g) || []).sort().join();
      assert.equal(vars(v), vars(k), `variáveis diferentes em "${k}"`);
      assert.equal(/^\s/.test(v), /^\s/.test(k), `espaço inicial diferente em "${k}"`);
    }
  });
}

test('i18n: index.html carrega os dicionários antes do app', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const pos = (s) => html.indexOf(s);
  assert.ok(pos('i18n.js') > 0 && pos('i18n.js') < pos('locales/en.js') && pos('locales/es.js') < pos('renderer.js'));
});

test('i18n main: coach, compras e sequência saem no idioma escolhido (e voltam ao português)', () => {
  const i18n = require('../src/i18n');
  const { tiltReport } = require('../src/tilt');
  const g = (h, win) => ({ at: Date.now() - h * 3600e3, duration: 1800, win, championId: 1, remake: false });
  try {
    i18n.setLang('en');
    assert.equal(tiltReport([g(0.5, false), g(1, false)]).title, '2 losses in a row');
    i18n.setLang('es');
    assert.equal(tiltReport([g(0.5, false), g(1, false)]).title, '2 derrotas seguidas');
    assert.equal(i18n.t('{champ} morto por {s} s: sem gank agora.', { champ: 'Lee Sin', s: 9 }), 'Lee Sin muerto por 9 s: sin gank ahora.');
  } finally {
    i18n.setLang('pt');
  }
  assert.equal(tiltReport([g(0.5, false), g(1, false)]).title, '2 derrotas seguidas');
});
