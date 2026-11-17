const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// As janelas carregam vários <script> no mesmo escopo global: um nome declarado duas vezes derruba a tela inteira.
for (const page of ['index.html', 'overlay.html']) {
  test(`renderer ${page}: scripts compilam juntos sem nome repetido`, () => {
    const dir = path.join(__dirname, '..', 'renderer');
    const html = fs.readFileSync(path.join(dir, page), 'utf8');
    const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s));
    assert.ok(srcs.length > 0);
    const code = srcs.map((s) => fs.readFileSync(path.join(dir, s), 'utf8')).join('\n;\n');
    assert.doesNotThrow(() => new vm.Script(code, { filename: page }));
  });
}
