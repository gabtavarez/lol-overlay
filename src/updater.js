/**
 * Atualização via GitHub Releases (electron-updater). Converte os eventos da biblioteca num
 * estado simples para a UI: idle | checking | available | downloading | ready | none | error.
 * `autoUpdater` é injetável para teste.
 */
function createUpdater({ autoUpdater, send, log = () => {}, isEnabled = () => true }) {
  let state = { state: 'idle', version: null, percent: 0, message: '' };

  const set = (patch) => {
    state = { ...state, ...patch };
    send(state);
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: '' }));
  autoUpdater.on('update-available', (info) => {
    log(`atualização disponível: ${info.version}`);
    set({ state: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('update-not-available', () => set({ state: 'none', message: 'Você já está na versão mais recente.' }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => {
    log(`atualização baixada: ${info.version}`);
    set({ state: 'ready', version: info.version, percent: 100 });
  });
  autoUpdater.on('error', (err) => {
    log(`erro de atualização: ${err && err.message}`);
    set({ state: 'error', message: 'Não consegui verificar atualizações (sem internet ou repositório sem releases).' });
  });

  return {
    get: () => state,
    async check({ manual = false } = {}) {
      if (!manual && !isEnabled()) return state;
      try {
        await autoUpdater.checkForUpdates();
      } catch (err) {
        log(`checkForUpdates falhou: ${err.message}`);
        set({ state: 'error', message: 'Não consegui verificar atualizações.' });
      }
      return state;
    },
    install() {
      if (state.state === 'ready') autoUpdater.quitAndInstall(false, true);
    },
  };
}

module.exports = { createUpdater };
