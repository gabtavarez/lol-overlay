const $ = (id) => document.getElementById(id);

// ?preview=<painel>&v=<patch>: mostra só aquele painel com dados de exemplo (usado nas Configurações para explicar cada overlay).
const PARAMS = new URLSearchParams(location.search);
const PREVIEW_ONLY = PARAMS.get('preview');
if (!window.overlay) {
  const noop = () => {};
  window.overlay = new Proxy({}, { get: (_t, k) => (k === 'getSettings' ? async () => ({}) : noop) });
}
const boxes = { buys: $('buys'), info: $('info'), gold: $('goldbox'), timers: $('timersbox'), kit: $('kitbox'), goals: $('goalsbox'), coach: $('coachbox') };
let enabled = {};
const extras = { recall: $('recall'), matchup: $('matchup'), alerts: $('alerts') };

const BASE_WIDTH = 330;
let lastState = null;
let moving = false;
let previewing = false;
let panels = { buys: null, info: null, gold: null, timers: null, kit: null, goals: null, coach: null };
let dragging = false;
let lastCoachSig = null;
let full = true; // false = só o coach fixo na tela (TAB solto)

// Partida de exemplo (modo mover/testar e as prévias das Configurações): Ahri x Zed aos 14 min.
function sampleState(version) {
  const v = version || PARAMS.get('v') || null;
  const enemy = (championId, champion, spells, k, d, a, level) => ({ championId, champion, riotId: `${champion}#BR1`, spells, level, scores: { kills: k, deaths: d, assists: a }, items: [] });
  const enemies = [enemy('Darius', 'Darius', ['SummonerFlash', 'SummonerTeleport'], 2, 1, 0, 11), enemy('LeeSin', 'Lee Sin', ['SummonerFlash', 'SummonerSmite'], 3, 2, 4, 10),
    enemy('Zed', 'Zed', ['SummonerFlash', 'SummonerDot'], 4, 1, 1, 11), enemy('Jinx', 'Jinx', ['SummonerFlash', 'SummonerHeal'], 1, 2, 2, 9), enemy('Thresh', 'Thresh', ['SummonerFlash', 'SummonerExhaust'], 0, 2, 5, 8)];
  const allies = ['Garen', 'Vi', 'Ahri', 'Caitlyn', 'Lux'];
  const golds = [[4800, 5100], [4300, 4600], [5200, 6100], [4500, 4100], [2900, 2700]];
  return {
    phase: 'ingame', gameTime: 845, gameMode: 'CLASSIC', assets: { version: v },
    me: { championId: 'Ahri', champion: 'Ahri', gold: 1240, level: 10 }, enemies, laneOpponent: enemies[2], spellCd: { SummonerFlash: 300 },
    advice: {
      buys: {
        items: [
          { id: 3157, name: 'Ampulheta de Zhonya', reason: 'Zhonya na marca do ult de Zed: anula o combo', good: { key: 'burst', label: 'Assassinos' }, vs: ['Zed'], score: 88, missing: 1250, needGold: 10, canBuy: false, parts: ['Tomo Amplificador'] },
          { id: 3020, name: 'Sapatos do Feiticeiro', reason: 'Rota sob controle: bota ofensiva do meta · hora de fechar a bota', score: 76, missing: 800, needGold: 0, canBuy: true, parts: ['Botas'] },
          { id: 4645, name: 'Chama Sombria', reason: 'Build do meta · 41% dos jogadores', score: 70, missing: 2900, needGold: 1660, canBuy: false },
        ],
        recall: 'Você tem 1240 g: volte e compre Sapatos do Feiticeiro.',
        matchup: { vs: 'Zed', tip: 'Guarde o E para quando ele usar a sombra (W).' }, notes: [],
      },
      alerts: [{ text: 'Darius fechou Armadura de Espinhos: corta a sua cura' }],
      gold: { team: { diff: -1100 }, lanes: ['Topo', 'Selva', 'Meio', 'Atirador', 'Suporte'].map((role, i) => ({
        role, ally: { champId: allies[i], gold: golds[i][0], me: i === 2 }, enemy: { champId: enemies[i].championId, gold: golds[i][1] }, diff: golds[i][0] - golds[i][1] })) },
      timers: [{ key: 'dragon', label: 'Dragão', in: 75 }, { key: 'herald', label: 'Arauto', in: 55 }, { key: 'baron', label: 'Barão', in: 355 }],
      phases: [{ label: 'Early', verdict: 'theirs', text: 'Zed mais forte' }, { label: 'Mid', verdict: 'even', text: 'Equilibrado' }, { label: 'Late', verdict: 'mine', text: 'Você mais forte' }],
      scout: [{ who: 'Rota', champion: 'Zed', riotId: 'Zed#BR1', profile: { tier: 'EMERALD', division: 2, lp: 40, wins: 120, losses: 98, hot: true, champs: [] }, onChamp: { games: 80, wins: 46 } }],
      oppKit: { champion: 'Zed', source: 'Meraki', abilities: [{ key: 'Q', name: 'Shuriken Laminar', cd: '6 s' }, { key: 'W', name: 'Sombra Viva', cd: '20→15 s' }, { key: 'E', name: 'Corte Sombrio', cd: '5→3 s' }, { key: 'R', name: 'Marca da Morte', cd: '120→80 s' }], ult: { rank: 2, cd: 100 } },
      coach: { tone: 'go', label: 'All-in', vs: 'Zed', head: 'Você tem ult e Zed não: janela de all-in.', rows: [
        { label: 'Níveis', text: 'Você 6 · Zed 5' },
        { label: 'Feitiços de Zed', text: 'Flash volta em 3:32 · Incendiar pronto' },
        { label: 'Caçador', text: 'Lee Sin apareceu no topo há 18 s: seu lado está livre.' },
        { label: 'Farm', text: '96 CS · 6.8/min (meta 7.5) · +4 contra Zed' }] },
      goals: { aimTier: 'DIAMOND', cs: { now: 6.8, target: 7.5, diff: -10, ok: false }, vision: { now: 0.62, target: 0.6, ok: true } },
    },
  };
}

const fmtK = (g) => (g >= 1000 ? `${(g / 1000).toFixed(1)}k` : String(g));
const signed = (d) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${fmtK(Math.abs(d))}`;

function goldSide(p, version, cls) {
  const img = p && p.champId && version ? h('img', { class: 'g-champ', src: champIcon(version, p.champId), alt: p.name, title: p.name }) : h('span', { class: 'g-champ' });
  return h('div', { class: `g-side ${cls}${p && p.me ? ' me' : ''}` }, img, h('span', { class: 'g-val', text: p ? fmtK(p.gold) : '—' }));
}

function renderGold(gold, version) {
  if (!gold) return;
  const td = $('team-diff');
  td.textContent = signed(gold.team.diff);
  td.className = gold.team.diff >= 0 ? 'up' : 'down';
  const max = Math.max(1000, ...gold.lanes.map((l) => Math.abs(l.diff)));
  $('gold-rows').replaceChildren(...gold.lanes.map((l) => {
    const pct = Math.round((Math.abs(l.diff) / max) * 50);
    const bar = h('div', { class: 'g-bar' }, h('div', { class: `g-fill ${l.diff >= 0 ? 'up' : 'down'}`, style: l.diff >= 0 ? `left:50%;width:${pct}%` : `right:50%;width:${pct}%` }));
    return h('div', { class: 'g-row' },
      goldSide(l.ally, version, 'ally'),
      h('div', { class: 'g-mid' }, h('div', { class: `g-diff ${l.diff >= 0 ? 'up' : 'down'}`, text: signed(l.diff) }), bar, h('div', { class: 'g-role', text: l.role })),
      goldSide(l.enemy, version, 'enemy'));
  }));
}

/* ---------- habilidades do oponente e metas ---------- */
function renderKit(kit) {
  if (!kit) return;
  $('kit-src').textContent = kit.champion;
  $('kit').replaceChildren(...kit.abilities.map((a) => h('div', { class: `k-row${a.key === 'R' ? ' ult' : ''}` }, h('b', { text: a.key }), h('span', { class: 'k-name', text: a.name }), h('span', { class: 'k-cd', text: a.key === 'R' && kit.ult && kit.ult.cd ? `${kit.ult.cd} s agora` : a.cd }))));
}
const TIER_PT = { IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro', PLATINUM: 'Platina', EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante' };
function renderGoals(g) {
  if (!g) return;
  $('goals-aim').textContent = `ritmo de ${TIER_PT[g.aimTier] || g.aimTier}`;
  const row = (label, now, target, ok, extra) => h('div', { class: 'g-goal' }, h('span', { text: label }), h('b', { class: ok ? 'up' : 'down', text: String(now) }), h('span', { class: 'muted', text: `meta ${target}${extra || ''}` }));
  $('goals').replaceChildren(
    ...(g.cs ? [row('CS/min', g.cs.now, g.cs.target, g.cs.ok, ` · ${g.cs.diff >= 0 ? '+' : ''}${g.cs.diff} CS`)] : []),
    row('Visão/min', g.vision.now, g.vision.target, g.vision.ok));
}

/* ---------- coach de rota ---------- */
function renderCoach(c) {
  if (!c) return;
  $('coach-vs').textContent = c.vs ? `vs ${c.vs}` : '';
  const pill = $('coach-pill');
  pill.textContent = c.label;
  pill.className = `c-pill ${c.tone}`;
  $('coach-head').textContent = c.head;
  $('coach-rows').replaceChildren(...(c.rows || []).map((r) => h('div', { class: 'c-row' }, h('b', { text: r.label }), h('span', { text: r.text }))));
}

/* ---------- rota: fases + scouting ---------- */
function renderInfo(advice, state) {
  const ph = advice.phases;
  $('phases').hidden = !ph;
  if (ph) $('phases').replaceChildren(...ph.map((p) => h('div', { class: `ph ${p.verdict}` }, h('b', { text: p.label }), h('span', { text: p.text }))));
  $('info-vs').textContent = state && state.laneOpponent ? `vs ${state.laneOpponent.champion}` : '';
  const kit = advice.oppKit;
  const ultLine = kit && kit.ult && kit.ult.cd ? h('div', { class: 'note', text: `Ult de ${kit.champion}: ${kit.ult.cd} s de recarga (rank ${kit.ult.rank})` }) : null;
  const sc = advice.scout || [];
  $('scout').hidden = !sc.length && !ultLine;
  $('scout').replaceChildren(...(ultLine ? [ultLine] : []), ...sc.map((x) => {
    const p = x.profile;
    const rank = p && p.tier ? `${p.tier[0]}${p.tier.slice(1).toLowerCase()} ${p.division || ''}` : p ? 'Sem elo' : x.error || '…';
    const wr = p && p.wins + p.losses ? ` · ${Math.round((p.wins / (p.wins + p.losses)) * 100)}%` : '';
    const on = x.onChamp ? ` · ${x.onChamp.games} jogos de ${x.champion}` : p ? ` · novo de ${x.champion}?` : '';
    return h('div', { class: 'sc-row' }, h('b', { text: `${x.who}: ${x.champion}` }), h('span', { text: `${rank}${wr}${on}${p && p.hot ? ' · em sequência' : ''}` }));
  }));
}

/* ---------- timers: objetivos + feitiços do inimigo (clique ou Ctrl+Shift+1..5 para o Flash) ---------- */
const marks = new Map(); // `${riotId}:${spell}` -> pronto no tempo de jogo
let markGame = 0;
const SPELL_NAME = { SummonerFlash: 'Flash', SummonerDot: 'Incendiar', SummonerHeal: 'Curar', SummonerBarrier: 'Barreira', SummonerExhaust: 'Exaustão', SummonerBoost: 'Purificar', SummonerHaste: 'Fantasma', SummonerTeleport: 'Teleporte', SummonerSmite: 'Golpear', SummonerMana: 'Clareza', SummonerSnowball: 'Marcar' };
const mm = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function markSpell(enemy, spell) {
  const cd = (lastState.spellCd || {})[spell] || 300;
  const key = `${enemy.riotId || enemy.champion}:${spell}`;
  if (marks.has(key) && marks.get(key) > lastState.gameTime) marks.delete(key); // clicar de novo desmarca
  else marks.set(key, lastState.gameTime + cd);
  renderTimers(lastState);
  if (lastState.phase === 'ingame' && !moving && !previewing) window.overlay.reportSpellMarks(Object.fromEntries(marks));
}

function renderTimers(state) {
  if (!state) {
    $('obj').replaceChildren(h('div', { class: 't-obj' }, h('span', { text: 'Dragão' }), h('b', { text: '1:20' })), h('div', { class: 't-obj' }, h('span', { text: 'Barão' }), h('b', { text: '12:40' })));
    $('spells').replaceChildren(h('div', { class: 'note', text: 'Feitiços dos inimigos aparecem aqui.' }));
    return;
  }
  if (state.gameTime + 30 < markGame) marks.clear(); // nova partida
  markGame = state.gameTime;
  const v = state.assets.version;
  $('obj').replaceChildren(...((state.advice && state.advice.timers) || []).map((t) => h('div', { class: `t-obj${t.in === 0 ? ' live' : ''}` }, h('span', { text: t.label }), h('b', { text: t.in === 0 ? 'vivo' : mm(t.in) }))));
  $('spells').replaceChildren(...state.enemies.map((e) => h('div', { class: 't-enemy' },
    e.championId && v ? h('img', { class: 't-champ', src: champIcon(v, e.championId), alt: '' }) : h('span', { class: 't-champ' }),
    ...(e.spells || []).map((sp) => {
      const left = (marks.get(`${e.riotId || e.champion}:${sp}`) || 0) - state.gameTime;
      const b = h('button', { class: `t-spell${left > 0 ? ' down' : ''}`, type: 'button', title: SPELL_NAME[sp] || sp },
        v ? h('img', { src: `https://ddragon.leagueoflegends.com/cdn/${v}/img/spell/${sp}.png`, alt: '' }) : h('span'),
        left > 0 ? h('span', { class: 't-left', text: mm(left) }) : null);
      b.addEventListener('click', () => markSpell(e, sp));
      return b;
    }))));
}
window.overlay.onSpellMark(({ index, spell }) => {
  const e = lastState && lastState.enemies && lastState.enemies[index];
  if (e && lastState.phase === 'ingame') markSpell(e, (e.spells || []).includes(spell) ? spell : (e.spells || [])[0]);
});

function defaults() {
  const y = Math.round(window.innerHeight * 0.3);
  return { buys: { x: 18, y, scale: 1 }, info: { x: 18, y: y + 420, scale: 1 }, gold: { x: window.innerWidth - 300, y, scale: 1 }, timers: { x: window.innerWidth - 300, y: Math.max(10, y - 250), scale: 1 }, kit: { x: 362, y: Math.max(10, y - 170), scale: 1 }, goals: { x: 362, y: y + 10, scale: 1 }, coach: { x: Math.round(window.innerWidth / 2 - 160), y: 12, scale: 1 } };
}

function apply(name) {
  const p = panels[name] || defaults()[name];
  const el = boxes[name];
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
  el.style.transform = `scale(${p.scale})`;
}

function draw() {
  const inGame = lastState && lastState.phase === 'ingame';
  const advice = (lastState && lastState.advice) || {};
  const hasInfo = Boolean((advice.buys && advice.buys.matchup) || (advice.alerts && advice.alerts.length) || advice.phases || (advice.scout && advice.scout.length) || advice.oppKit);

  const sample = moving || previewing;
  boxes.buys.hidden = !inGame && !sample;
  boxes.info.hidden = !(sample || (inGame && hasInfo));
  boxes.gold.hidden = !(sample || (inGame && advice.gold));
  boxes.timers.hidden = !(sample || (inGame && ((advice.timers && advice.timers.length) || lastState.enemies.length)));
  boxes.kit.hidden = !(sample || (inGame && advice.oppKit));
  boxes.goals.hidden = !(sample || (inGame && advice.goals));
  boxes.coach.hidden = !(sample || (inGame && advice.coach));
  for (const [name, el] of Object.entries(boxes)) if (enabled[name] === false) el.hidden = true; // desligado em Configurações > Overlays
  if (!full && !sample) for (const [name, el] of Object.entries(boxes)) if (name !== 'coach') el.hidden = true;
  for (const b of Object.values(boxes)) b.classList.toggle('moving', moving);
  $('edit-bar').hidden = !moving;

  // Só o coach na tela (TAB solto): redesenha apenas quando o conselho muda, não a cada leitura do jogo.
  if (inGame && !sample && !full) {
    const sig = JSON.stringify(advice.coach || null);
    if (sig === lastCoachSig) return;
    lastCoachSig = sig;
    renderCoach(advice.coach);
    return;
  }
  lastCoachSig = null;
  if (inGame && !sample) {
    $('gold').textContent = `${lastState.me.gold} g`;
    renderBuyList($('list'), advice.buys, lastState.assets.version);
    renderExtras(extras, advice);
    renderGold(advice.gold, lastState.assets.version);
    renderInfo(advice, lastState);
    renderTimers(lastState);
    renderKit(advice.oppKit);
    renderGoals(advice.goals);
    renderCoach(advice.coach);
  } else if (sample) {
    const st = sampleState(lastState && lastState.assets && lastState.assets.version);
    const v = st.assets.version;
    $('gold').textContent = `${st.me.gold} g`;
    renderBuyList($('list'), st.advice.buys, v);
    renderExtras(extras, st.advice);
    renderGold(st.advice.gold, v);
    renderInfo(st.advice, st);
    if (!marks.size) marks.set('Zed#BR1:SummonerFlash', st.gameTime + 212); // exemplo: Flash do Zed marcado
    renderTimers(st);
    renderKit(st.advice.oppKit);
    renderGoals(st.advice.goals);
    renderCoach(st.advice.coach);
  }
  if (PREVIEW_ONLY) {
    for (const [name, el] of Object.entries(boxes)) el.hidden = name !== PREVIEW_ONLY;
    $('edit-bar').hidden = true;
  }
}

/* ---------- arrastar e redimensionar (também durante a partida, com TAB pressionado) ---------- */

function save() {
  window.overlay.setSettings({ overlay: { panels } });
}

function current(name) {
  const r = boxes[name].getBoundingClientRect();
  const p = panels[name] || defaults()[name];
  return { x: r.left, y: r.top, scale: p.scale };
}

for (const [name, el] of Object.entries(boxes)) {
  el.addEventListener('pointerenter', () => { if (full || moving) window.overlay.setInteractive(true); }); // coach fixo (sem TAB) não rouba o clique do jogo
  el.addEventListener('pointerleave', () => { if (!dragging) window.overlay.setInteractive(false); });

  el.querySelector('.drag').addEventListener('pointerdown', (e) => {
    const start = current(name);
    const off = { dx: e.clientX - start.x, dy: e.clientY - start.y };
    dragging = true;
    e.target.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const r = el.getBoundingClientRect();
      panels[name] = {
        x: Math.min(Math.max(0, ev.clientX - off.dx), window.innerWidth - r.width),
        y: Math.min(Math.max(0, ev.clientY - off.dy), window.innerHeight - r.height),
        scale: start.scale,
      };
      apply(name);
    };
    const up = () => {
      dragging = false;
      e.target.removeEventListener('pointermove', move);
      e.target.removeEventListener('pointerup', up);
      save();
    };
    e.target.addEventListener('pointermove', move);
    e.target.addEventListener('pointerup', up);
  });

  el.querySelector('.grip').addEventListener('pointerdown', (e) => {
    const start = current(name);
    const x0 = e.clientX;
    dragging = true;
    e.target.setPointerCapture(e.pointerId);
    e.stopPropagation();
    const move = (ev) => {
      const scale = Math.min(2.5, Math.max(0.5, start.scale + (ev.clientX - x0) / BASE_WIDTH));
      panels[name] = { x: start.x, y: start.y, scale: Number(scale.toFixed(2)) };
      apply(name);
    };
    const up = () => {
      dragging = false;
      e.target.removeEventListener('pointermove', move);
      e.target.removeEventListener('pointerup', up);
      save();
    };
    e.target.addEventListener('pointermove', move);
    e.target.addEventListener('pointerup', up);
  });
}

$('move-done').addEventListener('click', () => window.overlay.toggleMoveMode());

window.overlay.onState((state) => { if (PREVIEW_ONLY) return; lastState = state; draw(); });
window.overlay.onSettings((s) => {
  if (PREVIEW_ONLY) return;
  enabled = (s.overlay && s.overlay.enabled) || {};
  if (!dragging && s.overlay && s.overlay.panels) { panels = { ...s.overlay.panels }; Object.keys(boxes).forEach(apply); }
  draw();
});
window.overlay.onMoveMode((on) => { moving = on; draw(); });
if (window.overlay.onFull) window.overlay.onFull((on) => { full = on; draw(); });
window.overlay.onPreview((on) => { previewing = on; draw(); });
window.overlay.getSettings().then((s) => {
  if (PREVIEW_ONLY) return;
  if (s && s.overlay && s.overlay.panels) panels = { ...panels, ...s.overlay.panels };
  enabled = (s && s.overlay && s.overlay.enabled) || {};
  Object.keys(boxes).forEach(apply);
});
window.addEventListener('resize', () => Object.keys(boxes).forEach(apply));
Object.keys(boxes).forEach(apply);
window.overlay.ready();

if (PREVIEW_ONLY) {
  previewing = true;
  panels[PREVIEW_ONLY] = { x: 6, y: 6, scale: 1 };
  Object.keys(boxes).forEach(apply);
  document.body.classList.add('preview');
  draw();
}
