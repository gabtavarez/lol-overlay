const { lcuRequest, lcuGetJson } = require('./lcu');

/**
 * Marca o campeão no cliente (hover / intenção de pick, ou ban) sem travar.
 * kind: 'pick' | 'ban'. Usa a ação ainda não concluída do próprio jogador.
 */
async function hoverChampion(creds, championKey, kind = 'pick') {
  const session = await lcuGetJson(creds, '/lol-champ-select/v1/session');
  const mine = (session.actions || []).flat()
    .filter((a) => a.actorCellId === session.localPlayerCellId && !a.completed && a.type === kind);
  const action = mine.find((a) => a.isInProgress) || mine[0];
  if (!action) throw new Error(kind === 'ban' ? 'não é hora de banir' : 'você não tem pick pendente');
  const res = await lcuRequest(creds, `/lol-champ-select/v1/session/actions/${action.id}`, { method: 'PATCH', json: { championId: Number(championKey) } });
  if (res.status >= 400) throw new Error(`o cliente recusou (HTTP ${res.status})`);
  return { actionId: action.id, inProgress: Boolean(action.isInProgress) };
}

module.exports = { hoverChampion };
