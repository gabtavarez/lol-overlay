const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');

const { parseCompact, parseAnalysis, parseLaneMeta, createMcpClient } = require('../src/providers/opggMcp');
const { createRemoteData } = require('../src/providers/remote');
const { buyAdvice, missingGold } = require('../src/buys');
const { importRunes, importSpells } = require('../src/importer');
const { buildGuide, indexRunes } = require('../src/guide');

// Resposta real (reduzida) do lol_get_champion_analysis do OP.GG MCP.
const ANALYSIS = `class LolGetChampionAnalysis: data
class Data: summary,damage_type,strong_counters,weak_counters,core_items,boots,starter_items,fourth_items,fifth_items,sixth_items,summoner_spells,runes,skills
class Summary: average_stats
class AverageStats: play,win_rate,pick_rate,ban_rate,kda,tier,rank,tier_data
class TierData: tier,rank,rank_prev,rank_prev_patch
class CoreItems: ids,ids_names,play,win,pick_rate
class StrongCounter: champion_id,champion_name,play,win,my_win_rate,counter_win_rate,win_rate
class Runes: id,primary_page_id,primary_page_name,primary_rune_ids,primary_rune_names,secondary_page_id,secondary_page_name,secondary_rune_ids,secondary_rune_names,stat_mod_ids,stat_mod_names,play,win,pick_rate
class Skills: order,play,win,pick_rate

LolGetChampionAnalysis(Data(Summary(AverageStats(48510,0.49,0.11,0.17,2.22,2,48,TierData(2,48,48,84))),"AP",[StrongCounter(39,"Irelia",417,239,0.57,0.43,0.57)],[StrongCounter(142,"Zoe",378,149,0.39,0.61,0.61),StrongCounter(4,"Twisted Fate",751,314,0.42,0.58,0.58)],CoreItems([3146,4645,3157],["Hextech Gunblade","Shadowflame","Zhonya's Hourglass"],5089,2454,0.3),CoreItems([3020],["Sorcerer's Shoes"],23517,11762,0.82),CoreItems([1056,2003,2003],["Doran's Ring","Health Potion","Health Potion"],17760,8697,0.6),[CoreItems([3089],["Rabadon's Deathcap"],2633,1410,0.37),CoreItems([3157],["Zhonya's Hourglass"],1829,1051,0.26)],[CoreItems([3135],["Void Staff"],437,219,0.25)],[],CoreItems([4,14],[4,14],25026,12295,0.85),Runes(8112,8100,"Domination",[8112,8143,8140,8106],["Electrocute","Sudden Impact","Grisly Mementos","Ultimate Hunter"],8400,"Resolve",[8444,8451],["Second Wind","Overgrowth"],[5008,5008,5001],[5008,5008,5001],11506,5574,0.39),Skills(["Q","W","E","Q","Q","R","Q","E","Q","E","R","E","E","W","W"],14845,8198,0.76)))`;

const LANE = `class LolListLaneMetaChampions: lang,position_filter,data
class Data: positions
class Positions: mid
class Mid: champion,is_rip,play,win,kill,win_rate,pick_rate,role_rate,ban_rate,kda,tier,rank,rank_prev,rank_prev_patch

LolListLaneMetaChampions("en_US","mid",Data(Positions([Mid("Ahri",false,44027,22476,311742,0.51,0.1,0.95,0.03,2.55,1,1,1,1),Mid("Yasuo",false,40797,20473,276048,0.5,0.09,0.59,0.25,1.66,1,12,2,6),Mid("Akali",false,1,1,1,0.49,0.09,0.59,0.25,1.66,2,48,2,6)])))`;

const DD_ITEMS = {
  1056: { name: "Doran's Ring", gold: { base: 400, total: 400 }, tags: [] },
  3020: { name: "Sorcerer's Shoes", gold: { base: 400, total: 1100 }, from: [1001], tags: ['Boots'] },
  1001: { name: 'Boots', gold: { base: 300, total: 300 }, tags: ['Boots'] },
  3146: { name: 'Hextech Gunblade', gold: { base: 800, total: 3000 }, from: [3145, 1026], tags: [] },
  3145: { name: 'Hextech Alternator', gold: { base: 300, total: 1100 }, tags: [] },
  1026: { name: 'Blasting Wand', gold: { base: 850, total: 850 }, tags: [] },
  4645: { name: 'Shadowflame', gold: { base: 800, total: 3200 }, tags: [] },
  3157: { name: "Zhonya's Hourglass", gold: { base: 400, total: 3250 }, tags: [] },
  3165: { name: 'Morellonomicon', gold: { base: 800, total: 2200 }, tags: [] },
  3102: { name: "Banshee's Veil", gold: { base: 800, total: 2600 }, tags: [] },
  3111: { name: "Mercury's Treads", gold: { base: 400, total: 1100 }, from: [1001], tags: ['Boots'] },
  3135: { name: 'Void Staff', gold: { base: 800, total: 3000 }, tags: [] },
};
const dd = { item: (id) => DD_ITEMS[id] || null };

function player(id, champion, tags, extra = {}) {
  return { championId: id, champion, tags, scores: { kills: 0, deaths: 0, assists: 0 }, items: [], ...extra };
}
const ME = { ...player('Akali', 'Akali', ['Assassin']), gold: 1200, items: [{ id: 1056, name: "Doran's Ring", tags: [], slot: 0, count: 1 }] };

test('parser compacto: lê a análise real do OP.GG', () => {
  const b = parseAnalysis(ANALYSIS);
  assert.equal(b.damageType, 'AP');
  assert.deepEqual(b.core, [3146, 4645, 3157]);
  assert.deepEqual(b.boots, [3020]);
  assert.deepEqual(b.spells, [4, 14]);
  assert.equal(b.skills.length, 15);
  assert.deepEqual(b.runes.perks, [8112, 8143, 8140, 8106, 8444, 8451, 5008, 5008, 5001]);
  assert.equal(b.runes.primaryStyleId, 8100);
  assert.equal(b.runes.subStyleId, 8400);
  assert.equal(b.weakCounters[0].name, 'Zoe');
  assert.equal(b.weakCounters[0].value, 1); // Zoe é boa contra Akali
  assert.ok(b.strongCounters[0].value < 0); // Irelia sofre contra Akali
  assert.equal(b.later[0][0].ids[0], 3089);
  assert.throws(() => parseAnalysis('nada útil aqui'));
});

test('parser compacto: aspas, números e listas aninhadas', () => {
  const t = parseCompact('class A: x,y\nA("a, (b)",[1,2.5,[true,null]])');
  assert.deepEqual(t, { x: 'a, (b)', y: [1, 2.5, [true, null]] });
});

test('tier list da rota: S+ só para os 3 melhores do tier 1', () => {
  const t = parseLaneMeta(LANE);
  assert.equal(t.ahri, 'S+');
  assert.equal(t.yasuo, 'S');
  assert.equal(t.akali, 'A');
});

test('compras: caminho do meta + reativos com motivo e ouro faltando', () => {
  const build = parseAnalysis(ANALYSIS);
  const enemies = [
    player('Soraka', 'Soraka', ['Support', 'Mage']),
    player('Veigar', 'Veigar', ['Mage']),
    player('Lux', 'Lux', ['Mage']),
    player('Ahri', 'Ahri', ['Mage']),
    player('Annie', 'Annie', ['Mage']),
  ];
  const state = { me: ME, enemies, gameTime: 900 };
  const out = buyAdvice({ state, build, dd });
  assert.equal(out.items.length, 3);
  const names = out.items.map((i) => i.name);
  assert.ok(names.includes('Morellonomicon')); // anti-cura contra Soraka (AP)
  assert.ok(names.includes("Banshee's Veil")); // time muito AP
  const heal = out.items.find((i) => i.name === 'Morellonomicon');
  assert.match(heal.reason, /Soraka/);
  assert.ok(out.items.every((i) => i.reason && typeof i.missing === 'number'));
  assert.ok(out.items.every((i, k, a) => k === 0 || a[k - 1].score >= i.score));
});

test('compras: sem build usa só regras; item já comprado não repete', () => {
  const state = { me: { ...ME, items: [{ id: 3165, name: 'x', tags: [], slot: 0, count: 1 }] }, enemies: [player('Soraka', 'Soraka', ['Support'])], gameTime: 900 };
  const out = buyAdvice({ state, build: null, dd });
  assert.ok(!out.items.some((i) => i.id === 3165));
  assert.match(out.notes[0], /Sem build/);
});

test('ouro faltando desconta componentes que você já tem', () => {
  assert.equal(missingGold(dd, 3146, []), 800 + 1100 + 850);
  assert.equal(missingGold(dd, 3146, [3145]), 800 + 850);
  assert.equal(missingGold(dd, 3146, [3145, 1026]), 800);
});

test('remote: busca, cache em disco, merge de counters e tiers, desligado = local', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opgg-test-'));
  let calls = 0;
  const client = {
    laneMeta: async () => { calls += 1; return parseLaneMeta(LANE); },
    analysis: async () => { calls += 1; return parseAnalysis(ANALYSIS); },
  };
  const statuses = [];
  const mk = (enabled = true) => createRemoteData({ cacheDir: dir, isEnabled: () => enabled, client, onStatus: (t, l) => statuses.push(l) });
  const r = mk();
  await r.ensureTiers('middle');
  await r.ensureBuild({ id: 'Akali' }, 'middle');
  await r.ensureBuild({ id: 'Akali' }, 'middle'); // cache fresco
  assert.equal(calls, 2);
  const local = { patch: null, tiers: { middle: { ahri: 'B' } }, counters: {} };
  const m = r.merge(local);
  assert.equal(m.tiers.middle.ahri, 'B'); // meta.json do usuário vence
  assert.equal(m.tiers.middle.yasuo, 'S');
  assert.equal(m.counters.akali.zoe, 1);
  assert.ok(m.counters.akali.irelia < 0);
  r.flushSync(); // gravação em disco é agrupada
  assert.ok(mk().getBuild({ id: 'Akali' }, 'middle').core.length); // lido do disco
  assert.equal(mk(false).merge(local), local);
});

test('remote: falha vira aviso e mantém o cache antigo', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opgg-test-'));
  const statuses = [];
  const r = createRemoteData({
    cacheDir: dir, isEnabled: () => true, onStatus: (t, l) => statuses.push([t, l]),
    client: { analysis: async () => { throw new Error('HTTP 503'); }, laneMeta: async () => ({}) },
  });
  await r.ensureBuild({ id: 'Akali' }, 'middle');
  assert.equal(statuses[0][1], 'warn');
  assert.match(statuses[0][0], /503/);
  assert.equal(r.getBuild({ id: 'Akali' }, 'middle'), null);
});

test('cliente MCP: sessão, SSE e nome do campeão em maiúsculas', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const msg = JSON.parse(body);
      seen.push(msg.method === 'tools/call' ? { args: msg.params.arguments, session: req.headers['mcp-session-id'] } : msg.method);
      if (msg.method === 'initialize') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'abc' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
      }
      if (msg.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: ANALYSIS }] } })}\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const client = createMcpClient({ endpoint: `http://127.0.0.1:${server.address().port}/mcp`, gapMs: 0 });
    const b = await client.analysis({ id: 'MonkeyKing' }, 'top');
    assert.equal(b.core.length, 3);
    const call = seen.find((s) => s.args);
    assert.equal(call.args.champion, 'MONKEYKING');
    assert.equal(call.args.position, 'top');
    assert.equal(call.session, 'abc');
  } finally {
    server.close();
  }
});

test('importador: atualiza a página "LoL Overlay", seleciona e define feitiços (Flash em F)', async () => {
  const calls = [];
  let pages = [{ id: 7, name: 'LoL Overlay · Zed', current: false, isDeletable: true }];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push(`${req.method} ${req.url} ${body}`);
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') return res.end(JSON.stringify(pages));
      res.end(JSON.stringify({ id: 7 }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const creds = { port: server.address().port, token: 't', protocol: 'http' };
  try {
    const b = parseAnalysis(ANALYSIS);
    await importRunes(creds, b.runes, 'Akali');
    const put = calls.find((c) => c.startsWith('PUT /lol-perks/v1/pages/7'));
    assert.ok(put && put.includes('"primaryStyleId":8100') && put.includes('"selectedPerkIds":[8112'));
    assert.ok(calls.some((c) => c.startsWith('PUT /lol-perks/v1/currentpage 7')));
    const s = await importSpells(creds, [4, 14]);
    assert.deepEqual(s, { spell1Id: 14, spell2Id: 4 });
    assert.deepEqual(await importSpells(creds, [14, 4], { flashOnF: false }), { spell1Id: 4, spell2Id: 14 });
    assert.ok(calls.some((c) => c.startsWith('PATCH /lol-champ-select/v1/session/my-selection') && c.includes('"spell2Id":4')));
    await assert.rejects(importRunes(creds, { perks: [1] }, 'X'), /inválidas/);
    await assert.rejects(importSpells(creds, [4]), /inválidos/);
  } finally {
    server.close();
  }
});

test('guia: monta texto/ids para a UI e índice de runas', () => {
  const b = parseAnalysis(ANALYSIS);
  const runeIndex = indexRunes([{ id: 8100, name: 'Domínio', icon: 'a.png', slots: [{ runes: [{ id: 8112, name: 'Eletrocutar', icon: 'b.png' }] }] }]);
  const g = buildGuide({ champ: { id: 'Akali', name: 'Akali' }, role: 'middle', build: b, dd, runeIndex });
  assert.equal(g.runes.perks[0].name, 'Eletrocutar');
  assert.equal(g.spells[0].key, 'SummonerFlash');
  assert.equal(g.core[0].name, 'Hextech Gunblade');
  assert.equal(buildGuide({ champ: null, build: b }), null);
});

test('settings: painéis do overlay, modo e tecla do Flash são validados', () => {
  const { sanitize, DEFAULTS } = require('../src/settings');
  const a = sanitize({ overlay: { panels: { buys: { x: 120.4, y: '300', scale: 9 } } }, flashKey: 'D' }, DEFAULTS);
  assert.deepEqual(a.overlay.panels.buys, { x: 120, y: 300, scale: 2.5 });
  assert.equal(a.overlay.panels.info, null);
  assert.equal(a.flashKey, 'D');
  assert.equal(sanitize({ flashKey: 'X' }, a).flashKey, 'F');
  assert.equal(sanitize({ overlay: { mode: 'always' } }, a).overlay.mode, 'always');
  assert.equal(sanitize({ overlay: { mode: 'nada' } }, a).overlay.mode, 'tab');
  assert.equal(sanitize({ overlay: { panels: { buys: { x: 'a', y: 1 } } } }, a).overlay.panels.buys, null);
  assert.deepEqual(sanitize({ overlay: { panels: { buys: { x: -5, y: 99999 } } } }, a).overlay.panels.buys, { x: 0, y: 10000, scale: 1 });
});

const { parseTierList } = require('../src/providers/opggMcp');
test('tier list do OP.GG: todas as rotas com WR, pick, ban e rank', () => {
  const text = 'class LolListLaneMetaChampions: data\nclass Data: positions\nclass Positions: mid,adc\nclass Mid: champion,play,win_rate,pick_rate,role_rate,ban_rate,kda,tier,rank,rank_prev\nclass Adc: champion,play,win_rate,pick_rate,role_rate,ban_rate,kda,tier,rank,rank_prev\n\nLolListLaneMetaChampions(Data(Positions([Mid("Ahri",58465,0.51,0.1,0.95,0.03,2.54,1,1,1),Mid("Zed",48422,0.49,0.08,0.69,0.24,2.15,2,15,15)],[Adc("Jinx",50000,0.52,0.12,0.9,0.05,2.5,1,1,3)])))';
  const t = parseTierList(text);
  assert.equal(t.middle.length, 2);
  assert.equal(t.middle[0].champion, 'Ahri');
  assert.equal(t.middle[1].tier, 2);
  assert.equal(t.bottom[0].rankPrev, 3);
  assert.equal(t.bottom[0].banRate, 0.05);
});

const { parseGameDetail } = require('../src/providers/opggMcp');
test('detalhe de partida do OP.GG: times, jogador em foco e oponente de rota', () => {
  const d = parseGameDetail(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'opgg-game-detail.txt'), 'utf8'));
  assert.equal(d.duration, 2137);
  const me = d.teams.flatMap((t) => t.players).find((p) => p.target);
  assert.equal(me.champion, 'Ahri');
  assert.equal(me.stats.damage, 39963);
  assert.equal(me.stats.cs, 238);
  const opp = d.teams.find((t) => t.key !== me.team).players.find((p) => p.position === me.position);
  assert.equal(opp.champion, 'Fizz');
  assert.equal(d.teams[0].dragons, 4);
});

const { reviewMatch } = require('../src/matchReview');
test('revisão OP.GG: compara com o oponente de rota e objetivos', () => {
  const d = parseGameDetail(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'opgg-game-detail.txt'), 'utf8'));
  const r = reviewMatch(d, { coreOf: () => [3157, 4645, 6655], itemName: (id) => `#${id}` });
  assert.equal(r.opp.champion, 'Fizz');
  const bad = r.bad.map((b) => b.title);
  assert.ok(bad.includes('Menos dano que o oponente'), bad.join());
  assert.ok(bad.includes('Atrás em ouro'));
  assert.ok(bad.includes('Dragões perdidos'));
  assert.ok(r.good.some((g) => g.title === 'Build do meta'));
});

const { summarize, ultRank } = require('../src/providers/meraki');
test('Meraki: recargas por nível e rank da ult', () => {
  const s = summarize({ positions: ['MIDDLE'], adaptiveType: 'MAGIC_DAMAGE', abilities: { Q: [{ name: 'Orb', cooldown: { modifiers: [{ values: [7, 7, 7, 7, 7] }] } }], R: [{ name: 'Spirit Rush', cooldown: { modifiers: [{ values: [130, 115, 100] }] } }] } });
  assert.deepEqual(s.abilities[3].cooldowns, [130, 115, 100]);
  assert.equal(s.adaptiveType, 'MAGIC_DAMAGE');
  assert.equal(ultRank(11), 2);
});

const { absLp, weekStats, createEloTracker } = require('../src/elo');
test('elo: PDL absoluto, saldo e sequência', () => {
  assert.equal(absLp({ tier: 'EMERALD', division: 'I', lp: 14 }), 5 * 400 + 300 + 14);
  assert.equal(absLp({ tier: 'MASTER', lp: 50 }), 2850);
  const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'elo-'));
  let t = Date.now() - 2 * 24 * 3600 * 1000;
  const tr = createEloTracker({ dir, now: () => t });
  tr.record({ tier: 'GOLD', division: 'II', lp: 40, wins: 10, losses: 10 });
  t = Date.now();
  tr.record({ tier: 'GOLD', division: 'I', lp: 10, wins: 13, losses: 11 });
  assert.equal(tr.summary().week, 70);
  const now = Date.now();
  const g = (res, champ, daysAgo) => ({ type: 'SOLORANKED', createdAt: new Date(now - daysAgo * 864e5).toISOString(), me: { champion: champ, stats: { result: res } } });
  const w = weekStats([g('WIN', 'Ahri', 0), g('WIN', 'Ahri', 1), g('LOSE', 'Zed', 1), g('LOSE', 'Zed', 2), g('WIN', 'Lux', 3), g('WIN', 'Lux', 3), g('LOSE', 'Lux', 9)], now);
  assert.deepEqual(w.streak, { wins: true, count: 2 });
  assert.equal(w.best[0].champion, 'Ahri');
  assert.equal(w.weekGames, 6);
});

test('página de runas: jogos, pick % e win %', () => {
  const { parseRunePage, parseChampStats } = require('../src/providers/opggMcp');
  const txt = 'class LolGetChampionAnalysis: data\nclass Data: runes\nclass Runes: play,pick_rate,primary_page_id,primary_page_name,primary_rune_ids,secondary_page_id,secondary_page_name,secondary_rune_ids,stat_mod_ids,win\n\n'
    + 'LolGetChampionAnalysis(Data(Runes(1000,0.4,8100,"Domination",[8112,8139,8140,8106],8200,"Sorcery",[8226,8210],[5005,5008,5001],520)))';
  const p = parseRunePage(txt);
  assert.equal(p.perks.length, 9);
  assert.equal(p.games, 1000);
  assert.equal(p.pickRate, 0.4);
  assert.ok(Math.abs(p.winRate - 0.52) < 1e-9);
  const st = parseChampStats('class X: data\nclass Data: summary\nclass Summary: average_stats\nclass AverageStats: play,win_rate,pick_rate,ban_rate,tier,rank\n\nX(Data(Summary(AverageStats(300,0.53,0.02,0.01,2,7))))');
  assert.deepEqual([st.tier, st.rank, st.games, st.winRate], [2, 7, 300, 0.53]);
});

test('2 páginas de runas diferentes e tier list por elo', async () => {
  const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-'));
  const page = (k, pick) => ({ primaryStyleId: 8100, subStyleId: 8200, perks: [k, 1, 2, 3, 4, 5, 6, 7, 8], pickRate: pick, games: 10, winRate: 0.5 });
  const seen = [];
  const client = {
    runes: async (_c, _r, tier) => { seen.push(tier); return tier === 'GOLD' ? page(8128, 0.2) : page(8112, 0.5); },
    champStats: async (c) => (c.id === 'Zed' ? null : { tier: c.id === 'Ahri' ? 1 : 3, rank: 1, winRate: 0.5, pickRate: 0.1, banRate: 0, games: 100, kda: 3 }),
  };
  const r = createRemoteData({ cacheDir: dir2, isEnabled: () => true, client });
  await r.ensureRunePages({ id: 'Ahri' }, 'middle');
  const pages = r.getRunePages({ id: 'Ahri' }, 'middle');
  assert.equal(pages.length, 2);
  assert.equal(pages[0].perks[0], 8112);
  assert.equal(pages[1].perks[0], 8128);
  assert.equal(pages[1].tier, 'GOLD');
  assert.equal(seen[0], null); // primeiro o elo padrão (Esmeralda+)
  await r.ensureTierListElo('middle', 'GOLD', [{ id: 'Lux', champion: 'LUX' }, { id: 'Ahri', champion: 'AHRI' }, { id: 'Zed', champion: 'ZED' }]);
  const tl = r.getTierListElo('middle', 'GOLD');
  assert.deepEqual(tl.data.map((x) => x.champion), ['AHRI', 'LUX']);
});

test('compras: 1º item do meta antes de defesa completa quando ninguém está fed', () => {
  const build = parseAnalysis(ANALYSIS);
  const enemies = [
    player('Irelia', 'Irelia', ['Fighter'], { position: 'TOP', scores: { kills: 1, deaths: 1, assists: 0 } }),
    player('Zed', 'Zed', ['Assassin']), player('Jinx', 'Jinx', ['Marksman']), player('Lux', 'Lux', ['Mage']), player('Thresh', 'Thresh', ['Support']),
  ];
  const out = buyAdvice({ state: { me: ME, enemies, gameTime: 120 }, build, dd });
  assert.equal(out.items[0].id, 3146);
  assert.match(out.items[0].reason, /1º item/);
});
