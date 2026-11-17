const test = require('node:test');
const assert = require('node:assert');
const { situationalComponent } = require('../src/buys');

// receita fictícia: Item final (3000) = Varinha (850, dano) + Capa (900, RM) + Cristal (400, vida)
const items = {
  1: { name: 'Item final', gold: { total: 3000, base: 850 }, from: [10, 11, 12], stats: {} },
  10: { name: 'Varinha', gold: { total: 850 }, stats: { FlatMagicDamageMod: 40 } },
  11: { name: 'Capa', gold: { total: 900 }, stats: { FlatSpellBlockMod: 25 } },
  12: { name: 'Cristal', gold: { total: 400 }, stats: { FlatHPPoolMod: 150 } },
};
const dd = { item: (id) => items[id] || null };

test('componente pela situação: perdendo para AP compra a peça com RM', () => {
  const c = situationalComponent(dd, 1, [], 1000, 'mr');
  assert.equal(c.name, 'Capa');
  assert.equal(c.fits, true);
});

test('componente pela situação: ganhando compra a peça de dano', () => {
  const c = situationalComponent(dd, 1, [], 1000, 'dmg');
  assert.equal(c.name, 'Varinha');
});

test('componente pela situação: sem peça que combine, o mais caro que cabe', () => {
  const c = situationalComponent(dd, 1, [11], 1000, 'mr');
  assert.equal(c.fits, false);
  assert.equal(c.name, 'Varinha');
});

test('componente pela situação: ouro curto pega o que cabe', () => {
  const c = situationalComponent(dd, 1, [], 500, 'hp');
  assert.equal(c.name, 'Cristal');
});

const { reviewMatch } = require('../src/matchReview');
test('pós-partida: aponta falta de anticura, de RM e de botas', () => {
  const p = (id, team, extra = {}) => ({ champion: id, id, team, position: '', items: [], stats: { kills: 1, deaths: 1, assists: 1, cs: 100, damage: 10000, gold: 8000, wards: 5, controlWards: 1 }, ...extra });
  const detail = {
    duration: 1800,
    teams: [
      { key: 'A', kills: 20, dragons: 1, barons: 0, towers: 3, players: [p('Ahri', 'A', { target: true, position: 'MID', items: [3089] })] },
      { key: 'B', kills: 20, dragons: 1, barons: 0, towers: 3, players: [p('Soraka', 'B'), p('Lux', 'B'), p('Veigar', 'B'), p('Syndra', 'B')] },
    ],
  };
  const stats = { 3089: { FlatMagicDamageMod: 120 } };
  const r = reviewMatch(detail, { checks: { isHealer: (id) => id === 'Soraka', apShare: () => 1, antiHeal: new Set([3165]), stat: (id) => stats[id], isBoots: () => false } });
  const titles = r.bad.map((b) => b.title);
  assert.ok(titles.includes('Faltou anticura'));
  assert.ok(titles.includes('Sem resistência mágica'));
  assert.ok(titles.includes('Terminou sem botas'));
});
