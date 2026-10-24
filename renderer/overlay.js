const $ = (id) => document.getElementById(id);
const boxes = { buys: $('buys'), info: $('info'), gold: $('goldbox'), timers: $('timersbox') };
const extras = { recall: $('recall'), matchup: $('matchup'), alerts: $('alerts') };

const BASE_WIDTH = 330;
let lastState = null;
let moving = false;
let previewing = false;
let panels = { buys: null, info: null, gold: null, timers: null };
let dragging = false;

const SAMPLE = { items: [
  { id: 3102, name: 'Item sugerido', reason: 'Motivo da compra aparece aqui', score: 90, missing: 500, canBuy: false },
  { id: 3165, name: 'Item sugerido', reason: 'Contra o campeão inimigo', score: 70, missing: 0, canBuy: true },
  { id: 3146, name: 'Item sugerido', reason: 'Build do meta', score: 60, missing: 900, canBuy: false },
] };

const SAMPLE_GOLD = { team: { ally: 21400, enemy: 19900, diff: 1500 }, lanes: ['Topo', 'Selva', 'Meio', 'Atirador', 'Suporte'].map((role, i) => ({
  role, ally: { name: 'Aliado', gold: 4000 + i * 300 }, enemy: { name: 'Inimigo', gold: 4200 - i * 100 }, diff: 4000 + i * 300 - (4200 - i * 100) })) };

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

/* ---------- rota: fases + scouting ---------- */
function renderInfo(advice, state) {
  const ph = advice.phases;
  $('phases').hidden = !ph;
  if (ph) $('phases').replaceChildren(...ph.map((p) => h('div', { class: `ph ${p.verdict}` }, h('b', { text: p.label }), h('span', { text: p.text }))));
  $('info-vs').textContent = state && state.laneOpponent ? `vs ${state.laneOpponent.champion}` : '';
  const sc = advice.scout || [];
  $('scout').hidden = !sc.length;
  $('scout').replaceChildren(...sc.map((x) => {
    const p = x.profile;
    const rank = p && p.tier ? `${p.tier[0]}${p.tier.slice(1).toLowerCase()} ${p.division || ''}` : p ? 'Sem elo' : '…';
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
  return { buys: { x: 18, y, scale: 1 }, info: { x: 18, y: y + 420, scale: 1 }, gold: { x: window.innerWidth - 300, y, scale: 1 }, timers: { x: window.innerWidth - 300, y: Math.max(10, y - 250), scale: 1 } };
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
  const hasInfo = Boolean((advice.buys && advice.buys.matchup) || (advice.alerts && advice.alerts.length) || advice.phases || (advice.scout && advice.scout.length));

  const sample = moving || previewing;
  boxes.buys.hidden = !inGame && !sample;
  boxes.info.hidden = !(sample || (inGame && hasInfo));
  boxes.gold.hidden = !(sample || (inGame && advice.gold));
  boxes.timers.hidden = !(sample || (inGame && ((advice.timers && advice.timers.length) || lastState.enemies.length)));
  for (const b of Object.values(boxes)) b.classList.toggle('moving', moving);
  $('edit-bar').hidden = !moving;

  if (inGame && !sample) {
    $('gold').textContent = `${lastState.me.gold} g`;
    renderBuyList($('list'), advice.buys, lastState.assets.version);
    renderExtras(extras, advice);
    renderGold(advice.gold, lastState.assets.version);
    renderInfo(advice, lastState);
    renderTimers(lastState);
  } else if (sample) {
    $('gold').textContent = '';
    renderBuyList($('list'), SAMPLE, null);
    renderGold(SAMPLE_GOLD, null);
    renderInfo({ phases: [{ label: 'Early', verdict: 'theirs', text: 'Oponente mais forte' }, { label: 'Mid', verdict: 'even', text: 'Equilibrado' }, { label: 'Late', verdict: 'mine', text: 'Você mais forte' }] }, null);
    renderTimers(null);
    renderExtras(extras, { buys: { recall: 'Aviso de recall aparece aqui', items: [1], matchup: { vs: 'Campeão', tip: 'Dica do matchup aparece aqui.' } }, alerts: [{ text: 'Alertas de itens inimigos' }] });
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
  el.addEventListener('pointerenter', () => window.overlay.setInteractive(true));
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

window.overlay.onState((state) => { lastState = state; draw(); });
window.overlay.onMoveMode((on) => { moving = on; draw(); });
window.overlay.onPreview((on) => { previewing = on; draw(); });
window.overlay.getSettings().then((s) => {
  if (s && s.overlay && s.overlay.panels) panels = { buys: s.overlay.panels.buys, info: s.overlay.panels.info, gold: s.overlay.panels.gold, timers: s.overlay.panels.timers };
  Object.keys(boxes).forEach(apply);
});
window.addEventListener('resize', () => Object.keys(boxes).forEach(apply));
Object.keys(boxes).forEach(apply);
window.overlay.ready();
