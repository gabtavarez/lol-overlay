// Lista os textos de interface (em português) que precisam de tradução nos dicionários renderer/locales/*.js.
// Uso: node scripts/i18n-extract.js  -> JSON com os textos. Os testes usam a mesma função.
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', 'renderer', f), 'utf8');


function fromHtml(file) {
  const src = R(file).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '');
  const out = new Set();
  for (const m of src.matchAll(/>([^<>]+)</g)) { const s = m[1].trim(); if (s && /[A-Za-zÀ-ú]/.test(s)) out.add(s); }
  for (const m of src.matchAll(/\s(?:placeholder|title|aria-label)="([^"]+)"/g)) if (/[A-Za-zÀ-ú]/.test(m[1])) out.add(m[1]);
  return out;
}

// Literais de interface: toda string entre aspas simples que parece texto (não classe CSS, id, URL ou chave).
const looksLikeUi = (s) => s.length > 1 && /[A-Za-zÀ-ú]/.test(s)
  && !/^(https?:|#|\.|\/|data:)/.test(s)
  && !/^[a-z0-9_-]+( [a-zA-Z0-9_-]+)*$/.test(s) // classes e ids
  && !/^\\[nt]$/.test(s) // \n sozinho
  && !/^[A-Z0-9_]+$/.test(s) // constantes
  && !/^[a-z]+[A-Z]\w*$/.test(s) && !/^[A-Z][a-z]+[A-Z]\w+$/.test(s) // camelCase / chaves do jogo
  && !/\$\{|=>|[<>=]|\(\)/.test(s.replace(/\{\w+\}/g, ''))
  && !/^\s*,|\}\)|, h\(/.test(s) && !/^[a-z]{2}-[A-Z]{2}$/.test(s)
  && !/^[a-z-]+:[^ ]/.test(s) && !/^ [a-z-]+$/.test(s) && !/^img\//.test(s) && !/^[MLQCZ][\d .,-]+/.test(s) /* caminho SVG */ && !/#[A-Z0-9]{2,5}/.test(s);

function fromJs(file) {
  const src = R(file);
  const out = new Set();
  let sample = false; // dados de exemplo do overlay (nomes de itens/campeões fictícios): não entram
  for (const line of src.split('\n')) {
    if (/^function sampleState/.test(line)) sample = true;
    else if (sample && /^}/.test(line)) { sample = false; continue; }
    if (sample && /name: '|champion: '|'[A-Z][a-z]+', '[A-Z]/.test(line)) continue;
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    const code = line.replace(/\s\/\/ .*$/, ''); // comentário no fim da linha
    for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
      const s = m[1].replace(/\\'/g, "'");
      if (looksLikeUi(s)) out.add(s);
    }
  }
  return out;
}

// Processo principal: tudo que passa por tr('...') + textos de exibição em objetos de dados (label/title/text/…).
function fromSrc() {
  const out = new Set();
  const dir = path.join(__dirname, '..', 'src');
  const files = [...fs.readdirSync(dir).map((f) => path.join(dir, f)), path.join(dir, 'providers', 'remote.js')].filter((f) => f.endsWith('.js'));
  for (const f of files) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      for (const m of line.matchAll(/\btr?\(\s*'((?:[^'\\\n]|\\.)*)'/g)) out.add(m[1].replace(/\\'/g, "'"));
      if (/\btr\(\[/.test(line)) for (const m of line.matchAll(/'([^'\\\n]+)'/g)) if (/\s/.test(m[1])) out.add(m[1]);
      for (const m of line.matchAll(/\btr\(\w+ === '\w+' \? '((?:[^'\\]|\\.)*)' : '((?:[^'\\]|\\.)*)'/g)) { out.add(m[1]); out.add(m[2]); }
      for (const m of line.matchAll(/\btr\([\w.]+ \? '((?:[^'\\]|\\.)*)' : '((?:[^'\\]|\\.)*)'/g)) { out.add(m[1]); out.add(m[2]); }
      // tabelas de rótulos: [id, 'Nome', 'Icone'] e chave: ['Nome', true]
      if (/\[\d+, '|\w+: \['[A-ZÀ-Ú]/.test(line)) for (const m of line.matchAll(/'([A-ZÀ-Ú][a-zà-ú][^'\\\n]*)'/g)) if (!/^[A-Z][a-z]+[A-Z]/.test(m[1])) out.add(m[1]);
      if (/(label|title|who|tip): '|_PT = \{|const [A-Z_]+ = \{|^\s+\w+: '[A-ZÀ-Ú][^']+[.:]'/.test(line)) {
        for (const m of line.matchAll(/(?:label|title|who|tip|\d+|\w+): '((?:[^'\\\n]|\\.)*)'/g)) {
          const v = m[1];
          if (/[a-zà-ú]/.test(v) && /^[A-ZÀ-Úa-zà-ú]/.test(v) && !/^[a-z]+([-_][a-z]+)*$/.test(v) && !/^[A-Z][a-z]+[A-Z]\w+$/.test(v) && !/^[a-z]{2}_[A-Z]{2}$/.test(v)) out.add(v);
        }
      }
    }
  }
  const alerts = require('../data/enemy-alerts.json').items;
  for (const v of Object.values(alerts)) out.add(v);
  return out;
}

function extract() {
  const all = new Set([...fromHtml('index.html'), ...fromHtml('overlay.html'), ...fromJs('renderer.js'), ...fromJs('common.js'), ...fromJs('overlay.js'), ...fromSrc()]);
  return [...all].sort();
}
module.exports = { extract };
if (require.main === module) process.stdout.write(`${JSON.stringify(extract(), null, 1)}\n`);
