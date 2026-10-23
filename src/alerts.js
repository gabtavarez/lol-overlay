const data = require('../data/enemy-alerts.json');

const SHOW_MS = 30_000;

/**
 * Avisa quando um inimigo fecha um item relevante. O primeiro estado só "memoriza"
 * (abrir o app no meio da partida não gera uma enxurrada de avisos).
 */
function createAlertTracker({ table = data.items, now = () => Date.now() } = {}) {
  const seen = new Set();
  let primed = false;
  let active = [];

  return {
    update(state, dd) {
      const fresh = [];
      for (const e of state.enemies || []) {
        for (const it of e.items || []) {
          const note = table[String(it.id)];
          const key = `${e.name}:${it.id}`;
          if (!note || seen.has(key)) continue;
          seen.add(key);
          if (primed) {
            const name = (dd && dd.item(it.id) && dd.item(it.id).name) || it.name;
            fresh.push({ id: key, at: now(), text: `${e.champion} fechou ${name}: ${note}` });
          }
        }
      }
      primed = true;
      const t = now();
      active = [...fresh, ...active].filter((a) => t - a.at < SHOW_MS).slice(0, 4);
      return active;
    },
    reset() {
      seen.clear();
      active = [];
      primed = false;
    },
  };
}

module.exports = { createAlertTracker };
