const MIN_GAMES = 40; // abaixo disso o matchup tem pouca amostra: mantém a build geral

/** Sobrepõe à build geral o que o guia de matchup traz, quando há amostra suficiente. */
function withMatchup(build, mu, enemyName) {
  if (!build) return build;
  if (!mu) return build;
  const out = { ...build, matchup: { vs: enemyName, tip: mu.tip, advantage: mu.laneAdvantage, playStyle: mu.playStyle, used: [] } };
  if (mu.core.length && mu.coreGames >= MIN_GAMES) {
    out.core = mu.core;
    out.corePick = mu.corePick;
    out.matchup.used.push('itens');
  }
  if (mu.boots.length) out.boots = mu.boots;
  if (mu.spells.length === 2) { out.spells = mu.spells; out.matchup.used.push('feitiços'); }
  if (mu.runes) { out.runes = mu.runes; out.matchup.used.push('runas'); }
  if (mu.skills.length) out.skills = mu.skills;
  return out;
}

module.exports = { withMatchup, MIN_GAMES };
