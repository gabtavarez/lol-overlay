const fs = require('fs');
const path = require('path');
const { goldCompare } = require('./goldDiff');
const { targetsFor } = require('./goals');

const SAMPLE_EVERY = 30; // s de jogo
const MAX_GAMES = 40;

const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const k = (g) => `${g >= 0 ? '+' : '−'}${(Math.abs(g) / 1000).toFixed(1)}k`;

/** Análise do que ajudou e do que prejudicou, com a evidência de cada ponto. */
function analyze(rec) {
  const good = [];
  const bad = [];
  const min = Math.max(1, rec.duration / 60);
  const role = rec.role;
  const { kills, deaths, assists, cs } = rec.final;
  const csm = cs / min;
  if (role !== 'utility' && role !== 'jungle') {
    if (csm >= 7.5) good.push({ title: 'Farm forte', text: `${csm.toFixed(1)} CS/min` });
    else if (csm < 5.5) bad.push({ title: 'Farm baixo', text: `${csm.toFixed(1)} CS/min: cada onda perdida são ~${Math.round(125)} g` });
  }
  if (deaths >= 7) bad.push({ title: 'Muitas mortes', text: `${deaths} mortes: ${Math.round(deaths * 300)} g de abate entregues ao inimigo (aprox.)` });
  else if (deaths <= 2 && rec.duration > 900) good.push({ title: 'Jogou seguro', text: `só ${deaths} morte${deaths === 1 ? '' : 's'}` });
  if (rec.teamKills > 0) {
    const kp = (kills + assists) / rec.teamKills;
    if (kp >= 0.6) good.push({ title: 'Presente nas lutas', text: `${Math.round(kp * 100)}% de participação em abates` });
    else if (kp < 0.35 && role !== 'top') bad.push({ title: 'Pouca participação', text: `${Math.round(kp * 100)}% de participação em abates` });
  }
  const at = (t) => rec.samples.reduce((best, s) => (Math.abs(s.t - t) < Math.abs((best || { t: 1e9 }).t - t) ? s : best), null);
  for (const t of [600, 900]) {
    const s = at(t);
    if (!s || Math.abs(s.t - t) > 60 || s.lane === null) continue;
    if (s.lane >= 700) good.push({ title: `Rota ganha aos ${t / 60} min`, text: `${k(s.lane)} em itens contra ${rec.opponent || 'o oponente'}` });
    else if (s.lane <= -700) bad.push({ title: `Rota perdida aos ${t / 60} min`, text: `${k(s.lane)} em itens contra ${rec.opponent || 'o oponente'}` });
  }
  const maxTeam = Math.max(0, ...rec.samples.map((s) => s.team));
  const minTeam = Math.min(0, ...rec.samples.map((s) => s.team));
  if (rec.result === 'Lose' && maxTeam >= 3000) bad.push({ title: 'Throw', text: `o time chegou a ${k(maxTeam)} e perdeu` });
  if (rec.result === 'Win' && minTeam <= -3000) good.push({ title: 'Virada', text: `o time esteve ${k(minTeam)} e venceu` });
  if (rec.firstDeath !== null && rec.firstDeath < 300) bad.push({ title: 'Morte cedo', text: `primeira morte aos ${fmtT(rec.firstDeath)}` });
  const wpm = rec.final.wards / min;
  if (role === 'utility' ? wpm < 1 : wpm < 0.35) bad.push({ title: 'Pouca visão', text: `placar de visão ${rec.final.wards.toFixed ? rec.final.wards.toFixed(0) : rec.final.wards} (${wpm.toFixed(2)}/min)` });
  return { good, bad };
}

/** Grava amostras durante a partida e salva o resumo quando ela termina. */
function createRecorder({ dir, dd = () => null, log = () => {} }) {
  const file = path.join(dir, 'history.json');
  let history = [];
  try { history = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { history = []; }
  let cur = null;

  function save() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(history));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) { log(`histórico não salvo: ${err.message}`); }
  }

  function sample(state, role) {
    if (!state || state.phase !== 'ingame') return;
    if (!cur || state.gameTime + 30 < cur.last.gameTime) cur = { samples: [], last: state, role: role || '' };
    cur.last = state;
    if (role) cur.role = role;
    const prev = cur.samples[cur.samples.length - 1];
    if (prev && state.gameTime - prev.t < SAMPLE_EVERY) return;
    const g = goldCompare(state, dd());
    const lane = g && g.lanes.find((l) => l.ally && l.ally.me);
    cur.samples.push({ t: state.gameTime, team: g ? g.team.diff : 0, lane: lane && lane.enemy ? lane.diff : null, kills: state.me.scores.kills, deaths: state.me.scores.deaths });
  }

  /** Chamado quando a partida termina. Retorna o registro salvo (ou null se foi curta demais). */
  function finish({ tier } = {}) {
    const c = cur;
    cur = null;
    if (!c || c.last.gameTime < 300) return null;
    const s = c.last;
    const me = s.me;
    const end = (s.events || []).find((e) => e.name === 'GameEnd');
    const firstDeath = (s.events || []).filter((e) => e.name === 'ChampionKill' && (e.victim === me.gameName || e.victim === me.name)).map((e) => e.time)[0];
    const opp = s.laneOpponent;
    const rec = {
      id: `${Date.now()}`,
      at: Date.now(),
      mode: s.gameMode,
      duration: s.gameTime,
      result: end ? end.result : null,
      champion: { id: me.championId, name: me.champion },
      role: c.role,
      opponent: opp ? opp.champion : null,
      opponentId: opp ? opp.championId : null,
      final: { ...me.scores, wards: me.wards || 0, level: me.level, items: me.items.map((i) => i.id) },
      teamKills: (s.teamKills && s.teamKills.mine) || 0,
      firstDeath: firstDeath === undefined ? null : firstDeath,
      samples: c.samples,
      version: s.assets && s.assets.version,
    };
    const t = targetsFor(tier, rec.role);
    const min = Math.max(1, rec.duration / 60);
    rec.goals = { tier: tier || null, aimTier: t.aimTier, cs: t.cs === null ? null : { now: +(rec.final.cs / min).toFixed(1), target: t.cs }, vision: { now: +((rec.final.wards || 0) / min).toFixed(2), target: t.vision } };
    rec.analysis = analyze(rec);
    history = [rec, ...history].slice(0, MAX_GAMES);
    save();
    log(`pós-partida salvo: ${rec.champion.name} ${rec.result || '?'} ${fmtT(rec.duration)}`);
    return rec;
  }

  return { sample, finish, list: () => history, get: (id) => history.find((h) => h.id === id) || null };
}

module.exports = { createRecorder, analyze };
