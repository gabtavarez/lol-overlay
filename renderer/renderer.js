const WEIGHTS = ['mastery', 'meta', 'counter', 'comp', 'synergy'];
const STAT_SHARD = { 5001: 'Vida', 5002: 'Armadura', 5003: 'RM', 5005: 'Vel. ataque', 5007: 'Redução de recarga', 5008: 'Força adaptativa', 5010: 'Vel. movimento', 5011: 'Vida', 5013: 'Tenacidade' };

const $ = (id) => document.getElementById(id);
const els = {
  dot: $('dot'), clock: $('clock'), gear: $('gear'), status: $('status'),
  waiting: $('waiting'), waitingText: $('waiting-text'),
  select: $('select'), game: $('game'), settings: $('settings'),
  turn: $('turn'), selRole: $('selRole'), picks: $('picks'), pickNotes: $('pickNotes'),
  guideTitle: $('guide-title'), guideWhy: $('guide-why'), guideBody: $('guide-body'), impMsg: $('imp-msg'),
  team: $('team'), selEnemies: $('selEnemies'), opggAllies: $('opggAllies'), opggEnemies: $('opggEnemies'),
  setRole: $('set-role'), setPool: $('set-pool'), setBlacklist: $('set-blacklist'), setMsg: $('set-msg'),
};

let version = null;
let lastState = null;
let currentRole = '';
let settingsOpen = false;
let settings = null;
let chosenId = null; // clique do usuário no carrossel
let shownId = null;
let guide = null;

function portrait(champId, alt) {
  return version && champId
    ? h('img', { class: 'portrait', src: champIcon(version, champId), alt: alt || '' })
    : h('div', { class: 'portrait' });
}

function playerLabel(p) {
  if (!p.gameName) return 'Nome oculto';
  return p.tagLine ? `${p.gameName}#${p.tagLine}` : p.gameName;
}

function showView(name) {
  const v = settingsOpen ? null : name;
  els.waiting.hidden = v !== 'waiting';
  els.select.hidden = v !== 'select';
  els.game.hidden = v !== 'game';
}

/* ---------- champ select ---------- */

function slot(p, extraClass = '') {
  const champName = p.champion ? p.champion.name : '';
  const role = p.position ? ROLE_LABEL[p.position] : '';
  return h('div', { class: `slot${p.isMe ? ' me' : ''} ${extraClass}` },
    portrait(p.champion && p.champion.id, champName),
    h('div', { class: 'slot-body' },
      h('div', { class: 'slot-name', text: champName || '—' }),
      h('div', { class: 'muted', text: [role, p.isMe ? 'você' : playerLabel(p)].filter(Boolean).join(' · ') }),
    ),
  );
}

function pickCard(c, selected) {
  const card = h('button', { class: `card${selected ? ' selected' : ''}`, type: 'button' },
    h('div', { class: 'card-art' }),
    h('div', { class: 'card-score', text: String(c.score) }),
    h('div', { class: 'card-name', text: c.name }),
    h('div', { class: 'card-why', text: c.reasons[0] || 'Pelos seus dados' }),
  );
  if (version) card.firstChild.style.backgroundImage = `url("${champSplash(c.id)}")`;
  card.addEventListener('click', () => {
    chosenId = c.id;
    if (lastState) renderSelect(lastState);
  });
  return card;
}

function renderGuide(state, picks) {
  const mine = state.me && state.me.champion;
  const pickId = chosenId || (mine && mine.id) || (picks.candidates[0] && picks.candidates[0].id) || null;
  const cand = picks.candidates.find((c) => c.id === pickId);

  if (!pickId) {
    els.guideTitle.textContent = 'Guia do campeão';
    els.guideWhy.textContent = 'Escolha um campeão para ver runas, feitiços e itens.';
    els.guideBody.replaceChildren();
    setImportEnabled(false);
    return;
  }
  const name = (cand && cand.name) || (mine && mine.id === pickId ? mine.name : pickId);
  els.guideTitle.textContent = `Guia do campeão: ${name}`;
  els.guideWhy.textContent = cand ? `Por que sugeri: ${cand.reasons.join(' · ') || 'seus dados de maestria'}` : '';

  if (pickId !== shownId) {
    shownId = pickId;
    guide = null;
    imported.runes = false;
    imported.spells = false;
    els.impMsg.textContent = '';
    window.overlay.getGuide(pickId).then((g) => {
      if (shownId === pickId) { guide = g; drawGuide(); }
    });
  }
  drawGuide();
}

function setImportEnabled(on) {
  for (const id of ['imp-all', 'imp-items']) $(id).disabled = !on;
}

function iconRow(label, ids, names) {
  const row = h('div', { class: 'g-row' }, h('span', { class: 'g-label', text: label }));
  ids.forEach((id, i) => row.append(h('img', { class: 'g-item', src: itemIcon(version, id), title: names[i], alt: names[i] })));
  return row;
}

const ddImg = (path) => `${DD}/cdn/img/${path}`;
const ddVerImg = (path) => `${DD}/cdn/${version}/img/${path}`;
const imported = { runes: false, spells: false };

/** <img> que vira texto se o ícone não existir. */
function icon(src, cls, title, fallback) {
  const img = h('img', { class: cls, src, title, alt: title });
  img.addEventListener('error', () => img.replaceWith(h('span', { class: `${cls} miss`, title, text: fallback || title.slice(0, 2) })));
  return img;
}

function badge(what) {
  const b = h('button', { class: `badge${imported[what] ? ' on' : ''}`, text: imported[what] ? '✓ Selecionado' : '⬇ Importar' });
  b.addEventListener('click', () => doImport(what));
  return b;
}

function head(title, what) {
  return h('div', { class: 'g-head' }, h('h3', { text: title }), what ? badge(what) : null);
}

function runeRow(row, cls) {
  return h('div', { class: 'r-row' }, ...row.map((r) => icon(ddImg(r.icon), `${cls}${r.selected ? ' sel' : ''}`, r.name)));
}

function drawRunes(t) {
  const left = h('div', { class: 'tree' },
    runeRow(t.primaryStyles, 'r-style'),
    ...t.primary.map((row, i) => runeRow(row, i === 0 ? 'r-key' : 'r-rune')));
  const right = h('div', { class: 'tree' },
    runeRow(t.secondaryStyles, 'r-style'),
    ...t.secondary.map((row) => runeRow(row, 'r-rune')),
    h('div', { class: 'shards' }, ...t.shards.map((row) => runeRow(row, 'r-shard'))));
  return h('div', { class: 'trees' }, left, right);
}

/** Completa a ordem de skills até o nível 18 (R no 16, depois maximiza na ordem de prioridade). */
function skillOrder18(order) {
  const seq = order.slice(0, 18);
  const count = (k) => seq.filter((x) => x === k).length;
  const prio = ['Q', 'W', 'E'].sort((a, b) => count(b) - count(a) || order.indexOf(a) - order.indexOf(b));
  while (seq.length < 18) {
    const lvl = seq.length + 1;
    if ([6, 11, 16].includes(lvl) && count('R') < 3) seq.push('R');
    else seq.push(prio.find((k) => count(k) < 5) || 'R');
  }
  return seq;
}

function drawSkills(g) {
  const seq = skillOrder18(g.skills);
  const icons = g.skillIcons ? g.skillIcons.spells : [];
  const grid = h('div', { class: 'sk-grid' }, h('span'));
  for (let i = 1; i <= 18; i++) grid.append(h('span', { class: 'sk-lvl', text: String(i) }));
  ['Q', 'W', 'E', 'R'].forEach((key, k) => {
    const sp = icons[k];
    grid.append(sp ? icon(ddVerImg(sp.icon), 'sk-icon', `${key} · ${sp.name}`, key) : h('span', { class: 'sk-icon miss', text: key }));
    seq.forEach((x) => grid.append(h('span', { class: `sk-cell${x === key ? ` on s-${key}` : ''}`, text: x === key ? key : '' })));
  });
  return grid;
}

function drawSpells(g) {
  const flashD = settings && settings.flashKey === 'D';
  let [d, f] = g.spells;
  const isFlash = (s) => s && s.id === 4;
  if (isFlash(d) && !flashD) [d, f] = [f, d];
  if (isFlash(f) && flashD) [d, f] = [f, d];
  const spell = (s, key) => h('div', { class: 'sp' },
    s && s.key ? icon(ddVerImg(`spell/${s.key}.png`), 'sp-icon', s.name) : h('span', { class: 'sp-icon miss', text: '?' }),
    h('span', { class: 'kbd', text: key }));
  const swap = h('button', { class: 'swap', title: 'Trocar a tecla do Flash (D/F)', text: '⇄' });
  swap.addEventListener('click', toggleFlashKey);
  return h('div', { class: 'spells' }, spell(d, 'D'), swap, spell(f, 'F'));
}

function drawBuild(g) {
  const starter = h('div', { class: 'items' }, ...g.starterCounts.map((it) => h('div', { class: 'it' },
    icon(ddVerImg(`item/${it.id}.png`), 'it-icon', it.name), it.count > 1 ? h('span', { class: 'cnt', text: `x${it.count}` }) : null)));
  const full = h('div', { class: 'items full' }, ...g.fullBuild.map((it, i) => h('div', { class: 'it' },
    h('span', { class: 'num', text: String(i + 1) }), icon(ddVerImg(`item/${it.id}.png`), 'it-icon', it.name))));
  return h('div', { class: 'build' },
    h('div', {}, h('div', { class: 'sub', text: 'Itens iniciais' }), starter),
    h('div', {}, h('div', { class: 'sub', text: 'Build completa' }), full));
}

function drawGuide() {
  if (!guide) {
    els.guideBody.replaceChildren(h('p', { class: 'muted', text: 'Carregando dados do OP.GG…' }));
    setImportEnabled(false);
    return;
  }
  const g = guide;
  const parts = [];
  if (g.matchup) {
    const vs = g.matchup.advantage ? ` · vantagem de rota: ${g.matchup.advantage}` : '';
    parts.push(h('div', { class: 'tip' }, h('b', { text: `Matchup vs ${g.matchup.vs}${vs}` }), h('div', { text: g.matchup.tip || '' }),
      g.matchup.used.length ? h('div', { class: 'muted', text: `Ajustado ao matchup: ${g.matchup.used.join(', ')}` }) : null));
  }
  const left = h('div', { class: 'g-left' });
  if (g.runeTree) left.append(head('Runas', 'runes'), drawRunes(g.runeTree));
  else if (g.runes) left.append(head('Runas', 'runes'), h('p', { class: 'muted', text: `${g.runes.primaryStyleName} + ${g.runes.subStyleName}` }));
  if (g.skills.length) left.append(head('Caminho da habilidade'), drawSkills(g));

  const right = h('div', { class: 'g-right' });
  if (g.spells.length) right.append(head('Invocador', 'spells'), drawSpells(g));
  right.append(head('Build'), drawBuild(g));
  if (typeof g.winRate === 'number') right.append(h('p', { class: 'muted', text: `Taxa de vitória: ${(g.winRate * 100).toFixed(1)}%` }));

  parts.push(h('div', { class: 'g-grid' }, left, right));
  els.guideBody.replaceChildren(...parts);
  setImportEnabled(Boolean(g.runes || g.spells.length));
}

function renderSelect(state) {
  version = state.assets.version;
  currentRole = state.myPosition || '';
  els.dot.className = 'dot ok';
  els.clock.textContent = '';

  const picks = (state.advice && state.advice.picks) || { candidates: [], notes: [] };
  els.selRole.textContent = state.myPosition ? ROLE_LABEL[state.myPosition] : 'rota não definida';
  const turnText = state.action === 'ban' ? 'Sua vez: banir' : state.action === 'pick' ? 'Sua vez: escolher' : '';
  els.turn.textContent = turnText;
  els.turn.hidden = !turnText;

  const selectedId = chosenId || (state.me && state.me.champion && state.me.champion.id) || (picks.candidates[0] && picks.candidates[0].id);
  els.picks.replaceChildren(...picks.candidates.map((c) => pickCard(c, c.id === selectedId)));
  els.pickNotes.replaceChildren(...picks.notes.map((n) => h('p', { text: n })));

  els.team.replaceChildren(...[state.me, ...state.allies].filter(Boolean).map((p) => slot(p)));
  els.selEnemies.replaceChildren(...state.enemies.map((p) => slot(p, 'enemy')));
  const opgg = state.opgg || {};
  els.opggAllies.disabled = !opgg.allies;
  els.opggEnemies.hidden = !opgg.enemies;

  const bans = (state.advice && state.advice.bans) || [];
  $('bans').hidden = state.action !== 'ban' || !bans.length;
  $('ban-row').replaceChildren(...bans.map((b) => h('div', { class: 'ban' },
    portrait(b.id, b.name),
    h('div', {}, h('div', { class: 'slot-name', text: `${b.name} · ${b.score}` }), h('div', { class: 'muted', text: b.reasons.join(' · ') })))));

  renderGuide(state, picks);
  showView('select');
}

/* ---------- em partida ---------- */

function renderGame(state) {
  version = state.assets.version;
  els.dot.className = 'dot ok';
  const m = Math.floor(state.gameTime / 60);
  els.clock.textContent = `${m}:${String(state.gameTime % 60).padStart(2, '0')}`;
  $('who').textContent = `${state.me.champion} · nível ${state.me.level}`;
  $('gold').textContent = `${state.me.gold} g`;
  renderBuyList($('buys'), state.advice && state.advice.buys, version);
  renderExtras({ recall: $('recall'), matchup: $('matchup'), alerts: $('alerts') }, state.advice);
  $('enemies').replaceChildren(
    ...state.enemies.map((e) => h('div', { class: `slot enemy${e.isDead ? ' dead' : ''}` },
      portrait(e.championId, e.champion),
      h('div', { class: 'slot-body' },
        h('div', { class: 'slot-name', text: `${e.champion} · ${e.level}` }),
        h('div', { class: 'muted', text: `${e.scores.kills}/${e.scores.deaths}/${e.scores.assists}` }),
      ))),
  );
  showView('game');
}

/* ---------- roteamento ---------- */

function render(state) {
  lastState = state;
  if (state.phase === 'ingame') return renderGame(state);
  if (state.phase === 'champselect') return renderSelect(state);
  chosenId = null;
  shownId = null;
  els.clock.textContent = '';
  if (state.phase === 'error') {
    els.waitingText.textContent = `Erro ao processar a partida: ${state.reason}`;
    els.dot.className = 'dot bad';
  } else {
    els.waitingText.textContent = state.client === 'open' ? 'Pronto para a próxima partida' : 'Abra o cliente do LoL';
    els.dot.className = state.client === 'open' ? 'dot ok' : 'dot warn';
  }
  renderHome(state);
  return showView('waiting');
}

/* ---------- barra de título ---------- */

hydrateIcons();
$('win-min').addEventListener('click', () => window.overlay.winMinimize());
$('win-max').addEventListener('click', () => window.overlay.winToggleMax());
$('win-close').addEventListener('click', () => window.overlay.winClose());
$('bar').addEventListener('dblclick', (e) => { if (!e.target.closest('button')) window.overlay.winToggleMax(); });
window.overlay.onMaximized((max) => {
  $('win-max').replaceChildren(svgIcon(max ? 'restore' : 'max'));
  $('win-max').title = max ? 'Restaurar' : 'Maximizar';
});

/* ---------- tela inicial ---------- */

const fmtPts = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} mi` : n >= 1e3 ? `${Math.round(n / 1e3)} mil` : String(n));
let homeKey = '';

function renderHome(state) {
  const home = state.home || {};
  const v = home.version || version;
  const chips = [
    [state.client === 'open' ? 'Cliente conectado' : 'Cliente fechado', state.client === 'open' ? 'ok' : 'warn'],
    [v ? `Patch ${v.split('.').slice(0, 2).join('.')}` : 'Carregando dados…', ''],
    [`Versão ${appVersion || '…'}`, ''],
  ];
  $('home-chips').replaceChildren(...chips.map(([t, c]) => h('span', { class: `chip ${c}`, text: t })));

  const key = JSON.stringify([state.client, home.summoner && home.summoner.puuid, (home.top || []).length, v]);
  if (key === homeKey) return; // evita redesenhar a cada 1,5 s
  homeKey = key;

  const s = home.summoner;
  $('home-hello').textContent = s && s.gameName ? `Olá, ${s.gameName}` : 'Bem-vindo ao LoL Overlay';
  const box = $('home-summoner');
  box.hidden = !s;
  if (s) {
    box.replaceChildren(
      v && s.iconId ? h('img', { class: 'sum-icon', src: `${DD}/cdn/${v}/img/profileicon/${s.iconId}.png`, alt: '' }) : h('div', { class: 'sum-icon' }),
      h('div', {}, h('div', { class: 'sum-name', text: `${s.gameName}${s.tagLine ? ` #${s.tagLine}` : ''}` }),
        h('div', { class: 'muted', text: s.level ? `Nível ${s.level}` : '' })));
  }

  const champs = home.top || [];
  $('home-champs').replaceChildren(...(champs.length
    ? champs.map((c) => h('div', { class: 'hc' },
      v ? h('img', { src: champIcon(v, c.id), alt: c.name }) : h('div'),
      h('div', {}, h('div', { class: 'hc-name', text: c.name }), h('div', { class: 'muted', text: `M${c.level} · ${fmtPts(c.points)} pts` }))))
    : [h('p', { class: 'muted', text: state.client === 'open' ? (home.loading ? 'Carregando sua maestria…' : 'Sem dados de maestria.') : 'Abra o cliente do LoL para ver sua maestria.' })]));

  const roles = home.roles || [];
  const max = Math.max(1, ...roles.map((r) => r.games));
  $('home-roles').replaceChildren(...(roles.length
    ? [...roles.map((r) => h('div', { class: 'role-row' },
      h('span', { class: 'role-name' }, svgIcon(r.role, 'ico role-ico'), document.createTextNode(ROLE_LABEL[r.role] || r.role)),
      h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${Math.round((r.games / max) * 100)}%` })),
      h('span', { class: 'muted', text: `${r.games} jogos · ${Math.round(r.winRate * 100)}% vit.` }))),
      h('p', { class: 'muted', text: `Últimas ${home.gamesAnalyzed || 0} partidas de Summoner's Rift.` })]
    : [h('p', { class: 'muted', text: 'Calculado do seu histórico recente quando o cliente estiver aberto.' })]));
}

let appVersion = '';
window.overlay.getDiagnostics().then((d) => { appVersion = d.version; homeKey = ''; if (lastState) render(lastState); }).catch(() => {});
$('home-test').addEventListener('click', () => window.overlay.previewOverlay());
$('home-settings').addEventListener('click', () => els.gear.click());

/* ---------- importar ---------- */

async function doImport(what) {
  if (!shownId) return;
  els.impMsg.textContent = 'Importando…';
  const res = await window.overlay.importBuild(shownId, what);
  els.impMsg.textContent = res.ok ? `Importado: ${res.done.join(' e ')}.` : `Não consegui importar: ${res.error}`;
  if (res.ok) {
    if (res.done.includes('runas')) imported.runes = true;
    if (res.done.includes('feitiços')) imported.spells = true;
    drawGuide();
  }
}
$('imp-all').addEventListener('click', () => doImport('both'));
$('imp-items').addEventListener('click', () => doImport('items'));

/* ---------- configurações ---------- */

const splitList = (text) => text.split(',').map((s) => s.trim()).filter(Boolean);

function fillRoleFields() {
  els.setPool.value = (settings.picker.pool[els.setRole.value] || []).join(', ');
}

function fillSettings() {
  for (const key of WEIGHTS) {
    const pct = Math.round(settings.picker.weights[key] * 100);
    $(`w-${key}`).value = pct;
    $(`o-${key}`).textContent = String(pct);
  }
  els.setRole.value = currentRole || els.setRole.value || 'middle';
  els.setBlacklist.value = settings.picker.blacklist.join(', ');
  $('set-remote').checked = settings.remoteData.enabled;
  $('set-accept').checked = settings.autoAccept === true;
  $('set-update').checked = settings.autoUpdate !== false;
  $('set-flash').value = settings.flashKey || 'F';
  $('set-overlay-mode').value = (settings.overlay && settings.overlay.mode) || 'tab';
  fillRoleFields();
}

async function openSettings() {
  settings = await window.overlay.getSettings();
  settingsOpen = true;
  els.settings.hidden = false;
  els.setMsg.textContent = '';
  fillSettings();
  showView(null);
}

function closeSettings() {
  settingsOpen = false;
  els.settings.hidden = true;
  if (lastState) render(lastState);
}

async function saveSettings() {
  const weights = Object.fromEntries(WEIGHTS.map((k) => [k, Number($(`w-${k}`).value) / 100]));
  settings = await window.overlay.setSettings({
    remoteData: { enabled: $('set-remote').checked },
    autoAccept: $('set-accept').checked,
    autoUpdate: $('set-update').checked,
    flashKey: $('set-flash').value,
    overlay: { mode: $('set-overlay-mode').value },
    picker: {
      weights,
      pool: { [els.setRole.value]: splitList(els.setPool.value) },
      blacklist: splitList(els.setBlacklist.value),
    },
  });
  els.setMsg.textContent = 'Salvo.';
  showFlashKey();
}

function showFlashKey() {
  if (guide) drawGuide();
}
async function toggleFlashKey() {
  settings = settings || (await window.overlay.getSettings());
  settings = await window.overlay.setSettings({ flashKey: settings.flashKey === 'D' ? 'F' : 'D' });
  imported.spells = false;
  showFlashKey();
  els.impMsg.textContent = `Flash agora no ${settings.flashKey}. Clique em Importar no Invocador para aplicar.`;
}
window.overlay.getSettings().then((s) => { settings = s; showFlashKey(); });

$('set-test').addEventListener('click', () => window.overlay.previewOverlay());
$('set-diag').addEventListener('click', async () => {
  const d = await window.overlay.getDiagnostics();
  const box = $('diag');
  const key = d.hook.loaded
    ? `ok${d.hook.lastKeyAgoMs === null ? ' (ainda não detectei nenhuma tecla: aperte uma)' : `, última tecla há ${Math.round(d.hook.lastKeyAgoMs / 1000)} s`} · TAB pressionado ${d.hook.tabPresses}×`
    : `FALHOU (${d.hook.error || 'não iniciado'}): overlay fica sempre visível`;
  box.replaceChildren(
    h('div', { text: `Versão ${d.version}` }),
    h('div', { text: `Monitoramento da tecla TAB (hook): ${key}` }),
    h('div', { text: `Leitor direto da tecla TAB: ${d.hook.poller} · TAB agora: ${d.tabDown ? 'pressionado' : 'solto'}` }),
    h('div', { text: `Live Client API do jogo: ${d.live.phase}${d.live.reason ? ` (${d.live.reason})` : ''}` }),
    h('div', { text: `Cliente do LoL: ${d.client}` }),
    h('div', { class: 'muted', text: `Log: ${d.logFile}` }),
    h('div', { text: `Overlay: ${d.overlay.visible ? 'visível' : 'oculto'} · modo ${d.overlay.mode}${d.overlay.bounds ? ` · tela ${d.overlay.bounds.width}×${d.overlay.bounds.height}` : ''}` }),
  );
  box.hidden = false;
});

/* ---------- atualização ---------- */

function showUpdate(u) {
  const btn = $('update-btn');
  btn.classList.toggle('primary', u.state === 'ready');
  btn.disabled = u.state === 'checking' || u.state === 'downloading';
  $('update-label').textContent = {
    checking: 'Procurando…',
    downloading: `Baixando ${u.version || ''} ${u.percent || 0}%`,
    ready: `Reiniciar e atualizar (${u.version})`,
    none: 'Atualizado ✓',
  }[u.state] || 'Procurar atualizações';
  btn.title = u.message || '';
  if (u.state === 'error' && u.message) els.status.textContent = u.message;
}
$('update-btn').addEventListener('click', async () => {
  const btn = $('update-btn');
  if ($('update-label').textContent.startsWith('Reiniciar')) return window.overlay.installUpdate();
  $('update-label').textContent = 'Procurando…';
  showUpdate(await window.overlay.checkUpdate());
});
$('set-update-now').addEventListener('click', async () => {
  els.setMsg.textContent = 'Verificando…';
  const u = await window.overlay.checkUpdate();
  els.setMsg.textContent = u.message || (u.state === 'downloading' ? `Baixando ${u.version}…` : u.state === 'ready' ? 'Atualização pronta.' : 'Verificação concluída.');
});
window.overlay.onUpdate(showUpdate);
window.overlay.getUpdate().then(showUpdate);

els.gear.addEventListener('click', () => (settingsOpen ? closeSettings() : openSettings()));
$('set-close').addEventListener('click', closeSettings);
$('set-save').addEventListener('click', saveSettings);
$('set-move').addEventListener('click', () => window.overlay.toggleMoveMode());
$('set-folder').addEventListener('click', () => window.overlay.openDataFolder());
els.setRole.addEventListener('change', fillRoleFields);
for (const key of WEIGHTS) $(`w-${key}`).addEventListener('input', () => { $(`o-${key}`).textContent = $(`w-${key}`).value; });
els.opggAllies.addEventListener('click', () => window.overlay.openMultisearch('allies'));
els.opggEnemies.addEventListener('click', () => window.overlay.openMultisearch('enemies'));

window.overlay.onState(render);
window.overlay.onStatus((s) => { els.status.textContent = s.text; });
window.overlay.onGuideUpdated((p) => {
  if (p.championId === shownId) window.overlay.getGuide(shownId).then((g) => { guide = g; drawGuide(); });
});
window.overlay.ready();
