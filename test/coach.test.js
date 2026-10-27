const test = require('node:test');
const assert = require('node:assert');
const { laneCoach } = require('../src/coach');

const items = { 3157: { name: 'Ampulheta de Zhonya', gold: { total: 3250 } }, 6692: { name: 'Eclipse', gold: { total: 2900 } }, 1001: { name: 'Botas', gold: { total: 300 } } };
const dd = { item: (id) => items[id] || null };
const P = (o) => ({ scores: { kills: 0, deaths: 0, assists: 0, cs: 0 }, items: [], spells: [], level: 1, tags: [], ...o });

function base(over = {}) {
  const me = P({ name: 'Eu#BR1', gameName: 'Eu', champion: 'Ahri', championId: 'Ahri', tags: ['Mage'], position: 'MIDDLE', team: 'ORDER', level: 6, gold: 300, hp: 0.8, scores: { kills: 0, deaths: 0, assists: 0, cs: 50 } });
  const opp = P({ name: 'Zed#BR1', gameName: 'Zed', riotId: 'Zed#BR1', champion: 'Zed', championId: 'Zed', tags: ['Assassin'], position: 'MIDDLE', team: 'CHAOS', level: 5, spells: ['SummonerFlash', 'SummonerDot'], scores: { kills: 0, deaths: 0, assists: 0, cs: 46 } });
  const lee = P({ name: 'Lee#BR1', gameName: 'Lee', champion: 'Lee Sin', championId: 'LeeSin', position: 'JUNGLE', team: 'CHAOS', spells: ['SummonerFlash', 'SummonerSmite'] });
  const top = P({ name: 'Garen#BR1', gameName: 'Garen', champion: 'Garen', championId: 'Garen', position: 'TOP', team: 'ORDER' });
  return { phase: 'ingame', gameMode: 'CLASSIC', gameTime: 360, me, allies: [top], enemies: [opp, lee], laneOpponent: opp, events: [], ...over };
}

test('coach: nível 6 primeiro = all-in', () => {
  const c = laneCoach(base(), { dd, tier: 'GOLD', role: 'middle' });
  assert.equal(c.tone, 'go');
  assert.match(c.head, /ult/);
  assert.ok(c.rows.some((r) => r.label === 'Níveis'));
});

test('coach: oponente com ult e você não = recue', () => {
  const s = base();
  s.me.level = 5; s.laneOpponent.level = 6;
  const c = laneCoach(s, { dd, tier: 'GOLD', role: 'middle' });
  assert.equal(c.tone, 'bad');
});

test('coach: vida baixa contra Incendiar vence o resto', () => {
  const s = base();
  s.me.hp = 0.2;
  const c = laneCoach(s, { dd, role: 'middle' });
  assert.equal(c.tone, 'bad');
  assert.match(c.head, /Incendiar/);
});

test('coach: Flash marcado aparece com o tempo de volta', () => {
  const s = base();
  s.me.level = 5;
  const c = laneCoach(s, { dd, role: 'middle', marks: { 'Zed#BR1:SummonerFlash': 360 + 200 } });
  assert.match(c.head, /sem Flash/);
  assert.ok(c.rows.find((r) => /Flash volta em 3:20/.test(r.text)));
});

test('coach: pico de item do oponente', () => {
  const s = base();
  s.me.level = 9; s.laneOpponent.level = 9; s.gameTime = 600;
  s.laneOpponent.items = [{ id: 6692 }];
  const c = laneCoach(s, { dd, role: 'middle' });
  assert.equal(c.tone, 'bad');
  assert.match(c.head, /Eclipse/);
});

test('coach: caçador visto no topo libera o seu lado; oponente morto = pressione', () => {
  const s = base();
  s.me.level = 5;
  s.gameTime = 280;
  s.events = [{ name: 'ChampionKill', time: 265, killer: 'Lee', victim: 'Garen', assisters: [] }];
  let c = laneCoach(s, { dd, role: 'middle' });
  assert.ok(c.rows.find((r) => r.label === 'Caçador' && /topo/.test(r.text)));
  s.laneOpponent.isDead = true; s.laneOpponent.respawnTimer = 14;
  c = laneCoach(s, { dd, role: 'middle' });
  assert.equal(c.label, 'Pressione');
});

test('coach: fora do Summoner\'s Rift não aparece', () => {
  assert.equal(laneCoach(base({ gameMode: 'ARAM' }), { dd }), null);
});
