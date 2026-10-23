const http = require('http');

// Simula o cliente do LoL (LCU) com um champ select de ranked: aliados com nome
// visível, inimigos com nome oculto (nameVisibilityType: HIDDEN), maestria e histórico.

const CHAMPION_FIXTURE = [
  { id: 'Jinx', key: '222', name: 'Jinx', tags: ['Marksman'] },
  { id: 'Caitlyn', key: '51', name: 'Caitlyn', tags: ['Marksman'] },
  { id: 'Ashe', key: '22', name: 'Ashe', tags: ['Marksman', 'Support'] },
  { id: 'Kaisa', key: '145', name: "Kai'Sa", tags: ['Marksman', 'Mage'] },
  { id: 'Ezreal', key: '81', name: 'Ezreal', tags: ['Marksman', 'Mage'] },
  { id: 'Draven', key: '119', name: 'Draven', tags: ['Marksman'] },
  { id: 'Jhin', key: '202', name: 'Jhin', tags: ['Marksman', 'Assassin'] },
  { id: 'Ahri', key: '103', name: 'Ahri', tags: ['Mage', 'Assassin'] },
  { id: 'Aatrox', key: '266', name: 'Aatrox', tags: ['Fighter', 'Tank'] },
  { id: 'Ornn', key: '516', name: 'Ornn', tags: ['Tank', 'Fighter'] },
  { id: 'Vi', key: '254', name: 'Vi', tags: ['Fighter', 'Assassin'] },
  { id: 'Orianna', key: '61', name: 'Orianna', tags: ['Mage', 'Support'] },
  { id: 'Leona', key: '89', name: 'Leona', tags: ['Tank', 'Support'] },
  { id: 'Lux', key: '99', name: 'Lux', tags: ['Mage', 'Support'] },
  { id: 'Soraka', key: '16', name: 'Soraka', tags: ['Support', 'Mage'] },
];

const puuid = (n) => `aaaaaaaa-0000-0000-0000-00000000000${n}`;

const NAMES = {
  [puuid(0)]: { gameName: 'AliadoTop', tagLine: 'BR1' },
  [puuid(1)]: { gameName: 'AliadoJg', tagLine: 'BR1' },
  [puuid(2)]: { gameName: 'AliadoMid', tagLine: 'BR1' },
  [puuid(3)]: { gameName: 'Gabriel', tagLine: 'BR1' },
  [puuid(4)]: { gameName: 'AliadoSup', tagLine: 'BR1' },
};

function ally(cellId, position, extra = {}) {
  const n = NAMES[puuid(cellId)];
  return {
    cellId,
    assignedPosition: position,
    championId: 0,
    championPickIntent: 0,
    nameVisibilityType: 'VISIBLE',
    puuid: puuid(cellId),
    // alguns nomes vêm na sessão, outros precisam de lookup por puuid
    gameName: cellId % 2 === 0 || cellId === 3 ? n.gameName : '',
    tagLine: cellId % 2 === 0 || cellId === 3 ? n.tagLine : '',
    ...extra,
  };
}

function enemy(cellId, position, championId = 0) {
  return {
    cellId,
    assignedPosition: position,
    championId,
    championPickIntent: 0,
    nameVisibilityType: 'HIDDEN',
    puuid: '',
    gameName: '',
    tagLine: '',
  };
}

const SESSION = {
  id: 'mock-session-1',
  queueId: 420,
  isSpectating: false,
  localPlayerCellId: 3,
  timer: { phase: 'BAN_PICK' },
  myTeam: [
    ally(0, 'top', { championId: 516 }),
    ally(1, 'jungle', { championPickIntent: 254 }),
    ally(2, 'middle', { championId: 61 }),
    ally(3, 'bottom'),
    ally(4, 'utility', { championId: 89 }),
  ],
  theirTeam: [
    enemy(5, 'top', 266),
    enemy(6, 'jungle'),
    enemy(7, 'middle', 103),
    enemy(8, 'bottom'),
    enemy(9, 'utility'),
  ],
  actions: [
    [{ id: 0, actorCellId: 3, championId: 0, type: 'pick', completed: false, isInProgress: true, isAllyAction: true }],
  ],
  bans: { myTeamBans: [157], theirTeamBans: [238] },
};

const PICKABLE = [222, 51, 22, 145, 81, 119, 202, 99, 16];

function mastery(now) {
  const day = 86_400_000;
  const row = (championId, championLevel, championPoints, daysAgo) => ({
    championId, championLevel, championPoints, lastPlayTime: now - daysAgo * day,
  });
  return [
    row(222, 7, 150000, 2), row(145, 6, 80000, 30), row(51, 5, 40000, 5),
    row(81, 5, 25000, 10), row(119, 4, 20000, 90), row(202, 4, 10000, 60), row(99, 6, 60000, 20),
  ];
}

function historyGames() {
  const games = [];
  const add = (championId, total, wins, lane, role) => {
    for (let i = 0; i < total; i++) {
      games.push({
        gameId: games.length + 1,
        mapId: 11,
        queueId: 420,
        participants: [{ participantId: 1, championId, stats: { win: i < wins }, timeline: { lane, role } }],
      });
    }
  };
  add(222, 12, 8, 'BOTTOM', 'DUO_CARRY');
  add(145, 8, 4, 'BOTTOM', 'DUO_CARRY');
  add(51, 4, 1, 'BOTTOM', 'DUO_CARRY');
  add(81, 3, 1, 'BOTTOM', 'DUO_CARRY');
  add(119, 2, 1, 'BOTTOM', 'DUO_CARRY');
  add(99, 1, 0, 'MIDDLE', 'SOLO');
  return games;
}

function startMockLcu(port = 2997, { isActive = () => true, token = 'mock' } = {}) {
  const expectedAuth = `Basic ${Buffer.from(`riot:${token}`).toString('base64')}`;
  const games = historyGames();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== expectedAuth) return send(401, { httpStatus: 401 });

    const p = url.pathname;
    if (p === '/lol-champ-select/v1/session') {
      return isActive() ? send(200, SESSION) : send(404, { httpStatus: 404, message: 'No active champ select' });
    }
    if (p === '/lol-champ-select/v1/pickable-champion-ids') return send(200, PICKABLE);
    if (p === '/lol-champ-select/v1/bannable-champion-ids') return send(200, PICKABLE);
    if (p === '/lol-summoner/v1/current-summoner') {
      return send(200, { puuid: puuid(3), gameName: 'Gabriel', tagLine: 'BR1', summonerId: 1 });
    }
    if (p === '/lol-champion-mastery/v1/local-player/champion-mastery') return send(200, mastery(Date.now()));
    if (p === '/riotclient/region-locale') {
      return send(200, { region: 'BR', locale: 'pt_BR', webRegion: 'br', webLanguage: 'pt' });
    }
    if (p === '/lol-match-history/v1/products/lol/current-summoner/matches') {
      const beg = Number(url.searchParams.get('begIndex') || 0);
      const end = Number(url.searchParams.get('endIndex') || 20);
      const page = games.slice(beg, end);
      return send(200, { games: { gameIndexBegin: beg, gameIndexEnd: end, gameCount: page.length, games: page } });
    }
    if (p.startsWith('/lol-summoner/v2/summoners/puuid/')) {
      const found = NAMES[decodeURIComponent(p.split('/').pop())];
      return found ? send(200, found) : send(404, { httpStatus: 404 });
    }
    return send(404, { httpStatus: 404 });
  });

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

module.exports = { startMockLcu, CHAMPION_FIXTURE, SESSION };
