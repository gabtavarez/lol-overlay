const { goldCompare } = require('./goldDiff');
const { objectiveTimers, SPELL_CD } = require('./timers');
const { fetchAllGameData } = require('./liveClient');
const { buildState } = require('./state');
const { recommend } = require('./recommender');
const { buyAdvice } = require('./buys');
const { createAlertTracker } = require('./alerts');
const { withMatchup } = require('./matchup');

const ROLES = ['top', 'jungle', 'middle', 'bottom', 'utility'];

/**
 * Faz polling da Live Client API, monta o estado, passa pelo recomendador e
 * entrega para quem estiver ouvindo (o overlay).
 */
function createEngine({ baseUrl, getDd, onState, getBuild = () => null, getMatchup = () => null, prefetch = () => {}, getRoleHint = () => '', onError = () => {}, intervalMs = 2000 }) {
  let timer = null;
  let busy = false;
  const alerts = createAlertTracker();
  let lastGameTime = 0;

  async function tick() {
    if (busy) return;
    busy = true;
    let state;
    try {
      const raw = await fetchAllGameData(baseUrl);
      state = buildState(raw, getDd());
      if (state.phase === 'ingame') {
        state.advice = recommend(state);
        const live = String(state.me.position || '').toLowerCase();
        state.myRole = ROLES.includes(live) ? live : getRoleHint() || '';
        try {
          const me = { id: state.me.championId };
          const opp = state.laneOpponent ? { id: state.laneOpponent.championId } : null;
          if (state.gameTime + 5 < lastGameTime) alerts.reset(); // nova partida
          lastGameTime = state.gameTime;
          const build = withMatchup(
            getBuild(me, state.myRole),
            opp && getMatchup(me, opp, state.myRole),
            state.laneOpponent && state.laneOpponent.champion,
          );
          state.advice.buys = buyAdvice({ state, build, dd: getDd() });
          state.advice.alerts = alerts.update(state, getDd());
          state.advice.gold = goldCompare(state, getDd());
          state.advice.timers = objectiveTimers(state);
          state.spellCd = SPELL_CD;
          prefetch(state, me, opp);
        } catch (err) {
          // uma falha nas sugestões não pode esconder a partida inteira nem o overlay
          state.advice.buys = { items: [], notes: [`Erro nas sugestões: ${err.message}`], recall: null, matchup: null };
          state.advice.alerts = [];
          onError(err);
        }
      }
    } catch (err) {
      state = err.isConnectionError
        ? { phase: 'waiting', reason: err.message }
        : { phase: 'error', reason: err.message };
    } finally {
      busy = false;
    }
    onState(state);
  }

  return {
    start() {
      if (timer) return;
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    tick,
  };
}

module.exports = { createEngine };
