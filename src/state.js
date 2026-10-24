const { championIdFromRaw } = require('./ddragon');

/** A Live API às vezes manda objeto/null no lugar de lista (ex.: itens em transição). Nunca quebra. */
function list(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') return Object.values(x).filter((v) => v && typeof v === 'object');
  return [];
}

function mapItem(item, dd) {
  const meta = dd ? dd.item(item.itemID) : null;
  return {
    id: item.itemID,
    name: (meta && meta.name) || item.displayName,
    tags: (meta && meta.tags) || [],
    slot: item.slot,
    count: item.count || 1,
  };
}

/** "GeneralUtility_Flash" / "SummonerFlash" / "Flash" -> 'SummonerFlash' (chave do Data Dragon). */
const SPELL_NAMES = { flash: 'SummonerFlash', ignite: 'SummonerDot', dot: 'SummonerDot', heal: 'SummonerHeal', barrier: 'SummonerBarrier', exhaust: 'SummonerExhaust',
  cleanse: 'SummonerBoost', boost: 'SummonerBoost', ghost: 'SummonerHaste', haste: 'SummonerHaste', teleport: 'SummonerTeleport', smite: 'SummonerSmite', clarity: 'SummonerMana', mark: 'SummonerSnowball', snowball: 'SummonerSnowball' };
function spellKey(s) {
  if (!s) return null;
  const raw = String(s.rawDisplayName || s.displayName || '').toLowerCase();
  for (const [k, v] of Object.entries(SPELL_NAMES)) if (raw.includes(k)) return v;
  return null;
}

function mapPlayer(p, dd) {
  const champ = dd ? dd.championByRaw(p.rawChampionName, p.championName) : null;
  const scores = p.scores || {};
  return {
    name: p.riotId || p.summonerName || '?',
    gameName: p.riotIdGameName || p.summonerName || '',
    champion: p.championName,
    championId: (champ && champ.id) || championIdFromRaw(p.rawChampionName),
    tags: (champ && champ.tags) || [],
    position: p.position || '',
    team: p.team,
    level: p.level || 1,
    isDead: Boolean(p.isDead),
    respawnTimer: p.respawnTimer || 0,
    scores: {
      kills: scores.kills || 0,
      deaths: scores.deaths || 0,
      assists: scores.assists || 0,
      cs: scores.creepScore || 0,
    },
    items: list(p.items).filter((it) => it && it.itemID).map((it) => mapItem(it, dd)),
    riotId: p.riotId || '',
    wards: scores.wardScore || 0,
    spells: [p.summonerSpells && p.summonerSpells.summonerSpellOne, p.summonerSpells && p.summonerSpells.summonerSpellTwo]
      .map((s) => spellKey(s)).filter(Boolean),
  };
}

function findActivePlayer(raw, players) {
  const active = raw.activePlayer || {};
  const ids = [active.riotId, active.summonerName, active.riotIdGameName].filter(Boolean);
  return (
    players.find((p) => ids.includes(p.name) || ids.includes(p.gameName)) || null
  );
}

function countObjectives(events, players) {
  const teamByName = new Map();
  for (const p of players) {
    teamByName.set(p.name, p.team);
    teamByName.set(p.gameName, p.team);
  }
  const out = { dragons: { ORDER: 0, CHAOS: 0 }, barons: { ORDER: 0, CHAOS: 0 } };
  for (const e of list(events)) {
    const team = teamByName.get(e.KillerName);
    if (!team) continue;
    if (e.EventName === 'DragonKill') out.dragons[team] += 1;
    if (e.EventName === 'BaronKill') out.barons[team] += 1;
  }
  return out;
}

/**
 * Converte o payload cru de /allgamedata no estado que o overlay e o
 * recomendador consomem. `dd` (DataDragon) é opcional: sem ele, usa só o que
 * a própria Live API informa.
 */
function buildState(raw, dd) {
  const players = list(raw.allPlayers).map((p) => mapPlayer(p, dd));
  const me = findActivePlayer(raw, players);
  if (!me) {
    return { phase: 'waiting', reason: 'jogador ativo não encontrado (modo espectador?)' };
  }

  const active = raw.activePlayer || {};
  const myState = { ...me, gold: Math.floor(active.currentGold || 0), level: active.level || me.level };
  const enemies = players.filter((p) => p.team !== me.team);
  const allies = players.filter((p) => p.team === me.team && p !== me);
  const laneOpponent = myState.position
    ? enemies.find((e) => e.position === myState.position) || null
    : null;

  const gameData = raw.gameData || {};
  return {
    phase: 'ingame',
    gameTime: Math.floor(gameData.gameTime || 0),
    gameMode: gameData.gameMode || '',
    assets: { version: dd ? dd.version : null },
    me: myState,
    allies,
    enemies,
    laneOpponent,
    objectives: countObjectives((raw.events || {}).Events, players),
    events: list((raw.events || {}).Events).map((e) => ({ name: e.EventName, time: e.EventTime || 0, killer: e.KillerName || '', victim: e.VictimName || '', result: e.Result || '', assisters: list(e.Assisters) })),
    teamKills: { mine: players.filter((p) => p.team === me.team).reduce((s, p) => s + p.scores.kills, 0) },
  };
}

module.exports = { buildState };
