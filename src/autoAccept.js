const { lcuRequest } = require('./lcu');

/** Aceita o ready check uma única vez por fila. `state.accepted` zera quando a fase muda. */
async function autoAccept(creds, state) {
  const res = await lcuRequest(creds, '/lol-gameflow/v1/gameflow-phase');
  const phase = res.status === 200 ? res.body : null;
  if (phase !== 'ReadyCheck') {
    state.accepted = false;
    return false;
  }
  if (state.accepted) return false;
  const r = await lcuRequest(creds, '/lol-matchmaking/v1/ready-check/accept', { method: 'POST' });
  state.accepted = r.status >= 200 && r.status < 300;
  return state.accepted;
}

module.exports = { autoAccept };
