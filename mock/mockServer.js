const http = require('http');

// Simula a Live Client API (sem HTTPS) para desenvolver sem precisar de partida.
// Rode com `npm run mock` e abra o overlay com `npm run start:mock`.

const PREFIX = 'game_character_displayname_';

function player({ riotId, champ, id = champ, team, position, items = [], kills = 0, deaths = 0, assists = 0, cs = 0 }) {
  return {
    riotId,
    riotIdGameName: riotId.split('#')[0],
    summonerName: riotId.split('#')[0],
    championName: champ,
    rawChampionName: PREFIX + id,
    team,
    position,
    level: 1,
    isDead: false,
    respawnTimer: 0,
    scores: { kills, deaths, assists, creepScore: cs },
    items: items.map((itemID, slot) => ({ itemID, slot, count: 1, displayName: `Item ${itemID}` })),
  };
}

function snapshot(gameTime) {
  const minutes = gameTime / 60;
  const level = Math.min(18, 1 + Math.floor(minutes / 1.8));
  const aatroxKills = Math.floor(minutes / 3);

  const players = [
    player({ riotId: 'Gabriel#BR1', champ: 'Jinx', team: 'ORDER', position: 'BOTTOM', items: minutes > 4 ? [1055, 3006] : [1055], kills: 1, cs: Math.floor(minutes * 7) }),
    player({ riotId: 'AliadoTop#BR1', champ: 'Ornn', team: 'ORDER', position: 'TOP' }),
    player({ riotId: 'AliadoJg#BR1', champ: 'Vi', team: 'ORDER', position: 'JUNGLE' }),
    player({ riotId: 'AliadoMid#BR1', champ: 'Orianna', team: 'ORDER', position: 'MIDDLE' }),
    player({ riotId: 'AliadoSup#BR1', champ: 'Leona', team: 'ORDER', position: 'UTILITY' }),
    player({ riotId: 'InimigoTop#BR1', champ: 'Aatrox', team: 'CHAOS', position: 'TOP', items: minutes > 6 ? [3153, 3072] : [1055], kills: aatroxKills, deaths: 1 }),
    player({ riotId: 'InimigoJg#BR1', champ: 'Warwick', team: 'CHAOS', position: 'JUNGLE', items: [1102] }),
    player({ riotId: 'InimigoMid#BR1', champ: 'Ahri', team: 'CHAOS', position: 'MIDDLE', items: [1056] }),
    player({ riotId: '<b>Inimigo ADC</b>#BR1', champ: 'Caitlyn', team: 'CHAOS', position: 'BOTTOM', items: [1055] }),
    player({ riotId: 'InimigoSup#BR1', champ: 'Soraka', team: 'CHAOS', position: 'UTILITY', items: [3850] }),
  ].map((p) => ({ ...p, level }));

  return {
    activePlayer: { riotId: 'Gabriel#BR1', summonerName: 'Gabriel', currentGold: Math.floor(300 + minutes * 120), level },
    allPlayers: players,
    events: {
      Events: minutes > 5
        ? [{ EventName: 'DragonKill', KillerName: 'InimigoJg', EventTime: 300 }]
        : [],
    },
    gameData: { gameMode: 'CLASSIC', gameTime, mapName: 'Map11' },
  };
}

function startMock(port = 2998, { speed = 20, champSelectSeconds = 0, startedAt = Date.now() } = {}) {
  const server = http.createServer((req, res) => {
    if (req.url === '/liveclientdata/allgamedata') {
      const elapsed = (Date.now() - startedAt) / 1000;
      if (elapsed < champSelectSeconds) {
        // durante o champ select a Live Client API ainda não existe
        res.statusCode = 404;
        return res.end('{}');
      }
      const gameTime = (elapsed - champSelectSeconds) * speed;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(snapshot(gameTime)));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (require.main === module) {
  const { startMockLcu } = require('./mockLcu');
  const CHAMP_SELECT_SECONDS = 60;
  const t0 = Date.now();
  startMockLcu(2997, { isActive: () => Date.now() - t0 < CHAMP_SELECT_SECONDS * 1000 }).then(() =>
    console.log(`Mock do cliente (LCU) em http://127.0.0.1:2997: champ select por ${CHAMP_SELECT_SECONDS}s`),
  );
  startMock(2998, { champSelectSeconds: CHAMP_SELECT_SECONDS, startedAt: t0 }).then(() =>
    console.log('Mock da Live Client API em http://127.0.0.1:2998: partida (tempo 20x) após o champ select'),
  );
}

module.exports = { startMock, snapshot };
