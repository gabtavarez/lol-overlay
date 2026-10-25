const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseNotesHtml, extractFromPage, extractVersions, direction, imgUrl } = require('../src/patchNotes');

const body = fs.readFileSync(path.join(__dirname, 'fixtures', 'patch-notes-body.html'), 'utf8');

test('patch notes: seções, campeões, itens e mudanças antes ⇒ depois', () => {
  const r = parseNotesHtml(body, (n, k) => (k === 'champion' && n === 'Caitlyn' ? { id: 'Caitlyn', kind: 'champion' } : null));
  assert.deepEqual(r.sections.map((s) => s.kind), ['other', 'champions', 'items', 'other', 'bugfixes']);
  const cait = r.sections[1].entities[0];
  assert.equal(cait.id, 'Caitlyn');
  assert.equal(cait.groups.length, 2);
  assert.equal(cait.groups[1].changes[0].dir, 'buff');
  assert.equal(cait.groups[0].changes[0].dir, 'nerf');
  assert.equal(cait.verdict, 'ajuste');
  const items = r.sections[2].entities;
  assert.deepEqual(items.map((e) => e.name), ['Quebra-Bastião', 'Húbris']);
  assert.equal(items[1].verdict, 'nerf'); // custo 1.000 -> 1.100
  assert.equal(r.sections[3].entities[0].name, "Bel'Veth");
  assert.equal(r.sections[4].bullets.length, 2);
  assert.equal(r.sections[0].images.length, 1);
});

test('patch notes: direção, imagens e página Next.js', () => {
  assert.equal(direction('Tempo de Recarga', '10', '8'), 'buff');
  assert.equal(direction('Vida', '150 - 450', '100 - 500 (+ 60% do PdH)'), 'buff');
  assert.equal(direction('Duração', '90s', 'Infinita'), null);
  assert.equal(imgUrl('https://am-a.akamaihd.net/image?f=https://ddragon.leagueoflegends.com/cdn/16.18.1/img/item/6697.png'), 'https://ddragon.leagueoflegends.com/cdn/16.18.1/img/item/6697.png');
  assert.equal(imgUrl('https://evil.example.com/x.png'), null);
  const page = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { page: { blades: [{ type: 'articleMasthead', title: 'Notas da Atualização 26.21', date: '2026-10-20T17:00:00.000Z' }, { type: 'patchNotesRichText', richText: { body } }] } } } })}</script>`;
  const p = extractFromPage(page);
  assert.equal(p.title, 'Notas da Atualização 26.21');
  assert.equal(p.date, '2026-10-20T17:00:00.000Z');
  assert.deepEqual(extractVersions('a/league-of-legends-patch-26-20-notes b/league-of-legends-patch-26-21-notes c/patch-26-9-notes'), ['26.21', '26.20', '26.9']);
});
