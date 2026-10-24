const test = require('node:test');
const assert = require('node:assert');
const { runeTree, fullBuild } = require('../src/guide');

const styles = [8000, 8100, 8200, 8300, 8400].map((id) => ({
  id, name: `S${id}`, icon: `s${id}.png`,
  slots: [0, 1, 2, 3].map((k) => ({ runes: [1, 2, 3].map((n) => ({ id: id + k * 10 + n, name: `r${id + k * 10 + n}`, icon: 'x.png' })) })),
}));

test('runeTree marca todas as opções e só as escolhidas como selecionadas', () => {
  const t = runeTree(styles, { primaryStyleId: 8100, subStyleId: 8300, perks: [8101, 8112, 8123, 8133, 8312, 8321, 5008, 5010, 5011] });
  assert.equal(t.primaryStyles.length, 5);
  assert.equal(t.secondaryStyles.length, 4);
  assert.equal(t.primary.length, 4);
  assert.equal(t.secondary.length, 3);
  assert.equal(t.primary.flat().filter((r) => r.selected).length, 4);
  assert.equal(t.secondary.flat().filter((r) => r.selected).length, 2);
  assert.deepEqual(t.shards.map((row) => row.findIndex((s) => s.selected)), [0, 1, 0]);
});

test('fullBuild: core, botas, fechamento; 6 itens sem repetir', () => {
  const b = fullBuild({ core: [1, 2, 3], boots: [9], fourth_items: [], fifth_items: [], sixth_items: [], later: [] });
  assert.deepEqual(b.slice(0, 4), [1, 9, 2, 3]);
  assert.equal(new Set(b).size, b.length);
});
