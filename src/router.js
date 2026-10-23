/**
 * Decide o que o overlay mostra a partir dos dois pollers:
 * partida em andamento > champ select > erro da partida > aguardando.
 */
function pickState(liveState, lcuState) {
  if (liveState.phase === 'ingame') return liveState;
  if (lcuState.phase === 'champselect') return lcuState;
  if (liveState.phase === 'error') return liveState;
  return { phase: 'waiting', client: lcuState.client || 'closed' };
}

module.exports = { pickState };
