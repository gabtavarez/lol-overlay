const test = require('node:test');
const assert = require('node:assert');
const { rankThreats } = require('../src/threat');

const p = (champion, k, d, a, level = 9) => ({ champion, level, scores: { kills: k, deaths: d, assists: a }, items: [] });

test('inimigo fed vira a maior ameaça; oponente de rota pesa mais', () => {
  const r = rankThreats([p('Lux', 1, 4, 2), p('Zed', 8, 1, 2), p('Leona', 0, 3, 5)], { myLevel: 9 });
  assert.equal(r[0].e.champion, 'Zed');
  assert.ok(r[0].fed);
  const lane = rankThreats([p('Lux', 2, 2, 2), p('Ahri', 2, 2, 2)], { laneOpponentName: 'Ahri' });
  assert.equal(lane[0].e.champion, 'Ahri');
  assert.ok(lane[0].lane);
});

const { buyAdvice } = require('../src/buys');
const items = { 3111: { name: 'Mercúrio', tags: ['Boots'], gold: { total: 1250 } }, 3047: { name: 'Aço', tags: ['Boots'], gold: { total: 1200 } }, 3020: { name: 'Feiticeiro', tags: ['Boots'], gold: { total: 1100 } }, 1056: { name: 'Doran', tags: [], gold: { total: 400 } } };
const dd = { item: (id) => items[id] || null };
const flags = { healers: [], apOverrides: [], adOverrides: [], hardCc: ['Leona', 'Nautilus', 'Lissandra'] };
const enemy = (champion, tags, k, d, a, position = '') => ({ champion, championId: champion, tags, level: 6, position, scores: { kills: k, deaths: d, assists: a }, items: [] });
const me = (k, d) => ({ champion: 'Lux', tags: ['Mage'], level: 6, gold: 1300, items: [{ id: 1056 }], scores: { kills: k, deaths: d, assists: 0 } });
const bootOf = (adv) => adv.items.find((i) => i.tag === 'boots');

test('bota: ofensiva se a rota está controlada; defensiva se perdendo; Mercúrio contra muito CC', () => {
  const build = { boots: [3020], core: [], damageType: 'AP' };
  const calm = buyAdvice({ dd, flags, build, state: { gameTime: 700, me: me(2, 0), enemies: [enemy('Ahri', ['Mage'], 0, 2, 0, 'MIDDLE'), enemy('Garen', ['Fighter'], 1, 1, 0)], laneOpponent: { champion: 'Ahri' } } });
  assert.equal(bootOf(calm).id, 3020);
  const losing = buyAdvice({ dd, flags, build, state: { gameTime: 700, me: me(0, 4), enemies: [enemy('Zed', ['Assassin'], 5, 0, 1), enemy('Lux2', ['Mage'], 0, 1, 0)], laneOpponent: { champion: 'Zed' } } });
  assert.equal(bootOf(losing).id, 3047);
  const cc = buyAdvice({ dd, flags, build, state: { gameTime: 700, me: me(1, 1), enemies: [enemy('Leona', ['Tank'], 0, 1, 2), enemy('Nautilus', ['Tank'], 0, 1, 1), enemy('Lissandra', ['Mage'], 1, 1, 0)] } });
  assert.equal(bootOf(cc).id, 3111);
});

const { missingGold } = require('../src/buys');
test('ouro faltando desconta componentes (inclusive de componentes) e mostra quais', () => {
  const I = { 6655: { gold: { base: 950 }, from: ['3802', '1052'] }, 3802: { gold: { base: 450 }, from: ['1052', '1027'] }, 1052: { gold: { total: 400 } }, 1027: { gold: { total: 300 } } };
  const d = { item: (id) => I[String(id)] };
  assert.equal(missingGold(d, 6655, []), 950 + 450 + 400 + 300 + 400);
  const used = [];
  assert.equal(missingGold(d, 6655, [3802], used), 950 + 400);
  assert.deepEqual(used, [3802]);
  assert.equal(missingGold(d, 6655, [1052, 1027]), 950 + 450 + 400);
});

const { goldCompare } = require('../src/goldDiff');
test('ouro cara a cara: soma o valor dos itens por rota e do time', () => {
  const ddG = { item: (id) => ({ 1: { gold: { total: 1000 } }, 2: { gold: { total: 3000 } } })[id] };
  const pl = (champion, position, items) => ({ champion, championId: champion, position, items: items.map((id) => ({ id })), scores: { kills: 0, deaths: 0, assists: 0 } });
  const g = goldCompare({ me: pl('Ahri', 'MIDDLE', [2]), allies: [pl('Garen', 'TOP', [1])], enemies: [pl('Zed', 'MIDDLE', [1]), pl('Darius', 'TOP', [2, 1])] }, ddG);
  assert.equal(g.lanes[0].role, 'Topo');
  assert.equal(g.lanes[0].diff, -3000);
  assert.equal(g.lanes[1].diff, 2000);
  assert.equal(g.team.diff, -1000);
  assert.ok(g.lanes[1].ally.me);
});

test('heurísticas: time todo AD puxa armadura; anti-cura começa pelo componente; perdendo a rota pede componente defensivo', () => {
  const I = { 3157: { name: 'Zhonya', tags: [], gold: { total: 3250 } }, 3916: { name: 'Orbe', tags: [], gold: { total: 800 } }, 1029: { name: 'Armadura de pano', tags: [], gold: { total: 300 } }, 1056: { name: 'Doran', tags: [], gold: { total: 400 } } };
  const ddH = { item: (id) => I[id] || null };
  const fl = { healers: ['Soraka'], apOverrides: [], adOverrides: [], hardCc: [], burst: [], autoAttackers: [] };
  const E = (champion, tags, k = 0, d = 0, position = '') => ({ champion, championId: champion, tags, level: 6, position, scores: { kills: k, deaths: d, assists: 0 }, items: [] });
  const meH = (k, d) => ({ champion: 'Lux', championId: 'Lux', tags: ['Mage'], position: 'MIDDLE', level: 6, gold: 500, items: [{ id: 1056 }], scores: { kills: k, deaths: d, assists: 0 } });
  const build = { damageType: 'AP', core: [], boots: [] };
  const allAd = buyAdvice({ dd: ddH, flags: fl, build, state: { gameTime: 900, me: meH(1, 1), enemies: ['Zed', 'Garen', 'Jinx', 'Talon'].map((n) => E(n, ['Assassin'])).concat(E('Soraka', ['Support'])) } });
  const ids = allAd.items.map((i) => i.id);
  assert.ok(ids.includes(3157), 'Zhonya (armadura AP) contra time AD');
  assert.ok(ids.includes(3916), 'componente de anti-cura contra Soraka');
  const losing = buyAdvice({ dd: ddH, flags: fl, build, state: { gameTime: 600, me: meH(0, 3), enemies: [E('Zed', ['Assassin'], 3, 0, 'MIDDLE')], laneOpponent: { champion: 'Zed' } } });
  assert.ok(losing.items.some((i) => i.id === 1029), 'componente defensivo contra o Zed');
});

const { buildState } = require('../src/state');
test('Live API com itens em formato estranho não derruba o overlay', () => {
  const raw = { activePlayer: { riotId: 'Eu#BR1', currentGold: 500 }, gameData: { gameTime: 300 },
    allPlayers: [{ riotId: 'Eu#BR1', team: 'ORDER', championName: 'Ahri', rawChampionName: 'game_character_displayname_Ahri', items: { 0: { itemID: 1056 } }, scores: {} },
      { riotId: 'X#1', team: 'CHAOS', championName: 'Zed', rawChampionName: 'game_character_displayname_Zed', items: null, scores: {} }], events: { Events: {} } };
  const s = buildState(raw, null);
  assert.equal(s.phase, 'ingame');
  assert.equal(s.me.items.length, 1);
});

const { analyze } = require('../src/postgame');
test('pós-partida: aponta throw, farm e rota com evidência', () => {
  const rec = { duration: 1800, role: 'middle', result: 'Lose', opponent: 'Zed', teamKills: 30, firstDeath: 200,
    final: { kills: 2, deaths: 8, assists: 4, cs: 120, wards: 10 },
    samples: [{ t: 600, lane: -900, team: 500 }, { t: 900, lane: -1200, team: 3500 }, { t: 1500, lane: 0, team: -2000 }] };
  const a = analyze(rec);
  const titles = a.bad.map((b) => b.title);
  for (const t of ['Farm baixo', 'Muitas mortes', 'Rota perdida aos 10 min', 'Throw', 'Morte cedo']) assert.ok(titles.includes(t), t);
});

const { predictRoles } = require('../src/roles');
const { phaseCompare } = require('../src/power');
const { objectiveTimers } = require('../src/timers');
test('rotas inimigas previstas, flex, fases e timers', () => {
  const idx = { Zed: { middle: 0.9, top: 0.1 }, Yone: { middle: 0.5, top: 0.45, jungle: 0.05 }, LeeSin: { jungle: 1 } };
  const out = predictRoles([{ champion: { id: 'Zed' }, position: '' }, { champion: { id: 'Yone' }, position: '' }, { champion: { id: 'LeeSin' }, position: '' }], idx);
  assert.equal(out[0].predicted, 'middle');
  assert.equal(out[1].predicted, 'top');
  assert.deepEqual(out[1].flex, ['middle', 'top']);
  assert.equal(out[2].predicted, 'jungle');
  const ph = phaseCompare({ id: 'Draven', name: 'Draven', tags: [] }, { id: 'Kayle', name: 'Kayle', tags: [] });
  assert.equal(ph[0].verdict, 'mine');
  assert.equal(ph[2].verdict, 'theirs');
  const t = objectiveTimers({ phase: 'ingame', gameMode: 'CLASSIC', gameTime: 400, events: [{ name: 'DragonKill', time: 320 }] });
  assert.equal(t.find((x) => x.key === 'dragon').in, 220);
});

test('Ahri contra Fizz no começo: Fizz é AP, 1/1/0 não é fed, sugere Véu da Banshee e não Aço', () => {
  const flagsReal = require('../data/champion-flags.json');
  const I = { 3102: { name: 'Véu da Banshee', tags: [], gold: { total: 3000 } }, 3157: { name: 'Zhonya', tags: [], gold: { total: 3250 } }, 3047: { name: 'Aço', tags: ['Boots'], gold: { total: 1200 } }, 3020: { name: 'Feiticeiro', tags: ['Boots'], gold: { total: 1100 } }, 1056: { name: 'Doran', tags: [], gold: { total: 400 } } };
  const ddF = { item: (id) => I[id] || null };
  const E = (champion, tags, k, d, position = '') => ({ champion, championId: champion, tags, level: 4, position, scores: { kills: k, deaths: d, assists: 0 }, items: [] });
  const adv = buyAdvice({ dd: ddF, flags: flagsReal, build: { damageType: 'AP', core: [], boots: [3020] }, state: {
    gameTime: 230, laneOpponent: { champion: 'Fizz' },
    me: { champion: 'Ahri', championId: 'Ahri', tags: ['Mage', 'Assassin'], position: 'MIDDLE', level: 4, gold: 100, items: [{ id: 1056 }], scores: { kills: 1, deaths: 1, assists: 0 } },
    enemies: [E('Fizz', ['Assassin', 'Fighter'], 1, 1, 'MIDDLE'), E('Lucian', ['Marksman'], 0, 1), E('TahmKench', ['Support', 'Tank'], 0, 0), E('XinZhao', ['Fighter'], 0, 0), E('Blitzcrank', ['Tank'], 0, 0)] } });
  const ids = adv.items.map((i) => i.id);
  assert.ok(ids.includes(3102), `Banshee esperado, veio ${ids}`);
  assert.ok(!ids.includes(3047), 'sem Aço contra Fizz');
  assert.ok(!adv.notes.some((n) => /fed/.test(n)));
});

test('mago contra Zed na rota: Zhonya (não Banshee)', () => {
  const flagsReal = require('../data/champion-flags.json');
  const I = { 3102: { name: 'Banshee', tags: [], gold: { total: 3000 } }, 3157: { name: 'Zhonya', tags: [], gold: { total: 3250 } }, 1056: { name: 'Doran', tags: [], gold: { total: 400 } } };
  const ddZ = { item: (id) => I[id] || null };
  const E = (champion, tags, position = '') => ({ champion, championId: champion, tags, level: 6, position, scores: { kills: 1, deaths: 1, assists: 0 }, items: [] });
  const adv = buyAdvice({ dd: ddZ, flags: flagsReal, build: { damageType: 'AP', core: [], boots: [] }, state: {
    gameTime: 700, laneOpponent: { champion: 'Zed' },
    me: { champion: 'Ahri', championId: 'Ahri', tags: ['Mage'], position: 'MIDDLE', level: 6, gold: 500, items: [{ id: 1056 }], scores: { kills: 1, deaths: 1, assists: 0 } },
    enemies: [E('Zed', ['Assassin'], 'MIDDLE'), E('Lux', ['Mage']), E('Garen', ['Fighter'])] } });
  const z = adv.items.find((i) => i.id === 3157);
  assert.ok(z, `Zhonya esperado, veio ${adv.items.map((i) => i.id)}`);
  assert.match(z.reason, /Zed/);
  assert.ok(!adv.items.some((i) => i.id === 3102));
});

test('botas: com bota básica sugere a final; anti-cura não dispara por Lâmina de Doran', () => {
  const I = { 1001: { name: 'Botas', tags: ['Boots'], gold: { total: 300 } }, 3020: { name: 'Feiticeiro', tags: ['Boots'], gold: { total: 1100 }, from: ['1001'] , },
    1055: { name: 'Lâmina de Doran', tags: ['LifeSteal'], gold: { total: 450 } }, 3916: { name: 'Orbe', tags: [], gold: { total: 800 } }, 1056: { name: 'Anel', tags: [], gold: { total: 400 } } };
  I[3020].gold.base = 800;
  const ddB = { item: (id) => I[id] || null };
  const fl = { healers: [], apOverrides: [], adOverrides: [], hardCc: [], burst: [], autoAttackers: [] };
  const E = (champion, tags) => ({ champion, championId: champion, tags, level: 8, position: '', scores: { kills: 1, deaths: 1, assists: 0 }, items: [{ id: 1055, tags: ['LifeSteal'] }] });
  const adv = buyAdvice({ dd: ddB, flags: fl, build: { damageType: 'AP', core: [], boots: [3020] }, state: {
    gameTime: 600, me: { champion: 'Ahri', championId: 'Ahri', tags: ['Mage'], level: 8, gold: 900, items: [{ id: 1056 }, { id: 1001 }], scores: { kills: 1, deaths: 1, assists: 0 } },
    enemies: [E('Talon', ['Assassin']), E('Smolder', ['Marksman'])] } });
  const ids = adv.items.map((i) => i.id);
  assert.ok(ids.includes(3020), `bota final esperada: ${ids}`);
  assert.equal(adv.items.find((i) => i.id === 3020).missing, 800);
  assert.ok(!ids.includes(3916), 'sem anti-cura por Doran');
});

const { situationalItems } = require('../src/situational');
test('situacionais no champ select: respostas à comp inimiga + alternativas do meta', () => {
  const I = { 3157: { name: 'Zhonya' }, 3916: { name: 'Orbe' }, 3102: { name: 'Banshee' }, 3135: { name: 'Cajado do Vazio' }, 6653: { name: 'Liandry' }, 3089: { name: 'Rabadon' }, 4645: { name: 'Chama' } };
  const ddS = { item: (id) => I[id] || null };
  const s = situationalItems({ champ: { tags: ['Mage'] }, dd: ddS, build: { damageType: 'AP', core: [4645], boots: [], later: [[{ ids: [3089], pick: 0.5 }, { ids: [3135], pick: 0.2 }]] },
    enemies: [{ id: 'Zed', name: 'Zed', tags: ['Assassin'] }, { id: 'Soraka', name: 'Soraka', tags: ['Support'] }, { id: 'Malphite', name: 'Malphite', tags: ['Tank'] }, { id: 'Ornn', name: 'Ornn', tags: ['Tank'] }] });
  const ids = s.map((x) => x.id);
  assert.ok(ids.includes(3157) && ids.includes(3916) && ids.includes(6653), ids.join());
  assert.equal(s[0].id, 3916); // anti-cura primeiro
});

const { championFit, mainRoleOf } = require('../src/fit');
test('champion fit: rota principal pelas partidas e só campeões da mesma classe/dano', () => {
  assert.equal(mainRoleOf({ matches: [1, 2, 3, 4].map(() => ({ me: { position: 'MID' } })).concat([{ me: { position: 'TOP' } }]), roles: [{ role: 'top' }] }), 'middle');
  const champs = { Ahri: { id: 'Ahri', key: '103', name: 'Ahri', tags: ['Mage', 'Assassin'] }, Syndra: { id: 'Syndra', key: '134', name: 'Syndra', tags: ['Mage'] },
    Hwei: { id: 'Hwei', key: '910', name: 'Hwei', tags: ['Mage'] }, Malphite: { id: 'Malphite', key: '54', name: 'Malphite', tags: ['Tank', 'Mage'] }, Talon: { id: 'Talon', key: '91', name: 'Talon', tags: ['Assassin'] } };
  const ddF = { championByKey: (k) => Object.values(champs).find((c) => c.key === String(k)), championByRaw: (_r, n) => champs[n] || null };
  const mastery = new Map([[103, { points: 400000 }], [134, { points: 100000 }]]);
  const tl = { middle: ['Hwei', 'Malphite', 'Talon'].map((n) => ({ champion: n, tier: 1, winRate: 0.52, roleRate: 0.9 })) };
  const fit = championFit({ mastery, dd: ddF, tierList: tl, mainRole: 'middle', roleStats: { middle: { 103: { games: 20 }, 134: { games: 8 } } } });
  assert.deepEqual(fit.map((f) => f.id), ['Hwei']);
});

test('bota evoluída (Grevas Bélicas, sem a tag Boots) conta como bota: não sugere bota de novo', () => {
  const I = { 3006: { name: 'Grevas do Berserker', tags: ['AttackSpeed', 'Boots'], gold: { total: 1100 }, from: ['1001'] }, 3172: { name: 'Grevas Bélicas', tags: ['AttackSpeed', 'LifeSteal'], gold: { total: 1100 }, from: ['3006'] }, 1055: { name: 'Doran', tags: [], gold: { total: 450 } } };
  const ddE = { item: (id) => I[id] || null };
  const fl = { healers: [], apOverrides: [], adOverrides: [], hardCc: [], burst: [], autoAttackers: [] };
  const adv = buyAdvice({ dd: ddE, flags: fl, build: { damageType: 'AD', core: [], boots: [3006] }, state: {
    gameTime: 1200, me: { champion: 'Jinx', championId: 'Jinx', tags: ['Marksman'], level: 12, gold: 2000, items: [{ id: 1055 }, { id: 3172 }], scores: { kills: 1, deaths: 1, assists: 0 } }, enemies: [] } });
  assert.ok(!adv.items.some((i) => i.id === 3006), adv.items.map((i) => i.name).join());
});

test('início da partida: sugere os itens iniciais do meta (com quantidade)', () => {
  const I = { 1056: { name: 'Anel de Doran', tags: [], gold: { total: 400 } }, 2003: { name: 'Poção de Vida', tags: [], gold: { total: 50 } }, 4645: { name: 'Chama Sombria', tags: [], gold: { total: 3200 } } };
  const ddI = { item: (id) => I[id] || null };
  const fl = { healers: [], apOverrides: [], adOverrides: [], hardCc: [], burst: [], autoAttackers: [] };
  const adv = buyAdvice({ dd: ddI, flags: fl, build: { damageType: 'AP', core: [4645], boots: [], starter: [1056, 2003, 2003] }, state: {
    gameTime: 5, me: { champion: 'Ahri', championId: 'Ahri', tags: ['Mage'], level: 1, gold: 500, items: [], scores: { kills: 0, deaths: 0, assists: 0 } }, enemies: [] } });
  assert.equal(adv.items[0].id, 1056);
  assert.equal(adv.items[1].id, 2003);
  assert.match(adv.items[1].reason, /compre 2/);
});

test('Hecarim fed contra atirador ganhando a rota: resposta a ele aparece (não some atrás da build do meta)', () => {
  const flagsReal = require('../data/champion-flags.json');
  const I = { 3026: { name: 'Anjo Guardião', tags: ['Armor'], gold: { total: 3200 } }, 3072: { name: 'Sedenta por Sangue', tags: [], gold: { total: 3400 } }, 3033: { name: 'Lembrete Mortal', tags: [], gold: { total: 3000 } }, 3123: { name: 'Chamado do Carrasco', tags: [], gold: { total: 800 } },
    3814: { name: 'Limiar da Noite', tags: [], gold: { total: 3000 } }, 6672: { name: 'Mata-Cráquens', tags: [], gold: { total: 3100 } }, 3006: { name: 'Grevas', tags: ['Boots'], gold: { total: 1100 } } };
  const ddK = { item: (id) => I[id] || null };
  const E = (champion, tags, k, d, a, position = '') => ({ champion, championId: champion, tags, level: 16, position, scores: { kills: k, deaths: d, assists: a }, items: [] });
  const adv = buyAdvice({ dd: ddK, flags: flagsReal, build: { damageType: 'AD', core: [6672, 3072, 3026], boots: [3006] }, state: {
    gameTime: 1880, laneOpponent: { champion: 'Sivir' },
    me: { champion: 'Jinx', championId: 'Jinx', tags: ['Marksman'], position: 'BOTTOM', level: 15, gold: 700, items: [{ id: 6672 }, { id: 3006 }], scores: { kills: 6, deaths: 1, assists: 8 } },
    enemies: [E('Teemo', ['Marksman', 'Assassin'], 3, 12, 4), E('Hecarim', ['Fighter', 'Tank'], 19, 4, 8), E('Zed', ['Assassin'], 8, 9, 3, 'MIDDLE'), E('Sivir', ['Marksman'], 6, 8, 1, 'BOTTOM'), E('Yuumi', ['Support', 'Mage'], 1, 4, 22)] } });
  const hec = adv.items.filter((i) => /Hecarim/.test(i.reason));
  assert.ok(hec.length, `nada contra o Hecarim: ${adv.items.map((i) => `${i.name} (${i.reason})`).join(' | ')}`);
});

test('itens do inimigo: Kai\'Sa AP conta como mágico; penetração pela armadura comprada; escudos; crítico', () => {
  const { liveProfile } = require('../src/buys');
  const flagsReal = require('../data/champion-flags.json');
  const I = {
    3089: { name: 'Capuz da Morte', stats: { FlatMagicDamageMod: 130 }, gold: { total: 3600 }, tags: [] },
    4645: { name: 'Chama Sombria', stats: { FlatMagicDamageMod: 110 }, gold: { total: 3200 }, tags: [] },
    3143: { name: 'Randuin', stats: { FlatArmorMod: 75 }, gold: { total: 2700 }, tags: ['Armor'] },
    3075: { name: 'Espinhos', stats: { FlatArmorMod: 70 }, gold: { total: 2700 }, tags: ['Armor'] },
    3036: { name: 'Lorde Dominik', stats: { FlatPhysicalDamageMod: 35, FlatCritChanceMod: 0.25 }, gold: { total: 3100 }, tags: [] },
    6695: { name: 'Presa da Serpente', stats: {}, gold: { total: 2500 }, tags: [] },
    3031: { name: 'Gume do Infinito', stats: { FlatPhysicalDamageMod: 65, FlatCritChanceMod: 0.25 }, gold: { total: 3400 }, tags: ['CriticalStrike'] },
    3094: { name: 'Canhão Fumegante', stats: { FlatCritChanceMod: 0.25, PercentAttackSpeedMod: 0.35 }, gold: { total: 2800 }, tags: ['CriticalStrike'] },
    3190: { name: 'Medalhão', stats: { FlatArmorMod: 25 }, gold: { total: 2200 }, description: 'Concede um escudo aos aliados próximos.', tags: [] },
    3071: { name: 'Cutelo Negro', stats: { FlatPhysicalDamageMod: 40 }, gold: { total: 3000 }, tags: [] },
    6694: { name: 'Rancor de Serylda', stats: { FlatPhysicalDamageMod: 45 }, gold: { total: 3000 }, tags: [] },
  };
  const ddI = { item: (id) => I[id] || null };
  const kaisa = { champion: "Kai'Sa", championId: 'Kaisa', tags: ['Marksman'], items: [{ id: 3089 }, { id: 4645 }] };
  const p = liveProfile(kaisa, ddI, flagsReal);
  assert.ok(p.ap > 0.55 && p.offbuild === 'AP', JSON.stringify(p));

  const E = (champion, tags, items, k = 2, d = 2) => ({ champion, championId: champion, tags, level: 13, position: '', scores: { kills: k, deaths: d, assists: 2 }, items: items.map((id) => ({ id, tags: (I[id] || {}).tags || [] })) });
  const meAd = { champion: 'Talon', championId: 'Talon', tags: ['Assassin'], level: 13, gold: 900, items: [{ id: 3071 }, { id: 1055 }], scores: { kills: 4, deaths: 2, assists: 1 } };
  const adv = buyAdvice({ dd: ddI, flags: flagsReal, build: { damageType: 'AD', core: [], boots: [] }, state: { gameTime: 1500, me: meAd,
    enemies: [E('Ornn', ['Tank'], [3143, 3075]), E('Lulu', ['Support'], [3190]), E('Sett', ['Fighter'], [3190]), E('Jinx', ['Marksman'], [3031, 3094], 7, 1), E('Lux', ['Mage'], [])] } });
  const byTag = (tag) => adv.items.find((i) => i.tag === tag) || null;
  const all = adv.items.map((i) => `${i.name}:${i.tag}`).join(' | ');
  assert.ok(adv.items.some((i) => i.id === 6695), `Presa da Serpente contra escudos: ${all}`);
  assert.ok(byTag('pen'), `penetração esperada: ${all}`);
  assert.match(byTag('pen').reason, /Ornn \(\+145 armadura\)/);
  assert.ok(!byTag('anticrit'), 'assassino não compra Randuin');
  const tank = buyAdvice({ dd: ddI, flags: flagsReal, build: { damageType: 'AD', core: [], boots: [] }, state: { gameTime: 1500,
    me: { champion: 'Malphite', championId: 'Malphite', tags: ['Tank'], level: 13, gold: 900, items: [{ id: 3075 }], scores: { kills: 1, deaths: 2, assists: 5 } },
    enemies: [E('Jinx', ['Marksman'], [3031, 3094], 7, 1), E('Lux', ['Mage'], [])] } });
  assert.ok(tank.items.some((i) => i.id === 3143 && /Jinx com 2 itens de crítico/.test(i.reason)), tank.items.map((i) => i.reason).join(' | '));
});
