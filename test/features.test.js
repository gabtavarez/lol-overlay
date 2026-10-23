const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { parseMatchup, parseSynergies } = require('../src/providers/opggMcp');
const { withMatchup } = require('../src/matchup');
const { recommendPicks } = require('../src/picker');
const { recommendBans } = require('../src/bans');
const { createAlertTracker } = require('../src/alerts');
const { buyAdvice } = require('../src/buys');
const { importItemSet } = require('../src/importer');
const { autoAccept } = require('../src/autoAccept');
const { DEFAULTS } = require('../src/settings');

const MATCHUP = JSON.stringify({ data: {
  opponent_champion_tip: 'Cuidado com a bolha da Zoe.', lane_advantage_champion: 'Zoe', recommended_play_style: 'even',
  summoner_spells: [{ ids: [4, 14], play: 324 }],
  core_items: [{ ids: [3146, 4645, 3157], play: 74, pick_rate: 0.32 }],
  boots: [{ ids: [3020] }], starter_items: [{ ids: [1054, 2003] }],
  runes: [{ primary_page_id: 8100, primary_page_name: 'Domination', primary_rune_ids: [8112, 8143, 8140, 8106], primary_rune_names: [], secondary_page_id: 8400, secondary_page_name: 'Resolve', secondary_rune_ids: [8444, 8451], secondary_rune_names: [], stat_mod_ids: [5008, 5008, 5001], pick_rate: 0.7 }],
  skills: [{ order: ['Q', 'W', 'E'] }],
} });

const BASE = { core: [1], corePick: 0.2, boots: [2], starter: [3], spells: [4, 7], skills: ['Q'], runes: { perks: [1] }, later: [] };

test('matchup: lê o guia e sobrepõe à build geral só com amostra suficiente', () => {
  const mu = parseMatchup(MATCHUP);
  assert.equal(mu.tip, 'Cuidado com a bolha da Zoe.');
  assert.deepEqual(mu.spells, [4, 14]);
  const merged = withMatchup(BASE, mu, 'Zoe');
  assert.deepEqual(merged.core, [3146, 4645, 3157]);
  assert.equal(merged.matchup.vs, 'Zoe');
  assert.deepEqual(merged.matchup.used, ['itens', 'feitiços', 'runas']);
  const small = withMatchup(BASE, { ...mu, coreGames: 10 }, 'Zoe');
  assert.deepEqual(small.core, [1]); // pouca amostra: mantém a geral
  assert.equal(withMatchup(BASE, null, 'Zoe'), BASE);
  assert.throws(() => parseMatchup('{}'));
});

test('sinergias: ignora poucas partidas e converte win rate em nota', () => {
  const text = `class LolGetChampionSynergies: data
class Data: synergies
class Synergie: champion_name,synergy_champion_name,score,play,win_rate

LolGetChampionSynergies(Data([Synergie("Ashe","Alistar",0,104,0.58),Synergie("Ashe","Lulu",0,316,0.47),Synergie("Ashe","Rare",0,20,0.7)]))`;
  const s = parseSynergies(text);
  assert.equal(s.alistar, 1);
  assert.ok(s.lulu < 0);
  assert.equal(s.rare, undefined);
});

const CH = (id, key, tags = ['Mage']) => ({ id, key: String(key), name: id, tags });
const dd = { champions: { Lux: CH('Lux', 99), Karma: CH('Karma', 43), Zoe: CH('Zoe', 142), Ashe: CH('Ashe', 22, ['Marksman']), Soraka: CH('Soraka', 16) } };
const player = (c, extra = {}) => ({ champion: c ? { id: c.id, name: c.name, tags: c.tags } : null, locked: true, championKey: c ? Number(c.key) : 0, ...extra });

test('picker: sinergia com aliado entra como sinal e explica o motivo', () => {
  const cs = { myPosition: 'utility', spectating: false, pickable: [99, 43], allies: [player(dd.champions.Ashe, { position: 'bottom' })], enemies: [], bans: { mine: [], theirs: [] } };
  const meta = { tiers: {}, counters: {}, synergies: { ashe: { karma: 1, lux: -0.5 } } };
  const out = recommendPicks({ champSelect: cs, profile: null, dd, settings: DEFAULTS, meta });
  assert.equal(out.candidates[0].name, 'Karma');
  assert.ok(out.candidates[0].reasons.some((r) => /Boa dupla com Ashe/.test(r)));
  assert.ok(out.signalsUsed.includes('synergy'));
});

test('bans: counters dos seus melhores picks + tier alto, sem aliados nem pool', () => {
  const cs = { myPosition: 'middle', spectating: false, bannable: [99, 43, 142, 16], allies: [], me: null };
  const picks = { candidates: [{ id: 'Lux', name: 'Lux', score: 90 }] };
  const getBuild = () => ({ weakCounters: [{ name: 'Zoe', value: 1 }, { name: 'Karma', value: 0.2 }] });
  const meta = { tiers: { middle: { soraka: 'S+', zoe: 'B' } } };
  const out = recommendBans({ champSelect: cs, picks, getBuild, dd, meta, settings: DEFAULTS });
  assert.equal(out[0].name, 'Zoe');
  assert.match(out[0].reasons[0], /Counter do seu Lux/);
  assert.ok(out.some((b) => b.name === 'Soraka' && /Tier S\+/.test(b.reasons[0])));
  assert.ok(!out.some((b) => b.name === 'Lux')); // seu pick não é banido
});

test('alertas: só itens novos, estado inicial é memorizado, expira', () => {
  let t = 1000;
  const tr = createAlertTracker({ table: { 3033: 'corta a sua cura' }, now: () => t });
  const state = (items) => ({ enemies: [{ name: 'A#1', champion: 'Soraka', items }] });
  assert.deepEqual(tr.update(state([{ id: 3033, name: 'Mortal Reminder' }]), null), []); // já tinha ao abrir
  assert.deepEqual(tr.update(state([{ id: 3033 }, { id: 3033 }]), null), []);
  const second = createAlertTracker({ table: { 3033: 'corta a sua cura' }, now: () => t });
  second.update(state([]), null);
  const a = second.update(state([{ id: 3033, name: 'Mortal Reminder' }]), null);
  assert.match(a[0].text, /Soraka fechou Mortal Reminder: corta a sua cura/);
  t += 31_000;
  assert.deepEqual(second.update(state([{ id: 3033 }]), null), []);
});

test('compras: aviso de recall quando dá para fechar um item caro', () => {
  const dd2 = { item: (id) => ({ 3146: { name: 'Gunblade', gold: { base: 800, total: 3000 }, from: [3145], tags: [] }, 3145: { name: 'Alt', gold: { base: 1100, total: 1100 }, tags: [] } }[id] || null) };
  const me = { id: 'Akali', tags: ['Assassin'], gold: 1900, items: [{ id: 3145, name: 'Alt', tags: [], slot: 0, count: 1 }] };
  const build = { core: [3146], corePick: 0.3, boots: [], later: [], damageType: 'AP' };
  const out = buyAdvice({ state: { me: { ...me, championId: 'Akali' }, enemies: [], gameTime: 900 }, build, dd: dd2 });
  assert.match(out.recall, /1900 g.*Gunblade/);
});

test('item set: substitui só o conjunto do mesmo campeão e envia blocos', async () => {
  let put = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/lol-summoner/v1/current-summoner')) return res.end(JSON.stringify({ summonerId: 55, accountId: 9 }));
      if (req.method === 'GET') return res.end(JSON.stringify({ accountId: 9, itemSets: [{ title: 'LoL Overlay · Akali' }, { title: 'Meu set' }] }));
      put = { url: req.url, body: JSON.parse(body) };
      res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const creds = { port: server.address().port, token: 't', protocol: 'http' };
    const build = { starter: [1054], boots: [3020], core: [3146], later: [[{ ids: [3089], pick: 0.4 }]], matchup: { vs: 'Zoe' } };
    await importItemSet(creds, build, { key: '84', name: 'Akali' });
    assert.equal(put.url, '/lol-item-sets/v1/item-sets/55/sets');
    const titles = put.body.itemSets.map((s) => s.title);
    assert.deepEqual(titles, ['Meu set', 'LoL Overlay · Akali']);
    const mine = put.body.itemSets[1];
    assert.deepEqual(mine.associatedChampions, [84]);
    assert.equal(mine.blocks[2].type, 'Core vs Zoe');
    assert.deepEqual(mine.blocks[2].items, [{ id: '3146', count: 1 }]);
  } finally {
    server.close();
  }
});

test('auto-aceitar: aceita uma vez por ready check e rearma ao sair da fase', async () => {
  let phase = 'ReadyCheck';
  let accepts = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/lol-gameflow/v1/gameflow-phase') return res.end(JSON.stringify(phase));
    if (req.url === '/lol-matchmaking/v1/ready-check/accept') { accepts += 1; return res.end('{}'); }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const creds = { port: server.address().port, token: 't', protocol: 'http' };
    const st = { accepted: false };
    assert.equal(await autoAccept(creds, st), true);
    assert.equal(await autoAccept(creds, st), false);
    assert.equal(accepts, 1);
    phase = 'Lobby';
    await autoAccept(creds, st);
    phase = 'ReadyCheck';
    assert.equal(await autoAccept(creds, st), true);
    assert.equal(accepts, 2);
  } finally {
    server.close();
  }
});

test('itens depois do core: sem repetir item (nem do core) em nenhum slot', () => {
  const { laterItems } = require('../src/buildPath');
  const build = {
    core: [3146, 4645, 3157],
    boots: [3020],
    later: [
      [{ ids: [3089], pick: 0.37 }, { ids: [3157], pick: 0.26 }],
      [{ ids: [3089], pick: 0.3 }, { ids: [3135], pick: 0.25 }],
      [{ ids: [3157], pick: 0.4 }, { ids: [3089], pick: 0.2 }, { ids: [3100], pick: 0.15 }],
    ],
  };
  const out = laterItems(build);
  assert.deepEqual(out, [3089, 3135, 3100]); // Rabadon uma vez só; Zhonya (já no core) fora
  assert.equal(new Set(out).size, out.length);
  assert.deepEqual(laterItems({ core: [1], later: [] }), []);
});
