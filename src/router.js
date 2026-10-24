/**
 * Decide o que o overlay mostra a partir dos dois pollers:
 * partida em andamento > champ select > erro da partida > aguardando.
 */
function pickState(liveState, lcuState) {
  if (liveState.phase === 'ingame') return liveState;
  if (lcuState.phase === 'champselect') return lcuState;
  if (liveState.phase === 'error') return liveState;
  const out = { phase: 'waiting', client: lcuState.client || 'closed' };
  if (lcuState.home) out.home = lcuState.home; // dados da tela inicial (invocador, maestria, rotas)
  return out;
}

module.exports = { pickState };
