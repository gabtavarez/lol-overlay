/**
 * Timers de objetivos a partir dos eventos da Live API (aproximados pelas regras atuais do Summoner's Rift).
 * Retorna [{ key, label, at, in }] — `at` em segundos de jogo, `in` = quanto falta (0 = vivo/disponível).
 */
const DRAGON_FIRST = 5 * 60;
const DRAGON_RESPAWN = 5 * 60;
const HERALD_FIRST = 15 * 60;
const HERALD_GONE = 19 * 60 + 45;
const BARON_FIRST = 20 * 60;
const BARON_RESPAWN = 6 * 60;

function objectiveTimers(state) {
  if (!state || state.phase !== 'ingame') return [];
  const mode = String(state.gameMode || '').toUpperCase();
  if (mode && mode !== 'CLASSIC') return [];
  const t = state.gameTime || 0;
  const ev = state.events || [];
  const last = (name) => ev.filter((e) => e.name === name).reduce((m, e) => Math.max(m, e.time), -1);
  const out = [];
  const lastDragon = last('DragonKill');
  const dragonAt = lastDragon >= 0 ? lastDragon + DRAGON_RESPAWN : DRAGON_FIRST;
  out.push({ key: 'dragon', label: 'Dragão', at: dragonAt, in: Math.max(0, Math.round(dragonAt - t)) });
  if (last('HeraldKill') < 0 && t < HERALD_GONE) out.push({ key: 'herald', label: 'Arauto', at: HERALD_FIRST, in: Math.max(0, Math.round(HERALD_FIRST - t)) });
  const lastBaron = last('BaronKill');
  const baronAt = lastBaron >= 0 ? lastBaron + BARON_RESPAWN : BARON_FIRST;
  out.push({ key: 'baron', label: 'Barão', at: baronAt, in: Math.max(0, Math.round(baronAt - t)) });
  return out;
}

// Recarga base dos feitiços (sem aceleração de feitiço).
const SPELL_CD = { SummonerFlash: 300, SummonerDot: 180, SummonerHeal: 240, SummonerBarrier: 180, SummonerExhaust: 240, SummonerBoost: 240, SummonerHaste: 240, SummonerTeleport: 360, SummonerSmite: 90, SummonerMana: 240, SummonerSnowball: 80 };

module.exports = { objectiveTimers, SPELL_CD };
