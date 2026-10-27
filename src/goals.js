/**
 * Metas da partida: CS/min e placar de visão/min para o seu elo, mirando um degrau acima
 * (para subir, jogue como o elo de cima). Valores aproximados de referência da comunidade.
 */
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const CS = [4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.3, 8.5];

function targetsFor(tier, role) {
  const i = Math.max(0, TIERS.indexOf(String(tier || 'GOLD').toUpperCase()));
  if (role === 'aram' || role === 'arena') return { aimTier: TIERS[Math.min(TIERS.length - 1, i + 1)], cs: null, vision: null, mode: true };
  const aim = Math.min(TIERS.length - 1, i + 1);
  const cs = role === 'utility' ? null : role === 'jungle' ? +(CS[aim] * 0.85).toFixed(1) : CS[aim];
  const vision = role === 'utility' ? +(1.6 + aim * 0.1).toFixed(1) : role === 'jungle' ? +(0.8 + aim * 0.05).toFixed(2) : +(0.5 + aim * 0.05).toFixed(2);
  return { aimTier: TIERS[aim], cs, vision };
}

/** Situação agora: ritmo atual x meta, e quanto falta/sobra de CS. */
function liveGoals(state, tier, role) {
  if (!state || state.phase !== 'ingame' || state.gameTime < 120) return null;
  const min = state.gameTime / 60;
  const t = targetsFor(tier, role);
  if (t.mode) return null; // ARAM/Arena: sem meta de farm e visão
  const cs = state.me.scores.cs || 0;
  const csm = cs / min;
  const vis = state.me.wards || 0;
  return {
    aimTier: t.aimTier,
    cs: t.cs === null ? null : { now: +csm.toFixed(1), target: t.cs, diff: Math.round(cs - t.cs * min), ok: csm >= t.cs },
    vision: { now: +(vis / min).toFixed(2), target: t.vision, ok: vis / min >= t.vision },
  };
}

module.exports = { targetsFor, liveGoals, TIERS };
