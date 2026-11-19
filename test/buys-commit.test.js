const test = require('node:test');
const assert = require('node:assert');
const { createCommitMemory } = require('../src/buys');

// 1 = item do meta (Espada 10 + Capa 11), 2 = item reativo (Capa 11 + Cristal 12)
const items = {
  1: { name: 'Meta', gold: { total: 3000, base: 900 }, from: [10, 11] },
  2: { name: 'Reativo', gold: { total: 2800, base: 900 }, from: [11, 12] },
  10: { name: 'Espada', gold: { total: 1000 }, into: [1] },
  11: { name: 'Capa', gold: { total: 900 }, into: [1, 2] },
  12: { name: 'Cristal', gold: { total: 400 }, into: [2] },
};
const dd = { item: (id) => items[id] || null };
const row = (id, score, tag) => ({ id, name: items[id].name, score, tag, reason: tag === 'core' ? 'Build do meta' : 'Contra o fed', vs: [], parts: [], swap: null });
const run = (m, list, owned) => m.apply(list, { dd, owned, ownedSet: new Set(owned) });

test('compromisso: comprou peça do item sugerido, ele fica em 1º até fechar', () => {
  const m = createCommitMemory();
  assert.equal(run(m, [row(2, 80, 'mr'), row(1, 70, 'core')], [])[0].id, 2);
  // comprou a Capa (serve aos dois): vale o que estava em 1º, o reativo
  const after = run(m, [row(1, 85, 'core'), row(2, 60, 'mr')], [11]);
  assert.equal(after[0].id, 2);
  assert.equal(after[0].committed, true);
  assert.ok(after[0].score >= 85);
  assert.match(after[0].reason, /termine antes de trocar/);
  // a regra reativa sumiu da lista: o item começado continua lá
  assert.equal(run(m, [row(1, 90, 'core')], [11])[0].id, 2);
  // fechou o item: volta ao normal
  assert.equal(run(m, [row(1, 90, 'core')], [2])[0].id, 1);
});

test('compromisso: vendeu a peça, solta o item', () => {
  const m = createCommitMemory();
  run(m, [row(2, 80, 'mr'), row(1, 70, 'core')], []);
  run(m, [row(1, 85, 'core'), row(2, 60, 'mr')], [12]);
  assert.equal(run(m, [row(1, 85, 'core'), row(2, 60, 'mr')], [])[0].id, 1);
});

test('sem compra: o 1º lugar só troca com folga de pontos', () => {
  const m = createCommitMemory();
  run(m, [row(2, 80, 'mr'), row(1, 70, 'core')], []);
  assert.equal(run(m, [row(1, 84, 'core'), row(2, 80, 'mr')], [])[0].id, 2); // +4: segura
  assert.equal(run(m, [row(1, 95, 'core'), row(2, 80, 'mr')], [])[0].id, 1); // +15: troca
});
