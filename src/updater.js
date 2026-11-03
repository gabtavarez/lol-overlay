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
  // com uma versão já baixada, uma nova conferência não pode apagar o "pronto para reiniciar"
  const busy = () => state.state === 'ready' || state.state === 'downloading';
  autoUpdater.on('checking-for-update', () => { if (!busy()) set({ state: 'checking', message: '' }); });
  autoUpdater.on('update-available', (info) => {
    log(`atualização disponível: ${info.version}`);
    set({ state: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('update-not-available', () => { if (!busy()) set({ state: 'none', message: 'Você já está na versão mais recente.' }); });
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
    /**
     * Instala sempre a versão MAIS NOVA: antes de reiniciar, confere de novo no GitHub. Se saiu outra
     * versão depois da que já foi baixada, baixa essa e instala direto (sem passar pelas intermediárias).
     */
    async install() {
      if (state.state !== 'ready') return false;
      const have = state.version;
      try {
        const r = await autoUpdater.checkForUpdates();
        const latest = r && r.updateInfo && r.updateInfo.version;
        if (latest && latest !== have && r.downloadPromise) {
          log(`versão mais nova saiu (${latest}): baixando antes de instalar`);
          await r.downloadPromise;
        }
      } catch (err) {
        log(`reconferência antes de instalar falhou: ${err.message}`);
      }
      if (state.state !== 'ready') return false;
      autoUpdater.quitAndInstall(false, true);
      return true;
    },
  };
}

module.exports = { createUpdater };
