const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMastery, buildStyle, buildCollection, suggestSkins } = require('../src/profileView');
const { gradeMatch } = require('../src/grades');

const champs = { Akali: { id: 'Akali', key: '84', name: 'Akali', tags: ['Assassin'] }, Ahri: { id: 'Ahri', key: '103', name: 'Ahri', tags: ['Mage', 'Assassin'] }, Jhin: { id: 'Jhin', key: '202', name: 'Jhin', tags: ['Marksman'] }, Yone: { id: 'Yone', key: '777', name: 'Yone', tags: ['Assassin', 'Fighter'] } };
const dd = { champions: champs, championByKey: (k) => Object.values(champs).find((c) => c.key === String(k)) || null };
const DAY = 86400000;
const now = Date.now();
const mastery = new Map([
  [84, { points: 357157, level: 35, lastPlayTime: now - 2 * DAY, untilNext: 4443, sinceLast: 6000, marks: 0, marksNeeded: 2, grades: ['B+', 'D', 'B+'], nextMilestone: { requireGradeCounts: { 'S-': 2 } } }],
  [103, { points: 175000, level: 19, lastPlayTime: now - DAY }],
  [202, { points: 90000, level: 11, lastPlayTime: now - 800 * DAY }],
]);

test('perfil: maestria com progresso, marco, níveis e mains esquecidos', () => {
  const m = buildMastery({ mastery, dd, score: 761, pace: { 84: 800 } });
  assert.equal(m.score, 761);
  assert.equal(m.main.id, 'Akali');
  assert.equal(m.rows[0].daysToNext, 6);
  assert.equal(m.rows[0].milestone, '2× S- ou melhor');
  assert.deepEqual(m.forgotten.map((f) => f.id), ['Jhin']);
  assert.equal(m.buckets.find((b) => b.label === 'Nv. 20–49').count, 1);
});

test('perfil: estilo de jogo (rotas, classes, modos, leque)', () => {
  const games = [
    ...Array.from({ length: 6 }, (_, i) => ({ championId: 84, queueId: 420, mapId: 11, win: i % 2 === 0, at: now - i * 1000, position: 'middle' })),
    { championId: 202, queueId: 420, mapId: 11, win: true, at: now - 9000, position: 'bottom' },
    { championId: 103, queueId: 450, mapId: 12, win: false, at: now - 10000, position: null },
  ];
  const st = buildStyle({ games, dd });
  assert.equal(st.mainRole.role, 'middle');
  assert.equal(st.pool[0].id, 'Akali');
  assert.equal(st.profile, 'Assassino');
  assert.ok(st.modes.some((m) => m.label === 'ARAM'));
});

test('coleção e sugestões: só skins top, à venda, que você não tem, de quem você joga', () => {
  const catalog = {
    84000: { id: 84000, base: true, rarity: 'kNoRarity', legacy: false, chromas: [] },
    84001: { id: 84001, name: 'Akali Comum', rarity: 'kNoRarity', legacy: false, chromas: [] },
    84060: { id: 84060, name: 'Akali Lendária', rarity: 'kLegendary', legacy: false, chromas: [84061] },
    84070: { id: 84070, name: 'Akali Legado', rarity: 'kUltimate', legacy: true, chromas: [] },
    103020: { id: 103020, name: 'Ahri Épica', rarity: 'kEpic', legacy: false, chromas: [] },
    202010: { id: 202010, name: 'Jhin Lendária', rarity: 'kLegendary', legacy: false, chromas: [] },
  };
  const inv = { skins: new Set([84001, 84061]), champions: new Set([84, 103, 202]) };
  const col = buildCollection({ inv, catalog, dd });
  assert.equal(col.skins.owned, 1);
  assert.equal(col.chromas, 1);
  const games = Array.from({ length: 5 }, () => ({ championId: 84, queueId: 420, mapId: 11, win: true, at: now }));
  const sug = suggestSkins({ inv, catalog, dd, mastery, games });
  assert.equal(sug[0].id, 84060); // a Suprema é legado: fica de fora
  assert.ok(!sug.some((x) => x.id === 103020)); // épica não é "top"
});

test('nota da partida: áreas, nota geral e foco na pior área', () => {
  const g = gradeMatch({ kills: 4, deaths: 8, assists: 14, cs: 210, damage: 15000, wards: 10 }, { minutes: 32.3, role: 'middle', tier: 'EMERALD', teamKills: 40, teamDamage: 80000, objDiff: -2, objText: 'x' });
  assert.equal(g.areas.length, 5);
  assert.ok(['A', 'B', 'C', 'D', 'S'].includes(g.grade[0]));
  assert.ok(g.focus && g.focus.tip);
  const great = gradeMatch({ kills: 12, deaths: 1, assists: 9, cs: 280, damage: 40000, wards: 20 }, { minutes: 30, role: 'middle', tier: 'GOLD', teamKills: 30, teamDamage: 100000, objDiff: 4 });
  assert.ok(great.overall > g.overall);
  assert.ok(great.best.length >= 1);
});

test('sugestões: até 40, no máximo 2 por campeão', () => {
  const many = {}; const cat = {};
  for (let i = 1; i <= 15; i++) {
    many[`C${i}`] = { id: `C${i}`, key: String(i), name: `C${i}`, tags: ['Mage'] };
    for (const [j, r] of [[1, 'kLegendary'], [2, 'kUltimate'], [3, 'kLegendary'], [4, 'kMythic']]) cat[i * 1000 + j] = { id: i * 1000 + j, name: `C${i}-${j}`, rarity: r, legacy: false, chromas: [] };
  }
  const ddM = { champions: many, championByKey: (k) => many[`C${k}`] || null };
  const mast = new Map(Array.from({ length: 15 }, (_, i) => [i + 1, { points: 100000 - i * 2000 }]));
  const sug = suggestSkins({ inv: { skins: new Set() }, catalog: cat, dd: ddM, mastery: mast, games: [] });
  assert.equal(sug.length, 30); // 15 campeões x 2
  const per = {};
  for (const s of sug) per[s.champion] = (per[s.champion] || 0) + 1;
  assert.ok(Object.values(per).every((n) => n <= 2));
});

test('preço e modos: RP do catálogo, Essência Mítica, gacha, recentes e promoção', () => {
  const { priceOf, buildSkinList } = require('../src/profileView');
  const prices = new Map([[84060, { rp: 1820, me: null, sale: { rp: 910 }, released: 2000 }], [84090, { rp: null, me: 125, released: 3000 }]]);
  assert.deepEqual(priceOf({ id: 84060, rarity: 'kLegendary' }, prices), { kind: 'rp', amount: 1820, sale: 910 });
  assert.equal(priceOf({ id: 84090, rarity: 'kMythic' }, prices).amount, 125);
  assert.equal(priceOf({ id: 1, rarity: 'kExalted' }, prices).kind, 'gacha');
  assert.equal(priceOf({ id: 2, rarity: 'kLegendary', legacy: true }, null).kind, 'legacy');
  const catalog = { 84060: { id: 84060, name: 'A', rarity: 'kLegendary', legacy: false, chromas: [] }, 84090: { id: 84090, name: 'B', rarity: 'kMythic', legacy: false, chromas: [1] } };
  const inv = { skins: new Set([84060]) };
  const list = buildSkinList({ inv, catalog, dd, prices });
  assert.equal(list.length, 2);
  assert.ok(list.find((x) => x.id === 84060).owned);
  const rec = suggestSkins({ inv: { skins: new Set() }, catalog, dd, mastery, games: [], prices, mode: 'recent' });
  assert.equal(rec[0].id, 84090);
  const sale = suggestSkins({ inv: { skins: new Set() }, catalog, dd, mastery, games: [], prices, mode: 'sale' });
  assert.deepEqual(sale.map((x) => x.id), [84060]);
});
