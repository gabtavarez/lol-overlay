const { app, BrowserWindow, Menu, globalShortcut, ipcMain, screen, shell } = require('electron');
const path = require('path');
const { DataDragon } = require('./ddragon');
const { createEngine } = require('./engine');
const { createLcuEngine } = require('./lcuEngine');
const { discoverCredentials, lcuGetJson } = require('./lcu');
const { createSettingsStore } = require('./settings');
const { loadMeta } = require('./meta');
const { pickState } = require('./router');
const { createRemoteData } = require('./providers/remote');
const { buildGuide, indexRunes, runeTree } = require('./guide');
const { importRunes, importSpells, importItemSet } = require('./importer');
const { withMatchup } = require('./matchup');
const { createLogger } = require('./log');
const { createUpdater } = require('./updater');
const { laterItems } = require('./buildPath');
const { spawn } = require('child_process');
const { createRecorder } = require('./postgame');
const { phaseCompare } = require('./power');
const { predictRoles, roleIndex } = require('./roles');
const { championFit, mainRoleOf } = require('./fit');
const { reviewMatch } = require('./matchReview');
const { hoverChampion } = require('./hover');
const { situationalItems } = require('./situational');
const { isBoots: isBootsItem } = require('./buys');
const { liveGoals, targetsFor } = require('./goals');
const { createEloTracker, weekStats } = require('./elo');
const { createMeraki, ultRank } = require('./providers/meraki');

const USE_MOCK = process.argv.includes('--mock');
const LIVE_URL = USE_MOCK ? 'http://127.0.0.1:2998' : 'https://127.0.0.1:2999';
const MOCK_LCU_CREDS = { port: 2997, token: 'mock', protocol: 'http' };
const DD_RETRY_MS = 30_000;
const OPGG_PREFIX = 'https://op.gg/lol/multisearch/';
const TAB_KEYCODE = 15; // uiohook: Tab
const ROLES = ['top', 'jungle', 'middle', 'bottom', 'utility'];

let mainWin = null;
let overlayWin = null;
let liveEngine = null;
let lcuEngine = null;
let remote = null;
let dd = null;
let runeIndex = {};
let runeStyles = [];
let settings = null;
let meta = { tiers: {}, counters: {} };
let overlayAlways = false;
let tabDown = false;
let moveMode = false;
let previewTimer = null;
let logger = { log() {}, file: '' };
let keyPoller = null;
let hookTab = false;
let pollTab = false;
let lastLivePhase = '';
let updater = null;
const DEVTOOLS_ALLOWED = !app.isPackaged && process.env.LOL_DEVTOOLS === '1';
const hook = { loaded: false, error: '', lastKeyAt: 0, tabPresses: 0, poller: 'não iniciado' };
let lastRole = '';

let liveState = { phase: 'waiting' };
let lcuState = { phase: 'idle', client: 'closed' };
let lastState = { phase: 'waiting', client: 'closed' };
let lastStatus = { text: 'Carregando dados do jogo…', level: 'info' };

function send(channel, payload) {
  for (const w of [mainWin, overlayWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function setStatus(text, level = 'info') {
  lastStatus = { text, level };
  send('status', lastStatus);
}

function publish() {
  if (liveState.phase !== lastLivePhase) {
    lastLivePhase = liveState.phase;
    logger.log(`Live API: ${liveState.phase}${liveState.reason ? ` (${liveState.reason})` : ''}`);
  }
  lastState = pickState(liveState, lcuState);
  if (lcuState.phase === 'champselect' && lcuState.myPosition) lastRole = lcuState.myPosition;
  send('state', lastState);
  updateOverlayVisibility();
}

/* ---------- janelas ---------- */

function webPrefs() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    devTools: DEVTOOLS_ALLOWED,
    spellcheck: false,
  };
}

/** Faz a janela se comportar como app, não como navegador: sem DevTools, recarregar, zoom, menu ou navegação. */
function lockDownWindow(win) {
  const wc = win.webContents;
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || DEVTOOLS_ALLOWED) return;
    const key = String(input.key).toLowerCase();
    const ctrl = input.control || input.meta;
    const blocked =
      key === 'f12' || key === 'f5' || key === 'f11' ||
      (ctrl && input.shift && ['i', 'j', 'c', 'r'].includes(key)) ||
      (ctrl && input.alt && ['i', 'j', 'c'].includes(key)) ||
      (ctrl && ['r', 'u', 'p', 's', 'w', '+', '-', '=', '0'].includes(key));
    if (blocked) event.preventDefault();
  });
  wc.on('devtools-opened', () => { if (!DEVTOOLS_ALLOWED) wc.closeDevTools(); });
  wc.on('will-navigate', (event) => event.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.setVisualZoomLevelLimits(1, 1);
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: 'LoL Overlay',
    icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(__dirname, '..', 'build', 'icon.ico'),
    backgroundColor: '#0b0309',
    frame: false, // barra de título própria (renderer/index.html #bar)
    autoHideMenuBar: true,
    webPreferences: webPrefs(),
  });
  lockDownWindow(mainWin);
  mainWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWin.on('closed', () => app.quit());
  const sendMax = () => send('win:maximized', mainWin.isMaximized());
  mainWin.on('maximize', sendMax);
  mainWin.on('unmaximize', sendMax);
}

function createOverlayWindow() {
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
  overlayWin = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    hasShadow: false,
    show: false,
    webPreferences: webPrefs(),
  });
  lockDownWindow(overlayWin);
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
}

function updateOverlayVisibility() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const inGame = lastState.phase === 'ingame';
  const always = overlayAlways || settings.get().overlay.mode === 'always';
  const previewing = Boolean(previewTimer);
  const show = moveMode || previewing || (inGame && (tabDown || always));
  const visible = overlayWin.isVisible();
  if (show && !visible) {
    placeOverlayOnActiveDisplay();
    overlayWin.showInactive();
    logger.log(`overlay: mostrado (tab=${tabDown} jogo=${inGame} sempre=${always} editar=${moveMode} teste=${previewing})`);
  } else if (show && visible && tabDown) {
    // o jogo ao ganhar foco pode empurrar janelas "sempre no topo" para trás: reafirma
    overlayWin.setAlwaysOnTop(true, 'screen-saver');
    overlayWin.moveTop();
  } else if (!show && visible) {
    overlayWin.hide();
    logger.log('overlay: oculto');
  }
}

/** O overlay cobre o monitor onde está o mouse (normalmente o do jogo), não só o principal. */
function placeOverlayOnActiveDisplay() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  overlayWin.setBounds(display.bounds);
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
}

/** Mostra o overlay com dados de exemplo por alguns segundos (teste de que a janela aparece). */
function previewOverlay(ms = 5000) {
  clearTimeout(previewTimer);
  send('preview', true);
  previewTimer = setTimeout(() => {
    previewTimer = null;
    send('preview', false);
    updateOverlayVisibility();
  }, ms);
  updateOverlayVisibility();
}

function setTab(source, down) {
  if (source === 'hook') hookTab = down;
  else pollTab = down;
  const next = hookTab || pollTab;
  if (next === tabDown) return;
  tabDown = next;
  if (next) hook.tabPresses += 1;
  logger.log(`TAB ${next ? 'pressionado' : 'solto'} (via ${source})`);
  updateOverlayVisibility();
}

/**
 * Detecta TAB de duas formas independentes: hook global (uiohook) e leitura direta do estado da
 * tecla (GetAsyncKeyState via PowerShell). Se uma falhar ou for bloqueada, a outra segura.
 */
function startTabHook() {
  startKeyPoller();
  try {
    const { uIOhook } = require('uiohook-napi');
    uIOhook.on('keydown', (e) => {
      hook.lastKeyAt = Date.now();
      if (e.keycode === TAB_KEYCODE) setTab('hook', true);
    });
    uIOhook.on('keyup', (e) => {
      if (e.keycode === TAB_KEYCODE) setTab('hook', false);
    });
    uIOhook.start();
    hook.loaded = true;
    logger.log('hook de teclado: ok');
    return true;
  } catch (err) {
    hook.error = err.message;
    logger.log(`hook de teclado falhou: ${err.message}`);
    return false;
  }
}

function startKeyPoller() {
  if (process.platform !== 'win32') return;
  const script = [
    "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class K { [DllImport(\"user32.dll\")] public static extern short GetAsyncKeyState(int k); }'",
    '$p = $false',
    'while ($true) {',
    '  $d = ([K]::GetAsyncKeyState(9) -band 0x8000) -ne 0',
    '  if ($d -ne $p) { $p = $d; Write-Output ([int]$d); [Console]::Out.Flush() }',
    '  Start-Sleep -Milliseconds 25',
    '}',
  ].join('\n');
  try {
    keyPoller = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true });
    hook.poller = 'iniciando';
    keyPoller.stdout.on('data', (buf) => {
      hook.poller = 'ok';
      const last = String(buf).trim().split(/\s+/).pop();
      if (last === '1') setTab('poll', true);
      if (last === '0') setTab('poll', false);
    });
    keyPoller.stderr.on('data', (buf) => {
      const msg = String(buf).replace(/#< CLIXML/g, '').replace(/<[^>]+>/g, ' ').trim(); // ruído de progresso do PowerShell
      if (msg) logger.log(`leitor de teclas: ${msg.slice(0, 200)}`);
    });
    keyPoller.on('exit', (code) => {
      hook.poller = `encerrado (${code})`;
      logger.log(`leitor de teclas encerrou (${code})`);
    });
    keyPoller.on('error', (err) => {
      hook.poller = `falhou: ${err.message}`;
      logger.log(`leitor de teclas falhou: ${err.message}`);
    });
  } catch (err) {
    hook.poller = `falhou: ${err.message}`;
  }
}

/** Modo mover: o overlay fica visível e aceita o mouse para ser arrastado. */
function toggleMoveMode() {
  moveMode = !moveMode;
  overlayWin.setIgnoreMouseEvents(!moveMode, { forward: true });
  send('move-mode', moveMode);
  updateOverlayVisibility();
  return moveMode;
}

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+M', toggleMoveMode);
  // Alterna "overlay sempre visível" (útil para posicionar ou se o hook de TAB falhar).
  globalShortcut.register('CommandOrControl+Shift+O', () => {
    overlayAlways = !overlayAlways;
    updateOverlayVisibility();
  });
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());
  // Ctrl+Shift+1..5: marca o Flash do inimigo n (na ordem do placar) no painel de timers.
  for (let n = 1; n <= 5; n++) globalShortcut.register(`CommandOrControl+Shift+${n}`, () => send('spell-mark', { index: n - 1, spell: 'SummonerFlash' }));
}

/* ---------- dados ---------- */

async function loadDataDragon() {
  const instance = new DataDragon({
    cacheDir: path.join(app.getPath('userData'), 'ddragon'),
    lang: 'pt_BR',
  });
  try {
    await instance.init();
    dd = instance;
    setStatus(`Data Dragon ${dd.version}${USE_MOCK ? ' · MOCK' : ''}`, 'ok');
    loadRuneIndex(dd.version);
  } catch (err) {
    setStatus(`Sem dados do Data Dragon (${err.message}). Tentando de novo…`, 'warn');
    setTimeout(loadDataDragon, DD_RETRY_MS);
  }
}

async function loadRuneIndex(version) {
  try {
    const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/pt_BR/runesReforged.json`);
    if (res.ok) {
      runeStyles = await res.json();
      runeIndex = indexRunes(runeStyles);
    }
  } catch {
    // sem ícones de runa: a UI mostra só os nomes
  }
}

function champById(id) {
  return dd && dd.champions[String(id)] ? dd.champions[String(id)] : null;
}

/** Oponente de rota já revelado no champ select (ou null). */
let lastRegion = null;
let recorder = null;
let meraki = null;
let elo = null;
let matchupPick = null; // { session, id } oponente escolhido à mão no guia (quando a rota inimiga não aparece)
function laneEnemy() {
  const enemies = (lcuState.enemies || []).filter((x) => x.champion);
  if (matchupPick && matchupPick.session === lcuState.sessionId) {
    if (matchupPick.id === 'none') return null;
    const picked = enemies.find((x) => x.champion.id === matchupPick.id);
    if (picked) return picked.champion;
  }
  const role = lastRole || lcuState.myPosition;
  const e = enemies.find((x) => x.position === role) || enemies.find((x) => !x.position && x.predicted === role && x.confidence >= 50);
  return e ? e.champion : null;
}

function buildFor(champ, role) {
  const opp = laneEnemy();
  return withMatchup(remote.getBuild(champ, role), opp && remote.getMatchup(champ, opp, role), opp && opp.name);
}

const ROLE_PT = { top: 'Topo', jungle: 'Selva', middle: 'Meio', bottom: 'Atirador', utility: 'Suporte' };
const pctTxt = (x) => (typeof x === 'number' && x > 0 ? `${Math.round(x * (x <= 1 ? 100 : 1))}%` : null);

/** Até 2 builds para escolher: a mais jogada e, se houver, a do matchup; senão uma rota de itens alternativa. */
function buildVariants(champ, role) {
  const base = remote.getBuild(champ, role);
  if (!base) return [];
  const opp = laneEnemy();
  const mu = opp && remote.getMatchup(champ, opp, role);
  const wr = pctTxt(base.winRate);
  const out = [{ label: 'Mais jogada', sub: [pctTxt(base.corePick) && `${pctTxt(base.corePick)} dos jogadores`, wr && `WR ${wr}`].filter(Boolean).join(' · ') || 'OP.GG', build: base }];
  const vsMu = mu && withMatchup(base, mu, opp.name);
  if (vsMu && vsMu.matchup && vsMu.matchup.used.length) {
    out.push({ label: `Contra ${opp.name}`, sub: `ajusta ${vsMu.matchup.used.join(', ')}`, build: vsMu });
  } else {
    const later = laterItems(base);
    if (base.core.length >= 2 && later.length >= 2) {
      const alt = { ...base, core: [base.core[0], ...later.slice(0, 2)], later: [base.core.slice(1).map((id) => ({ ids: [id], pick: 1 })), ...base.later] };
      out.push({ label: 'Itens alternativos', sub: 'mesmas runas, outro caminho de itens', build: alt });
    }
  }
  return out;
}

const TIER_PT_MAIN = { ALL: 'Todos os elos', GOLD: 'Ouro', PLATINUM_PLUS: 'Platina+', EMERALD_PLUS: 'Esmeralda+', DIAMOND_PLUS: 'Diamante+', MASTER_PLUS: 'Mestre+', CHALLENGER: 'Desafiante' };

/** Até 2 páginas de runas (OP.GG, com jogos/pick %/win %); sem elas, a da build. */
function runePagesFor(champ, role, build) {
  const pages = remote.getRunePages(champ, role) || (build && build.runes ? [{ ...build.runes, tier: null }] : []);
  return pages.map((r, i) => ({
    label: i === 0 ? 'Página 1' : 'Página 2',
    runes: r,
    stats: { pickRate: r.pickRate || 0, winRate: r.winRate || 0, games: r.games || 0, tier: r.tier ? TIER_PT_MAIN[r.tier] || r.tier : null },
    view: {
      primaryStyleName: r.primaryStyleName, subStyleName: r.subStyleName,
      perks: r.perks.map((id) => ({ id, name: (runeIndex && runeIndex[id] && runeIndex[id].name) || String(id), icon: (runeIndex && runeIndex[id] && runeIndex[id].icon) || null })),
    },
    runeTree: runeStyles ? runeTree(runeStyles, r) : null,
  }));
}

/**
 * Importa runas/feitiços/itens do OP.GG para o cliente. `what`: runes | spells | items | both.
 * `forRole`: rota explícita (página do campeão na tier list); sem ela, a rota do champ select.
 */
async function importBuild(championId, what, variant = 0, runePage = 0, forRole = null) {
  const champ = champById(championId);
  const role = forRole || lastRole || lcuState.myPosition;
  const variants = champ ? (forRole ? [{ build: remote.getBuild(champ, role) }] : buildVariants(champ, role)) : [];
  const build = (variants[variant] || variants[0] || {}).build;
  const creds = lcuEngine.getCreds();
  if (!build) return { ok: false, error: 'Ainda não há dados do OP.GG para este campeão.' };
  if (!creds) return { ok: false, error: 'Cliente do LoL não conectado.' };
  const done = [];
  try {
    if (what !== 'spells' && what !== 'items') {
      const pages = remote.getRunePages(champ, role);
      const runes = (pages && pages[runePage]) || build.runes;
      if (!runes) throw new Error('sem runas nos dados do OP.GG');
      await importRunes(creds, runes, champ.name);
      done.push('runas');
    }
    if (what !== 'runes' && what !== 'items') {
      await importSpells(creds, build.spells, { flashOnF: settings.get().flashKey !== 'D' });
      done.push('feitiços');
    }
    if (what === 'items' || what === 'both') {
      const enemyChamps = (lcuState.enemies || []).filter((x) => x.champion).map((x) => dd.champions[x.champion.id] || x.champion);
      await importItemSet(creds, { ...build, situational: situationalItems({ champ, build, enemies: enemyChamps, dd }).map((x) => x.id) }, champ);
      done.push('itens da loja');
    }
    return { ok: true, done };
  } catch (err) {
    return { ok: false, error: err.message, done };
  }
}

/* Importação automática: ao travar o campeão, importa tudo assim que a build do OP.GG chegar. */
let autoImported = '';
function maybeAutoImport(state) {
  if (!settings.get().autoImport || state.phase !== 'champselect' || !state.me || !state.me.locked || !state.me.champion) return;
  const champ = state.me.champion;
  const key = `${state.sessionId || ''}:${champ.id}`;
  if (autoImported === key) return;
  const role = state.myPosition || lastRole;
  const run = async () => {
    if (autoImported === key || !buildFor(champ, role)) return;
    autoImported = key;
    const res = await importBuild(champ.id, 'both');
    logger.log(`importação automática de ${champ.id}: ${res.ok ? res.done.join(', ') : res.error}`);
    send('auto-import', { championId: String(champ.id), name: champ.name, ...res });
  };
  if (buildFor(champ, role)) run();
  else remote.ensureBuild(champ, role, run, 30);
}

async function guideFor(championId) {
  const champ = champById(championId);
  if (!champ) return null;
  const role = lastRole || (lcuState.myPosition || '');
  const build = buildFor(champ, role);
  if (!build) {
    const error = remote.buildError(champ, role);
    return error ? { error: `Sem dados do OP.GG: ${error}`, champion: { id: champ.id, name: champ.name } } : null;
  }
  const skills = await dd.championSkills(champ.id).catch(() => null);
  const enemyChamps = (lcuState.enemies || []).filter((x) => x.champion).map((x) => dd.champions[x.champion.id] || x.champion);
  const variants = buildVariants(champ, role).map((v) => ({
    label: v.label, sub: v.sub,
    guide: { ...buildGuide({ champ, role, build: v.build, dd, runeIndex, runeStyles, skills }), situational: situationalItems({ champ, build: v.build, enemies: enemyChamps, dd }) },
  }));
  const fromRole = remote.getBuild(champ, role) && remote.getBuild(champ, role).fromRole;
  const roleNote = fromRole ? `${role ? 'Sem dados nesta rota' : 'Sem rota definida (modo treino/personalizada)'}: usando a build de ${ROLE_PT[fromRole]}.` : null;
  const opp = laneEnemy();
  const opponents = (lcuState.enemies || []).filter((x) => x.champion).map((x) => ({ id: x.champion.id, name: x.champion.name }));
  const mode = matchupPick && matchupPick.session === lcuState.sessionId ? matchupPick.id : 'auto';
  const pending = opp && !remote.getMatchup(champ, opp, role) ? `Buscando o matchup contra ${opp.name}…` : null;
  const oppKit = opp ? abilityCard(dd.champions[opp.id] || opp, 1) : null;
  const runePages = runePagesFor(champ, role, build);
  return { ...variants[0].guide, variants, runePages, roleNote, opponents, matchupMode: mode, opponent: opp ? opp.name : null, pending, oppKit };
}

const PARTNER = { top: 'jungle', jungle: 'middle', middle: 'jungle', bottom: 'utility', utility: 'bottom' };

/** Rotas em que o campeão aparece na tier list (mais jogada primeiro). */
function rolesOf(champ) {
  const tl = remote.getTierList();
  if (!tl || !dd) return [];
  const out = [];
  for (const [role, rows] of Object.entries(tl.data)) {
    const r = rows.find((x) => { const c = dd.championByRaw(null, x.champion); return c && c.id === champ.id; });
    if (r) out.push({ role, roleRate: r.roleRate || 0, tier: r.tier });
  }
  return out.sort((a, b) => b.roleRate - a.roleRate);
}

/** Página do campeão: tudo que o OP.GG tem dele numa rota, sem depender do champ select. */
async function champDetail(id, wanted) {
  const champ = champById(id);
  if (!champ) return null;
  const roles = rolesOf(champ);
  const role = ROLE_PT[wanted] ? wanted : (roles[0] && roles[0].role) || null;
  const partner = role && PARTNER[role];
  const notify = () => send('champ-detail-updated', { id: champ.id });
  remote.ensureBuild(champ, role, notify, 22);
  remote.ensureRunePages(champ, role, notify);
  if (partner) remote.ensureSynergyList(champ, role, partner, notify);
  const build = remote.getBuild(champ, role);
  const skills = await dd.championSkills(champ.id).catch(() => null);
  const named = (name) => { const c = dd.championByRaw(null, name); return c ? { id: c.id, name: c.name } : { id: null, name }; };
  // win_rate dos counters = chance do OUTRO campeão vencer; aqui mostramos a WR deste campeão contra ele
  // (cache antigo sem o WR bruto: reconstrói pela nota, que é (WR - 50%) / 8%)
  const counters = (list, sign) => (list || []).map((c) => {
    const opp = c.oppWinRate != null ? c.oppWinRate : 0.5 + (sign * (c.value || 0) * 0.08);
    return { ...named(c.name), winRate: 1 - opp, games: c.games };
  });
  const syn = partner ? remote.getSynergyList(champ, role, partner) : null;
  const tlRow = roles.find((r) => r.role === role);
  return {
    champion: { id: champ.id, name: champ.name, title: champ.title || '' },
    role, roles: roles.map((r) => r.role), partner, tier: tlRow ? tlRow.tier : null,
    winRate: build ? build.winRate : null,
    error: build ? null : remote.buildError(champ, role),
    guide: build ? { ...buildGuide({ champ, role, build, dd, runeIndex, runeStyles, skills }), situational: [] } : null,
    runePages: build ? runePagesFor(champ, role, build) : [],
    kit: abilityCard(champ, 1),
    // weak = quem counteria este campeão (ele perde); strong = quem ele counteria (ele ganha)
    losesTo: build ? counters(build.weakCounters, 1).sort((a, b) => a.winRate - b.winRate).slice(0, 6) : [],
    beats: build ? counters(build.strongCounters, -1).sort((a, b) => b.winRate - a.winRate).slice(0, 6) : [],
    synergies: syn ? syn.slice().sort((a, b) => b.winRate - a.winRate).slice(0, 6).map((s) => ({ ...named(s.name), winRate: s.winRate, games: s.games })) : null,
    synergyError: partner && !syn ? remote.synergyError(champ, role, partner) : null,
  };
}

/** Busca (se preciso) tier list, builds dos inimigos e dos candidatos de pick. */
function prefetchChampSelect(state, done) {
  if (state.phase !== 'champselect' || !state.myPosition || !dd) return;
  const role = state.myPosition;
  remote.ensureTiers(role, done);
  const mine = state.me && state.me.champion;
  if (mine) { remote.ensureBuild(mine, role, done, 25); remote.ensureRunePages(mine, role, done); }
  for (const e of state.enemies) {
    if (e.champion) remote.ensureBuild(e.champion, e.position || role, done);
  }
  const picks = (state.advice && state.advice.picks && state.advice.picks.candidates) || [];
  picks.slice(0, 6).forEach((c, i) => remote.ensureBuild({ id: c.id }, role, done, 10 - i));
  const opp = state.enemies.find((e) => e.champion && e.position === role);
  if (opp) for (const c of picks.slice(0, 4)) remote.ensureMatchup({ id: c.id }, opp.champion, role, done);
  for (const a of state.allies) if (a.champion && a.position) remote.ensureSynergy(a.champion, a.position, role, done);
}

/** Seu elo solo (lido do cliente; sem ele, Ouro como referência). */
function myTier() {
  const p = lcuEngine && lcuEngine.getProfile();
  return (p && p.summoner && p.summoner.rank && p.summoner.rank.tier) || 'GOLD';
}

function currentRegion() {
  const s = settings.get().region;
  if (s && s !== 'auto') return s;
  const r = (lcuState.opgg && lcuState.opgg.region) || (lcuEngine && lcuEngine.getRegion());
  if (r) lastRegion = r;
  return lastRegion || 'br';
}

/** Jogadores para o lane scouting: oponente de rota e o caçador inimigo (quem tem Golpear). */
// A Live API pode esconder o Riot ID dos inimigos ("#"). Nesse caso pegamos pelo cliente (gameflow -> puuid -> Riot ID).
const validRiotId = (id) => /^[^#]+#[^#]+$/.test(String(id || ''));
const enemyIds = new Map(); // championId do DDragon -> 'Nome#TAG'
let enemyIdsGame = null;
let enemyIdsBusy = false;
async function resolveEnemyIds(state) {
  const creds = lcuEngine && lcuEngine.getCreds();
  if (!creds || enemyIdsBusy || !dd) return;
  const gameKey = state.enemies.map((e) => e.championId).join(',');
  if (enemyIdsGame === gameKey) return;
  enemyIdsBusy = true;
  try {
    const session = await lcuGetJson(creds, '/lol-gameflow/v1/session');
    const gd = (session && session.gameData) || {};
    for (const p of [...(gd.teamOne || []), ...(gd.teamTwo || [])]) {
      const champ = dd.championByKey(p.championId);
      if (!champ || !p.puuid) continue;
      let id = p.gameName && p.tagLine ? `${p.gameName}#${p.tagLine}` : null;
      if (!id) {
        const s = await lcuGetJson(creds, `/lol-summoner/v2/summoners/puuid/${encodeURIComponent(p.puuid)}`).catch(() => null);
        if (s && s.gameName && s.tagLine) id = `${s.gameName}#${s.tagLine}`;
      }
      if (id) enemyIds.set(champ.id, id);
    }
    enemyIdsGame = gameKey;
    logger.log(`scouting: ${enemyIds.size} Riot IDs resolvidos pelo cliente`);
  } catch (err) {
    logger.log(`scouting: não consegui ler a sessão do cliente (${err.message})`);
    enemyIdsGame = gameKey; // não fica tentando a cada tick
  } finally {
    enemyIdsBusy = false;
  }
}
const riotIdOf = (p) => (validRiotId(p.riotId) ? p.riotId : enemyIds.get(p.championId) || null);

function scoutTargets(state) {
  const out = [];
  if (state.laneOpponent) out.push({ who: 'Rota', p: state.laneOpponent });
  const jg = (state.enemies || []).find((e) => (e.spells || []).includes('SummonerSmite') && e !== state.laneOpponent);
  if (jg) out.push({ who: 'Selva', p: jg });
  return out.map((x) => ({ ...x, riotId: riotIdOf(x.p) }));
}

/** Habilidades do campeão (nome + recarga por nível): Meraki, ou Data Dragon se o Meraki ainda não tiver o campeão. */
const kits = new Map();
function kitOf(champId) {
  if (!champId) return null;
  if (kits.has(champId)) return kits.get(champId);
  kits.set(champId, null);
  (async () => {
    let k = await meraki.champion(champId);
    let source = 'Meraki';
    if (!k || !k.abilities.some((a) => a.cooldowns.length)) {
      const s = dd && (await dd.championSkills(champId).catch(() => null));
      if (s) { k = { abilities: s.spells.map((a) => ({ key: a.key, name: a.name, cooldowns: a.cooldowns })) }; source = 'Data Dragon'; }
    }
    if (k) kits.set(champId, { ...k, source });
    if (liveEngine) liveEngine.tick();
    send('guide-updated', { championId: '*' });
  })();
  return null;
}
const cdText = (cds) => (!cds || !cds.length ? '—' : cds[0] === cds[cds.length - 1] ? `${cds[0]} s` : `${cds[0]}→${cds[cds.length - 1]} s`);
/** Resumo para a UI: recarga de cada habilidade e a da ult no nível atual do oponente. */
function abilityCard(champ, level) {
  const kit = kitOf(champ && champ.id);
  if (!kit) return null;
  const r = ultRank(level || 1);
  return {
    champion: champ.name, id: champ.id, source: kit.source,
    abilities: kit.abilities.map((a) => ({ key: a.key, name: a.name, cd: cdText(a.cooldowns) })),
    ult: r ? { rank: r, cd: kit.abilities[3] && kit.abilities[3].cooldowns[r - 1] } : null,
  };
}

/** Acrescenta ao estado da partida: lane scouting e fases (early/mid/late) do matchup. */
function decorateLive(state) {
  if (state.phase !== 'ingame' || !state.advice) return state;
  const region = currentRegion();
  state.advice.scout = scoutTargets(state).map(({ who, p, riotId }) => {
    const prof = riotId ? remote.getScout(riotId, region) : null;
    const onChamp = prof && prof.champs.find((c) => c.name.toLowerCase() === String(p.champion).toLowerCase());
    const error = !riotId ? (enemyIdsGame ? 'Nome oculto pela Riot nesta partida' : 'Buscando o nome no cliente…') : !prof ? remote.scoutError(riotId, region) : null;
    return { who, champion: p.champion, championId: p.championId, riotId: riotId || 'nome oculto', profile: prof, onChamp: onChamp || null, error };
  });
  const meC = dd && dd.champions[state.me.championId];
  const opC = dd && state.laneOpponent && dd.champions[state.laneOpponent.championId];
  state.advice.phases = meC && opC ? phaseCompare(meC, opC) : null;
  state.advice.oppKit = opC ? abilityCard(opC, state.laneOpponent.level) : null;
  state.advice.goals = liveGoals(state, myTier(), state.myRole);
  return state;
}

function prefetchInGame(state, me, opp) {
  const region = currentRegion();
  const targets = scoutTargets(state);
  if (targets.some((t) => !t.riotId)) resolveEnemyIds(state).then(() => liveEngine.tick());
  for (const t of targets) if (t.riotId) remote.ensureScout(t.riotId, region, () => liveEngine.tick());
  // a Live API muitas vezes não informa a rota: sem rota, o OP.GG escolhe a mais comum do campeão
  remote.ensureBuild(me, state.myRole, () => liveEngine.tick());
  if (opp) remote.ensureMatchup(me, opp, state.myRole, () => liveEngine.tick());
}

/** Champ select: rotas previstas do time inimigo; tela inicial: champion fit. */
function decorateLcu(state) {
  const tl = remote.getTierList();
  if (state.phase === 'champselect') {
    remote.ensureTierList(() => lcuEngine.tick());
    if (tl) state.enemies = predictRoles(state.enemies || [], roleIndex(tl.data, dd));
  }
  if (state.home && !state.home.loading) {
    if (!tl) remote.ensureTierList(() => lcuEngine.tick());
    const profile = lcuEngine && lcuEngine.getProfile();
    const mRiot = settings.get().myRiotId;
    const recent = mRiot && remote.getMatches(mRiot, currentRegion());
    const mainRole = mainRoleOf({ matches: recent && recent.list, roles: state.home.roles });
    state.home.fit = profile && tl ? championFit({ mastery: profile.mastery, dd, tierList: tl.data, mainRole, roleStats: profile.roleStats }) : [];
    const s = profile && profile.summoner;
    if (s && s.gameName && s.tagLine && settings.get().myRiotId !== `${s.gameName}#${s.tagLine}`) settings.update({ myRiotId: `${s.gameName}#${s.tagLine}` });
    if (s && s.rank) elo.record(s.rank);
    const riotId = settings.get().myRiotId;
    if (riotId) remote.ensureMatches(riotId, currentRegion(), () => lcuEngine.tick());
    const m = riotId && remote.getMatches(riotId, currentRegion());
    state.home.elo = { lp: elo.summary(), week: m ? weekStats(m.list) : null };
    state.home.mainRole = mainRole || null;
  }
  return state;
}

/* ---------- IPC ---------- */

function registerIpc() {
  ipcMain.on('renderer-ready', () => {
    send('status', lastStatus);
    send('state', lastState);
  });

  ipcMain.handle('open-multisearch', async (_e, side) => {
    const opgg = lcuState.opgg || {};
    const url = side === 'enemies' ? opgg.enemies : opgg.allies;
    if (typeof url !== 'string' || !url.startsWith(OPGG_PREFIX)) return { ok: false };
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('guide:get', (_e, championId) => {
    const champ = champById(championId);
    if (champ) {
      const role = lastRole || lcuState.myPosition;
      const notify = () => send('guide-updated', { championId: String(championId) });
      remote.ensureBuild(champ, role, notify, 20);
      remote.ensureRunePages(champ, role, notify);
      const opp = laneEnemy();
      if (opp) remote.ensureMatchup(champ, opp, role, notify);
    }
    return guideFor(championId);
  });

  // Página do campeão (aberta pela tier list): build, runas, skills, counters e sinergias numa rota.
  ipcMain.handle('champ:detail', (_e, { id, role } = {}) => champDetail(id, role));

  // Tier list ranqueada (OP.GG): todas as rotas, com a fonte e o patch.
  ipcMain.handle('tierlist:get', (_e, opts = {}) => {
    const force = Boolean(opts && opts.force);
    const tier = opts && TIER_PT_MAIN[opts.tier] ? opts.tier : 'EMERALD_PLUS';
    const done = () => send('tierlist-updated', true);
    remote.ensureTierList(done, force && tier === 'EMERALD_PLUS');
    const e = remote.getTierList();
    const withIds = (rows) => rows.map((r) => {
      const c = dd && dd.championByRaw(null, r.champion);
      return { ...r, id: c ? c.id : null, name: c ? c.name : r.champion };
    });
    const base = { at: e ? e.at : null, patch: dd ? dd.version : null, tier, error: e ? null : remote.tierListError() };
    if (!e) return { ...base, data: null };
    if (tier === 'EMERALD_PLUS') {
      const data = {};
      for (const [role, rows] of Object.entries(e.data)) data[role] = withIds(rows);
      return { ...base, data };
    }
    // Outro elo: uma rota por vez (cada campeão é uma consulta ao OP.GG).
    const role = opts && e.data[opts.role] ? opts.role : null;
    if (!role) return { ...base, data: {}, needRole: true };
    const champs = withIds(e.data[role]).filter((r) => r.id && (r.roleRate || 0) >= 0.05).map((r) => ({ id: r.id, champion: r.champion, roleRate: r.roleRate }));
    remote.ensureTierListElo(role, tier, champs, done, force);
    const got = remote.getTierListElo(role, tier);
    return {
      ...base, at: got ? got.at : null, data: got ? { [role]: withIds(got.data) } : null,
      loading: remote.tierListEloLoading(role, tier) ? champs.slice(0, 40).length : 0,
    };
  });

  // One-tricks do campeão (OP.GG): ranking + última build de cada um.
  ipcMain.handle('otp:get', (_e, championId) => {
    const champ = champById(championId);
    if (!champ) return { list: [] };
    const region = currentRegion();
    remote.ensureOtp(champ, region, () => send('otp-updated', { championId: champ.id }));
    const spellsData = require('../data/spells.json');
    const list = (remote.getOtp(champ, region) || []).map((p) => ({
      ...p,
      build: p.build && {
        ...p.build,
        keystoneIcon: runeIndex[p.build.keystone] ? runeIndex[p.build.keystone].icon : null,
        keystoneName: runeIndex[p.build.keystone] ? runeIndex[p.build.keystone].name : '',
        secondaryIcon: runeIndex[p.build.secondary] ? runeIndex[p.build.secondary].icon : null,
        spellKeys: (p.build.spells || []).map((id) => (spellsData[id] || {}).key).filter(Boolean),
      },
    }));
    return { list, region, error: list.length ? null : remote.otpError(champ, region) };
  });

  // Importa a build de um one-trick: itens e feitiços dele; runas do meta se a runa principal for a mesma.
  ipcMain.handle('otp:import', async (_e, { championId, index }) => {
    const champ = champById(championId);
    const creds = lcuEngine.getCreds();
    const p = champ && (remote.getOtp(champ, currentRegion()) || [])[Number(index)];
    if (!p || !p.build) return { ok: false, error: 'sem build desse jogador' };
    if (!creds) return { ok: false, error: 'Cliente do LoL não conectado.' };
    const done = [];
    const notes = [];
    try {
      const isBoots = (id) => isBootsItem(dd, id);
      const big = (id) => (((dd.item(id) || {}).gold || {}).total || 0) >= 900;
      const meta = buildFor(champ, lastRole || lcuState.myPosition) || { starter: [], runes: null };
      const set = { starter: meta.starter || [], boots: p.build.items.filter(isBoots), core: p.build.items.filter((id) => !isBoots(id) && big(id)), later: [], matchup: null };
      await importItemSet(creds, set, { ...champ, name: `${champ.name} (${p.riotId.split('#')[0]})` });
      done.push('itens');
      if (p.build.spells && p.build.spells.length === 2) {
        await importSpells(creds, p.build.spells, { flashOnF: settings.get().flashKey !== 'D' });
        done.push('feitiços');
      }
      if (meta.runes && meta.runes.perks[0] === p.build.keystone) {
        await importRunes(creds, meta.runes, champ.name);
        done.push('runas');
      } else {
        notes.push('runas não importadas: o OP.GG só mostra a runa principal dele, diferente da página do meta');
      }
      return { ok: true, done, notes };
    } catch (err) {
      return { ok: false, error: err.message, done };
    }
  });

  // Clique num campeão do app -> marca (hover) no cliente. Ban só na sua vez de banir.
  ipcMain.handle('champselect:hover', async (_e, { championId, kind }) => {
    const champ = champById(championId);
    const creds = lcuEngine.getCreds();
    if (!champ || !creds) return { ok: false, error: 'Cliente do LoL não conectado.' };
    try {
      await hoverChampion(creds, champ.key, kind === 'ban' ? 'ban' : 'pick');
      lcuEngine.tick();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Pós-partida pelo OP.GG: lista de partidas recentes e revisão detalhada de uma partida.
  ipcMain.handle('opgg:matches', (_e, force) => {
    const riotId = settings.get().myRiotId;
    const region = currentRegion();
    if (!riotId) return { riotId: null, list: [], error: 'Abra o cliente do LoL uma vez (ou informe seu Riot ID em Configurações).' };
    remote.ensureMatches(riotId, region, () => send('matches-updated', true), Boolean(force));
    const m = remote.getMatches(riotId, region);
    const ddId = (name) => { const c = dd && dd.championByRaw(null, name); return c ? c.id : null; };
    const list = m ? m.list.map((g) => ({ ...g, me: g.me && { ...g.me, id: ddId(g.me.champion) } })) : [];
    return { riotId, region, list, at: m ? m.at : null, error: m ? null : remote.matchesError(riotId, region) };
  });
  ipcMain.handle('opgg:review', async (_e, { id, createdAt }) => {
    const riotId = settings.get().myRiotId;
    try {
      const detail = await remote.gameDetail(String(id), String(createdAt), riotId, currentRegion());
      const ddId = (name) => { const c = dd && dd.championByRaw(null, name); return c ? c.id : null; };
      for (const t of detail.teams) for (const p of t.players) p.id = ddId(p.champion);
      const review = reviewMatch(detail, {
        coreOf: (name, role) => { const id = ddId(name); const b = id && remote.getBuild({ id }, role); return b ? b.core : []; },
        itemName: (itemId) => ((dd && dd.item(itemId)) || {}).name || String(itemId),
        tier: myTier(),
      });
      return { ok: true, detail, review };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('history:list', () => recorder.list().map((r) => ({ id: r.id, at: r.at, champion: r.champion, result: r.result, duration: r.duration, final: r.final, role: r.role, opponent: r.opponent, mode: r.mode, good: r.analysis.good.length, bad: r.analysis.bad.length })));
  ipcMain.handle('history:get', (_e, id) => recorder.get(String(id)));

  // Escolha manual do oponente do matchup ('auto' volta à detecção pela rota, 'none' = só a build geral).
  ipcMain.handle('matchup:set', (_e, id) => {
    matchupPick = id && id !== 'auto' ? { session: lcuState.sessionId, id: String(id) } : null;
    return true;
  });

  ipcMain.handle('import:build', (_e, { championId, what, variant, runePage, role }) =>
    importBuild(championId, what, Number(variant) || 0, Number(runePage) || 0, ROLE_PT[role] ? role : null));

  ipcMain.handle('overlay:toggle-move', () => toggleMoveMode());
  ipcMain.handle('win:minimize', () => mainWin && mainWin.minimize());
  ipcMain.handle('win:toggle-max', () => { if (mainWin) (mainWin.isMaximized() ? mainWin.unmaximize() : mainWin.maximize()); });
  ipcMain.handle('win:close', () => mainWin && mainWin.close());
  ipcMain.handle('update:get', () => (updater ? updater.get() : { state: 'idle' }));
  ipcMain.handle('update:check', () => (updater ? updater.check({ manual: true }) : { state: 'error', message: 'Atualização só funciona no app instalado.' }));
  ipcMain.handle('update:install', () => { if (updater) updater.install(); return true; });
  ipcMain.handle('overlay:preview', () => { previewOverlay(5000); return true; });

  // O painel só captura o mouse enquanto o cursor está sobre ele; no resto da tela o clique vai para o jogo.
  ipcMain.on('overlay:interactive', (_e, on) => {
    if (!moveMode && overlayWin && !overlayWin.isDestroyed()) overlayWin.setIgnoreMouseEvents(!on, { forward: true });
  });

  ipcMain.handle('diag:get', () => ({
    version: app.getVersion(),
    hook: { ...hook, lastKeyAgoMs: hook.lastKeyAt ? Date.now() - hook.lastKeyAt : null },
    logFile: logger.file,
    tabDown,
    live: { phase: liveState.phase, reason: liveState.reason || '' },
    client: lcuState.client || lcuState.phase,
    overlay: {
      visible: Boolean(overlayWin && overlayWin.isVisible()),
      mode: settings.get().overlay.mode,
      bounds: overlayWin ? overlayWin.getBounds() : null,
    },
  }));

  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (_e, patch) => {
    const next = settings.update(patch);
    send('settings-changed', next);
    updateOverlayVisibility();
    if (lcuEngine) lcuEngine.tick();
    return next;
  });
  ipcMain.handle('open-data-folder', async () => {
    await shell.openPath(app.getPath('userData'));
    return { ok: true };
  });
}

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  logger = createLogger(path.join(userData, 'overlay.log'));
  logger.log(`LoL Overlay ${app.getVersion()} iniciou (${process.platform})`);
  settings = createSettingsStore(path.join(userData, 'settings.json'));
  meta = loadMeta([path.join(__dirname, '..', 'data', 'meta.json'), path.join(userData, 'meta.json')]);

  elo = createEloTracker({ dir: userData });
  meraki = createMeraki({ cacheDir: path.join(userData, 'meraki') });
  recorder = createRecorder({ dir: userData, dd: () => dd, log: (m) => logger.log(m) });
  remote = createRemoteData({
    cacheDir: path.join(userData, 'remote'),
    isEnabled: () => !USE_MOCK && settings.get().remoteData.enabled,
    onStatus: (text, level) => setStatus(text, level),
    getTier: () => settings.get().buildTier,
  });

  if (!DEVTOOLS_ALLOWED) Menu.setApplicationMenu(null); // sem menu padrão do Electron (View > Toggle DevTools etc.)
  createMainWindow();
  createOverlayWindow();
  registerShortcuts();
  registerIpc();
  if (!USE_MOCK) startTabHook();
  else overlayAlways = true;
  // teste visual na abertura: se você vê este painel, a janela do overlay funciona
  overlayWin.webContents.once('did-finish-load', () => setTimeout(() => previewOverlay(4000), 600));

  liveEngine = createEngine({
    baseUrl: LIVE_URL,
    getDd: () => dd,
    getBuild: (champ, role) => remote.getBuild(champ, role),
    getMatchup: (me, opp, role) => remote.getMatchup(me, opp, role),
    getRoleHint: () => lastRole,
    onError: (err) => logger.log(`erro nas sugestões: ${err.stack || err.message}`),
    prefetch: prefetchInGame,
    onState: (state) => {
      const was = liveState.phase;
      liveState = decorateLive(state);
      if (state.phase === 'ingame') recorder.sample(state, state.myRole);
      else if (was === 'ingame') {
        const rec = recorder.finish({ tier: myTier() });
        if (rec) send('postgame', rec);
      }
      publish();
    },
  });
  lcuEngine = createLcuEngine({
    credsProvider: async () => (USE_MOCK ? MOCK_LCU_CREDS : discoverCredentials()),
    getDd: () => dd,
    getSettings: () => settings.get(),
    getMeta: () => remote.merge(meta),
    getBuild: (champ, role) => remote.getBuild(champ, role),
    prefetch: (state, done) => prefetchChampSelect(state, done),
    onState: (state) => {
      lcuState = decorateLcu(state);
      publish();
      maybeAutoImport(state);
    },
  });

  liveEngine.start();
  lcuEngine.start();
  loadDataDragon();

  if (app.isPackaged && !USE_MOCK) {
    try {
      const { autoUpdater } = require('electron-updater');
      updater = createUpdater({
        autoUpdater,
        send: (s) => send('update', s),
        log: (m) => logger.log(m),
        isEnabled: () => settings.get().autoUpdate,
      });
      setTimeout(() => updater.check(), 8000);
      setInterval(() => updater.check(), 4 * 3600 * 1000);
    } catch (err) {
      logger.log(`atualizador indisponível: ${err.message}`);
    }
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  try { require('uiohook-napi').uIOhook.stop(); } catch { /* hook não iniciado */ }
  if (keyPoller) keyPoller.kill();
  if (liveEngine) liveEngine.stop();
  if (lcuEngine) lcuEngine.stop();
});

app.on('window-all-closed', () => app.quit());
