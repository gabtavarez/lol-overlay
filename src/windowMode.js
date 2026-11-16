/**
 * Modo de tela do LoL, lido das configurações do jogo pelo cliente (LCU).
 * WindowMode: 0 = tela cheia, 1 = janela, 2 = sem bordas.
 * Em tela cheia exclusiva nenhuma janela consegue ficar por cima do jogo: mostrar o overlay
 * só faz o jogo minimizar e piscar. Nesse caso o overlay fica desligado na partida.
 */
const { lcuGetJson, lcuRequest } = require('./lcu');

const PATH = '/lol-game-settings/v1/game-settings';
const MODES = { 0: 'fullscreen', 1: 'windowed', 2: 'borderless' };

/** 'fullscreen' | 'windowed' | 'borderless' | null (sem a informação). */
function modeFrom(gameSettings) {
  const v = gameSettings && gameSettings.General && gameSettings.General.WindowMode;
  return Object.prototype.hasOwnProperty.call(MODES, v) ? MODES[v] : null;
}

async function readWindowMode(creds, { get = lcuGetJson } = {}) {
  if (!creds) return null;
  return modeFrom(await get(creds, PATH));
}

/** Troca para "Sem bordas" pelo cliente e confere se pegou. Vale a partir da próxima partida. */
async function setBorderless(creds, { request = lcuRequest, get = lcuGetJson } = {}) {
  if (!creds) throw new Error('cliente do LoL não conectado');
  const res = await request(creds, PATH, { method: 'PATCH', json: { General: { WindowMode: 2 } } });
  if (!res || res.status >= 300) throw new Error(`o cliente recusou (HTTP ${res && res.status})`);
  await request(creds, '/lol-game-settings/v1/save', { method: 'POST' }).catch(() => null);
  const now = await readWindowMode(creds, { get });
  if (now !== 'borderless') throw new Error('o cliente não guardou a mudança');
  return now;
}

module.exports = { modeFrom, readWindowMode, setBorderless, MODES };
