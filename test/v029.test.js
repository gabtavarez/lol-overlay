const test = require('node:test');
const assert = require('node:assert/strict');
const { classOf, buyAdvice } = require('../src/buys');
const { tweakForMatchup, describeChanges, maxOrder } = require('../src/matchupTweaks');
const flags = require('../data/champion-flags.json');

test('classe: mago sem build do OP.GG é AP; encantador no suporte é suporte', () => {
  assert.equal(classOf({ championId: 'Ahri', tags: ['Mage', 'Assassin'] }, null, flags, 'middle'), 'ap');
  assert.equal(classOf({ championId: 'Lulu', tags: ['Support', 'Mage'] }, { damageType: 'AP' }, flags, 'utility'), 'support');
  assert.equal(classOf({ championId: 'Lulu', tags: ['Support', 'Mage'] }, null, flags, 'middle'), 'ap');
  assert.equal(classOf({ championId: 'Jinx', tags: ['Marksman'] }, null, flags, 'bottom'), 'adc');
  assert.equal(classOf({ championId: 'Darius', tags: ['Fighter', 'Tank'] }, null, flags, 'top'), 'ad');
});

test('inventário cheio: sugestão diz o que vender; elixir no fim de jogo; suporte recebe Medalhão', () => {
  const I = {
    3190: { name: 'Medalhão', tags: [], gold: { total: 2200 } }, 3222: { name: 'Mikael', tags: [], gold: { total: 2300 } },
    2003: { name: 'Poção de Vida', tags: ['Consumable'], gold: { total: 50 } }, 2138: { name: 'Elixir de Ferro', tags: ['Consumable'], gold: { total: 500 } },
    2055: { name: 'Sentinela de Controle', tags: ['Consumable'], gold: { total: 75 } },
    3504: { name: 'Incensário', gold: { total: 2200 }, tags: [] }, 6616: { name: 'Cajado', gold: { total: 2250 }, tags: [] }, 3158: { name: 'Botas Ionianas', tags: ['Boots'], gold: { total: 900 } },
    6617: { name: 'Renovação', gold: { total: 2200 }, tags: [] }, 3107: { name: 'Redenção', gold: { total: 2300 }, tags: [] },
  };
  const dd = { item: (id) => I[id] || null };
  const E = (champion, tags, k, d) => ({ champion, championId: champion, tags, level: 14, position: '', scores: { kills: k, deaths: d, assists: 2 }, items: [] });
  const me = { champion: 'Lulu', championId: 'Lulu', tags: ['Support', 'Mage'], level: 14, gold: 2500, scores: { kills: 1, deaths: 3, assists: 20 },
    items: [{ id: 3504, slot: 0 }, { id: 6616, slot: 1 }, { id: 3158, slot: 2 }, { id: 6617, slot: 3 }, { id: 3107, slot: 4 }, { id: 2003, slot: 5, count: 2 }, { id: 3340, slot: 6 }] };
  const adv = buyAdvice({ dd, flags, build: { damageType: 'AP', core: [3504, 6616], boots: [3158] }, state: { gameTime: 1900, myRole: 'utility', me,
    enemies: [E('Zed', ['Assassin'], 9, 2), E('Talon', ['Assassin'], 6, 3), E('Leona', ['Tank'], 0, 4)] } });
  assert.equal(adv.cls, 'support');
  assert.ok(adv.full);
  const medal = adv.items.find((i) => i.id === 3190);
  assert.ok(medal, adv.items.map((i) => i.name).join());
  assert.match(medal.reason, /venda Poção de Vida/);
  assert.ok(adv.items.some((i) => i.id === 2138) || adv.notes.some((n) => /Inventário cheio/.test(n)));
});

test('matchup: Purificar contra muito CC, tenacidade, Determinação em matchup difícil; diferenças do OP.GG', () => {
  const base = { core: [1, 2], spells: [4, 14], skills: ['Q', 'W', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E', 'R', 'E', 'E'],
    runes: { primaryStyleId: 8100, subStyleId: 8200, perks: [8112, 8139, 8140, 8106, 8226, 8210, 5008, 5008, 5011] } };
  const enemies = ['Leona', 'Nautilus', 'Lissandra', 'Zed', 'Jinx'].map((id) => ({ id, name: id, tags: id === 'Zed' ? ['Assassin'] : ['Tank'] }));
  const t = tweakForMatchup({ base, build: { ...base, matchup: { vs: 'Zed', used: [] } }, opp: enemies[3], enemies, role: 'middle', cls: 'ap', oppWinRate: 0.45 });
  assert.ok(t.build.spells.includes(1), 'Purificar');
  assert.equal(t.build.runes.perks[8], 5013);
  assert.equal(t.build.runes.subStyleId, 8400);
  assert.deepEqual(t.build.runes.perks.slice(4, 6), [8473, 8451]);
  const mu = { ...base, skills: ['Q', 'W', 'E', 'W', 'W', 'R', 'W', 'Q', 'W', 'Q', 'R', 'Q', 'Q', 'E', 'E', 'R', 'E', 'E'], core: [1, 3] };
  const ch = describeChanges(base, mu, [], { item: (id) => `item${id}` });
  assert.ok(ch.some((c) => c.kind === 'skills' && /W › Q › E/.test(c.text)));
  assert.ok(ch.some((c) => c.kind === 'items' && /item3 no lugar de item2/.test(c.text)));
  assert.deepEqual(maxOrder(base.skills), ['Q', 'W', 'E']);
  const ok = tweakForMatchup({ base, build: base, opp: { id: 'Garen', name: 'Garen', tags: ['Fighter'] }, enemies: [], role: 'middle', cls: 'ap', oppWinRate: 0.55 });
  assert.equal(ok.rules.length, 0);
});
