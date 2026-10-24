const { app, BrowserWindow, Menu, globalShortcut, ipcMain, screen, shell } = require('electron');
const path = require('path');
const { DataDragon } = require('./ddragon');
const { createEngine } = require('./engine');
const { createLcuEngine } = require('./lcuEngine');
const { discoverCredentials } = require('./lcu');
const { createSettingsStore } = require('./settings');
const { loadMeta } = require('./meta');
const { pickState } = require('./router');
const { createRemoteData } = require('./providers/remote');
const { buildGuide, indexRunes } = require('./guide');
const { importRunes, importSpells, importItemSet } = require('./importer');
const { withMatchup } = require('./matchup');
const { createLogger } = require('./log');
const { createUpdater } = require('./updater');
const { spawn } = require('child_process');

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
    keyPoller.stderr.on('data', (buf) => logger.log(`leitor de teclas: ${String(buf).slice(0, 200)}`));
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
function laneEnemy() {
  const role = lastRole || lcuState.myPosition;
  const e = (lcuState.enemies || []).find((x) => x.champion && x.position === role);
  return e ? e.champion : null;
}

function buildFor(champ, role) {
  const opp = laneEnemy();
  return withMatchup(remote.getBuild(champ, role), opp && remote.getMatchup(champ, opp, role), opp && opp.name);
}

/** Importa runas/feitiços/itens do OP.GG para o cliente. `what`: runes | spells | items | both. */
async function importBuild(championId, what) {
  const champ = champById(championId);
  const role = lastRole || lcuState.myPosition;
  const build = champ && buildFor(champ, role);
  const creds = lcuEngine.getCreds();
  if (!build) return { ok: false, error: 'Ainda não há dados do OP.GG para este campeão.' };
  if (!creds) return { ok: false, error: 'Cliente do LoL não conectado.' };
  const done = [];
  try {
    if (what !== 'spells' && what !== 'items') {
      if (!build.runes) throw new Error('sem runas nos dados do OP.GG');
      await importRunes(creds, build.runes, champ.name);
      done.push('runas');
    }
    if (what !== 'runes' && what !== 'items') {
      await importSpells(creds, build.spells, { flashOnF: settings.get().flashKey !== 'D' });
      done.push('feitiços');
    }
    if (what === 'items' || what === 'both') {
      await importItemSet(creds, build, champ);
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
  return buildGuide({ champ, role, build, dd, runeIndex, runeStyles, skills });
}

/** Busca (se preciso) tier list, builds dos inimigos e dos candidatos de pick. */
function prefetchChampSelect(state, done) {
  if (state.phase !== 'champselect' || !state.myPosition || !dd) return;
  const role = state.myPosition;
  remote.ensureTiers(role, done);
  const mine = state.me && state.me.champion;
  if (mine) remote.ensureBuild(mine, role, done, 25);
  for (const e of state.enemies) {
    if (e.champion) remote.ensureBuild(e.champion, e.position || role, done);
  }
  const picks = (state.advice && state.advice.picks && state.advice.picks.candidates) || [];
  picks.slice(0, 6).forEach((c, i) => remote.ensureBuild({ id: c.id }, role, done, 10 - i));
  const opp = state.enemies.find((e) => e.champion && e.position === role);
  if (opp) for (const c of picks.slice(0, 4)) remote.ensureMatchup({ id: c.id }, opp.champion, role, done);
  for (const a of state.allies) if (a.champion && a.position) remote.ensureSynergy(a.champion, a.position, role, done);
}

function prefetchInGame(state, me, opp) {
  // a Live API muitas vezes não informa a rota: sem rota, o OP.GG escolhe a mais comum do campeão
  remote.ensureBuild(me, state.myRole, () => liveEngine.tick());
  if (opp) remote.ensureMatchup(me, opp, state.myRole, () => liveEngine.tick());
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
      remote.ensureBuild(champ, lastRole || lcuState.myPosition, () =>
        send('guide-updated', { championId: String(championId) }), 20);
    }
    return guideFor(championId);
  });

  ipcMain.handle('import:build', (_e, { championId, what }) => importBuild(championId, what));

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

  remote = createRemoteData({
    cacheDir: path.join(userData, 'remote'),
    isEnabled: () => !USE_MOCK && settings.get().remoteData.enabled,
    onStatus: (text, level) => setStatus(text, level),
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
      liveState = state;
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
      lcuState = state;
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
