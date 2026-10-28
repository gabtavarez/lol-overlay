// Lista os textos de interface (em português) que precisam de tradução nos dicionários renderer/locales/*.js.
// Uso: node scripts/i18n-extract.js  -> JSON com os textos. Os testes usam a mesma função.
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', 'renderer', f), 'utf8');

const isText = (s) => /[A-Za-zÀ-ú]/.test(s) && (/\s/.test(s) || /[À-ú]/.test(s) || /^[A-ZÀ-Ú]/.test(s))
  && !/^(https?:|#|\.|\/|[a-z]+:[a-z-]+$)/.test(s) && !/^[a-z0-9_-]+$/i.test(s.replace(/\s/g, '') ) || /^[A-ZÀ-Ú][a-zà-ú]+$/.test(s);

function fromHtml(file) {
  const src = R(file).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '');
  const out = new Set();
  for (const m of src.matchAll(/>([^<>]+)</g)) { const s = m[1].trim(); if (s && /[A-Za-zÀ-ú]/.test(s)) out.add(s); }
  for (const m of src.matchAll(/\s(?:placeholder|title|aria-label)="([^"]+)"/g)) if (/[A-Za-zÀ-ú]/.test(m[1])) out.add(m[1]);
  return out;
}

// Literais passados para a tela: text:, title:, placeholder:, label/desc de listas, t('...'), textContent = '...'
function fromJs(file) {
  const src = R(file);
  const out = new Set();
  const lit = /'((?:[^'\\\n]|\\.)*)'/g;
  for (const line of src.split('\n')) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    if (!/(text:|title:|placeholder:|textContent|\bt\(|label|\[\s*'[a-z]+',\s*'|: '|\? '|ROLE_LABEL|const [A-Z_]+ = )/.test(line)) continue;
    for (const m of line.matchAll(lit)) {
      const s = m[1].replace(/\\'/g, "'");
      if (s.length > 1 && isText(s) && !/\$\{|[<>=]|\(\)|=>/.test(s.replace(/\{\w+\}/g, '')) && !/^[a-z]+(-[a-z]+)+$/.test(s) && !/^\s*,|\}\)|, h\(/.test(s)) out.add(s); // pedaços entre duas strings não são texto
    }
  }
  return out;
}

function extract() {
  const all = new Set([...fromHtml('index.html'), ...fromJs('renderer.js'), ...fromJs('common.js')]);
  return [...all].sort();
}
module.exports = { extract };
if (require.main === module) process.stdout.write(`${JSON.stringify(extract(), null, 1)}\n`);
