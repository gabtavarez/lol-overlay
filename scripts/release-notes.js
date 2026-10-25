// Notas do release (GitHub) a partir de data/changelog.json para a versão do package.json.
const { version } = require('../package.json');
const log = require('../data/changelog.json');

const e = log.find((x) => x.version === version);
const lines = [`## LoL Overlay v${version}`];
if (e) {
  lines.push('', `**${e.title}**`, '', ...e.items.map((i) => `- ${i}`));
}
lines.push('', 'Baixe o `LoL-Overlay-Setup` abaixo. Quem já tem o app recebe a atualização automaticamente.');
process.stdout.write(`${lines.join('\n')}\n`);
