const $ = (id) => document.getElementById(id);
const boxes = { buys: $('buys'), info: $('info') };
const extras = { recall: $('recall'), matchup: $('matchup'), alerts: $('alerts') };

const BASE_WIDTH = 330;
let lastState = null;
let moving = false;
let previewing = false;
let panels = { buys: null, info: null };
let dragging = false;

const SAMPLE = { items: [
  { id: 3102, name: 'Item sugerido', reason: 'Motivo da compra aparece aqui', score: 90, missing: 500, canBuy: false },
  { id: 3165, name: 'Item sugerido', reason: 'Contra o campeão inimigo', score: 70, missing: 0, canBuy: true },
  { id: 3146, name: 'Item sugerido', reason: 'Build do meta', score: 60, missing: 900, canBuy: false },
] };

function defaults() {
  const y = Math.round(window.innerHeight * 0.3);
  return { buys: { x: 18, y, scale: 1 }, info: { x: 18, y: y + 420, scale: 1 } };
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
  const hasInfo = Boolean((advice.buys && advice.buys.matchup) || (advice.alerts && advice.alerts.length));

  const sample = moving || previewing;
  boxes.buys.hidden = !inGame && !sample;
  boxes.info.hidden = !(sample || (inGame && hasInfo));
  for (const b of Object.values(boxes)) b.classList.toggle('moving', moving);
  $('edit-bar').hidden = !moving;

  if (inGame && !sample) {
    $('gold').textContent = `${lastState.me.gold} g`;
    renderBuyList($('list'), advice.buys, lastState.assets.version);
    renderExtras(extras, advice);
  } else if (sample) {
    $('gold').textContent = '';
    renderBuyList($('list'), SAMPLE, null);
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
  if (s && s.overlay && s.overlay.panels) panels = { buys: s.overlay.panels.buys, info: s.overlay.panels.info };
  apply('buys');
  apply('info');
});
window.addEventListener('resize', () => { apply('buys'); apply('info'); });
apply('buys');
apply('info');
window.overlay.ready();
