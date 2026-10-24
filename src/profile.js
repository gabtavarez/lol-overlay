const { lcuGetJson } = require('./lcu');

const SUMMONERS_RIFT = 11;
const PAGE_SIZE = 20;
const MAX_PAGES = 4;

/** Converte lane/role do histórico do cliente na rota usada pelo champ select. */
function laneToPosition(lane, role) {
  const l = String(lane || '').toUpperCase();
  const r = String(role || '').toUpperCase();
  if (r === 'DUO_SUPPORT' || r === 'SUPPORT') return 'utility';
  if (l === 'TOP') return 'top';
  if (l === 'JUNGLE') return 'jungle';
  if (l === 'MID' || l === 'MIDDLE') return 'middle';
  if (l === 'BOTTOM' || l === 'BOT') return 'bottom';
  return null;
}

/** Agrega as páginas de histórico em { rota: { championKey: { games, wins } } }. */
function aggregateHistory(pages) {
  const roleStats = { top: {}, jungle: {}, middle: {}, bottom: {}, utility: {} };
  let analyzed = 0;
  for (const page of pages) {
    const games = (page && page.games && page.games.games) || [];
    for (const game of games) {
      if (game.mapId && game.mapId !== SUMMONERS_RIFT) continue;
      const me = game.participants && game.participants[0];
      if (!me) continue;
      const position = laneToPosition(me.timeline && me.timeline.lane, me.timeline && me.timeline.role);
      if (!position) continue;
      const row = (roleStats[position][me.championId] ||= { games: 0, wins: 0 });
      row.games += 1;
      if (me.stats && me.stats.win) row.wins += 1;
      analyzed += 1;
    }
  }
  return { roleStats, analyzed };
}

/**
 * Perfil de quem está jogando, 100% local (via cliente): maestria por campeão
 * e desempenho por rota nas últimas partidas de Summoner's Rift.
 */
async function loadProfile(creds) {
  const summoner = await lcuGetJson(creds, '/lol-summoner/v1/current-summoner');

  let masteryList = [];
  try {
    masteryList = await lcuGetJson(creds, '/lol-champion-mastery/v1/local-player/champion-mastery');
  } catch {
    try {
      masteryList = await lcuGetJson(
        creds,
        `/lol-champion-mastery/v1/${encodeURIComponent(summoner.puuid)}/champion-mastery`,
      );
    } catch {
      // sem maestria: o recomendador usa só o histórico
    }
  }
  const mastery = new Map(
    (masteryList || []).map((m) => [
      m.championId,
      { points: m.championPoints || 0, level: m.championLevel || 0, lastPlayTime: m.lastPlayTime || 0 },
    ]),
  );

  let rank = null;
  try {
    const r = await lcuGetJson(creds, '/lol-ranked/v1/current-ranked-stats');
    const solo = r && r.queueMap && r.queueMap.RANKED_SOLO_5x5;
    if (solo && solo.tier && solo.tier !== 'NONE') rank = { tier: solo.tier, division: solo.division, lp: solo.leaguePoints || 0, wins: solo.wins || 0, losses: solo.losses || 0 };
  } catch { /* sem elo */ }

  const pages = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    try {
      const page = await lcuGetJson(
        creds,
        `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=${i * PAGE_SIZE}&endIndex=${(i + 1) * PAGE_SIZE}`,
      );
      pages.push(page);
      const count = (page && page.games && page.games.games && page.games.games.length) || 0;
      if (count < PAGE_SIZE) break;
    } catch {
      break;
    }
  }
  const { roleStats, analyzed } = aggregateHistory(pages);

  return {
    summoner: {
      puuid: summoner.puuid,
      gameName: summoner.gameName || summoner.displayName || '',
      tagLine: summoner.tagLine || '',
      level: summoner.summonerLevel || 0,
      iconId: summoner.profileIconId || 0,
      rank,
    },
    mastery,
    roleStats,
    gamesAnalyzed: analyzed,
  };
}

module.exports = { loadProfile, aggregateHistory, laneToPosition };
