const { lcuRequest, lcuGetJson } = require('./lcu');
const { loadProfile } = require('./profile');
const { buildChampSelectState, puuidsToResolve, modeRole } = require('./champSelect');
const { tiltReport } = require('./tilt');
const { recommendPicks } = require('./picker');
const { toOpggRegion, buildMultisearchUrls } = require('./opgg');
const { recommendBans } = require('./bans');
const { autoAccept } = require('./autoAccept');

const PROFILE_TTL_MS = 10 * 60 * 1000;
const PROFILE_RETRY_MS = 30 * 1000;
const REDISCOVER_MS = 5000;

/**
 * Conversa com o cliente do LoL (LCU). Detecta o champ select, resolve os
 * nomes que o próprio cliente permite ver, carrega o perfil (maestria e
 * histórico) em segundo plano e entrega o estado com as sugestões.
 */
/** Resumo para a tela inicial: invocador, campeões com mais maestria e rota mais jogada. */
/** Sequência/tilt com o campeão de conforto já resolvido para id/nome do Data Dragon. */
function tiltFor(profile, dd) {
  if (!profile || !profile.games) return null;
  const t = tiltReport(profile.games, { mastery: profile.mastery });
  const c = t.comfort && dd && dd.championByKey(t.comfort.championId);
  t.comfort = c ? { ...t.comfort, id: c.id, name: c.name } : null;
  t.recent = t.recent.map((g) => { const ch = dd && dd.championByKey(g.championId); return { ...g, id: ch ? ch.id : null, name: ch ? ch.name : '' }; });
  return t;
}

function homeSummary(profile, dd) {
  if (!profile) return { loading: true, version: dd ? dd.version : null };
  const top = [...profile.mastery.entries()]
    .sort((a, b) => b[1].points - a[1].points)
    .slice(0, 6)
    .map(([key, m]) => {
      const c = dd && dd.championByKey(key);
      return c ? { id: c.id, name: c.name, points: m.points, level: m.level } : null;
    })
    .filter(Boolean);
  const roles = Object.entries(profile.roleStats || {})
    .map(([role, champs]) => {
      const rows = Object.values(champs);
      const games = rows.reduce((s, r) => s + r.games, 0);
      const wins = rows.reduce((s, r) => s + r.wins, 0);
      return { role, games, winRate: games ? wins / games : 0 };
    })
    .filter((r) => r.games)
    .sort((a, b) => b.games - a.games);
  return { summoner: profile.summoner, top, roles, gamesAnalyzed: profile.gamesAnalyzed, version: dd ? dd.version : null, tilt: tiltFor(profile, dd) };
}

function createLcuEngine({ credsProvider, getDd, getSettings, getMeta, onState, getBuild = () => null, prefetch = () => {}, getTierRows = () => [], intervalMs = 1500 }) {
  let creds = null;
  let lastDiscovery = 0;
  let timer = null;
  let busy = false;

  let profile = null;
  let profileAt = 0;
  let profileLoading = false;
  let region = null;
  let sessionId = null;
  let queueInfo = null;
  const names = new Map();
  const acceptState = { accepted: false };

  function ensureProfile() {
    const stale = Date.now() - profileAt > PROFILE_TTL_MS;
    if ((!profile || stale) && !profileLoading) {
      profileLoading = true;
      loadProfile(creds)
        .then((p) => {
          profile = p;
          profileAt = Date.now();
        })
        .catch(() => {
          profileAt = Date.now() - PROFILE_TTL_MS + PROFILE_RETRY_MS; // tenta de novo em ~30 s
        })
        .finally(() => {
          profileLoading = false;
          tick();
        });
    }
    return profile;
  }

  async function resolveRegion() {
    const setting = getSettings().region;
    if (setting && setting !== 'auto') return toOpggRegion(setting);
    if (region) return region;
    try {
      const r = await lcuGetJson(creds, '/riotclient/region-locale');
      region = toOpggRegion(r.webRegion) || toOpggRegion(r.region);
    } catch {
      // região indisponível: sem link do OP.GG
    }
    return region;
  }

  async function resolveNames(session) {
    const missing = puuidsToResolve(session).filter((p) => !names.has(p));
    await Promise.all(
      missing.map(async (puuid) => {
        try {
          const s = await lcuGetJson(creds, `/lol-summoner/v2/summoners/puuid/${encodeURIComponent(puuid)}`);
          names.set(puuid, { gameName: s.gameName || '', tagLine: s.tagLine || '' });
        } catch {
          names.set(puuid, { gameName: '', tagLine: '' });
        }
      }),
    );
  }

  async function compute() {
    if (!creds) {
      if (Date.now() - lastDiscovery < REDISCOVER_MS) return { phase: 'idle', client: 'closed' };
      lastDiscovery = Date.now();
      creds = await credsProvider();
      if (!creds) return { phase: 'idle', client: 'closed' };
    }

    const res = await lcuRequest(creds, '/lol-champ-select/v1/session');
    if (res.status === 404 || !res.body) {
      sessionId = null;
      if (getSettings().autoAccept) await autoAccept(creds, acceptState).catch(() => {});
      return { phase: 'idle', client: 'open', home: homeSummary(ensureProfile(), getDd()) };
    }
    if (res.status !== 200) throw new Error(`cliente respondeu HTTP ${res.status}`);

    const session = res.body;
    if (session.id !== sessionId) {
      sessionId = session.id;
      names.clear();
      queueInfo = null;
    }
    // modo da fila (ARAM, Arena…): a sessão do champ select nem sempre traz; o gameflow traz
    if (!queueInfo) {
      queueInfo = await lcuGetJson(creds, '/lol-gameflow/v1/session')
        .then((g) => { const q = (g && g.gameData && g.gameData.queue) || {}; return { id: q.id || 0, gameMode: q.gameMode || '' }; })
        .catch(() => null);
    }

    const [pickable, bannable] = await Promise.all([
      lcuGetJson(creds, '/lol-champ-select/v1/pickable-champion-ids').catch(() => []),
      lcuGetJson(creds, '/lol-champ-select/v1/bannable-champion-ids').catch(() => []),
    ]);
    await resolveNames(session);

    const dd = getDd();
    const state = buildChampSelectState(session, { names, dd, pickable, bannable });
    if (queueInfo) { state.queueId = queueInfo.id || state.queueId; state.gameMode = queueInfo.gameMode; }
    state.mode = modeRole(state);
    state.tilt = tiltFor(profile, dd);
    const loaded = ensureProfile();
    state.advice = {
      picks: recommendPicks({
        champSelect: state,
        profile: loaded,
        dd,
        settings: getSettings(),
        meta: getMeta(),
      }),
      profileLoading: !loaded,
    };
    // Sugestões de ban durante toda a fase de bans (até você banir), não só na sua vez.
    if (state.action === 'ban' || (state.hasBanPhase && !state.myBanDone)) {
      state.advice.bans = recommendBans({
        champSelect: state, picks: state.advice.picks, getBuild, dd, meta: getMeta(), settings: getSettings(),
        tierRows: getTierRows(state.myPosition),
      });
    }
    prefetch(state, tick);

    const regionCode = await resolveRegion();
    state.opgg = {
      ...buildMultisearchUrls({
        allies: [state.me, ...state.allies].filter(Boolean),
        enemies: state.enemies,
        region: regionCode,
      }),
      region: regionCode,
    };
    state.client = 'open';
    return state;
  }

  async function tick() {
    if (busy) return;
    busy = true;
    let state;
    try {
      state = await compute();
    } catch (err) {
      if (err.isConnectionError) creds = null; // porta muda a cada abertura do cliente
      state = err.isConnectionError
        ? { phase: 'idle', client: 'closed' }
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
    getCreds: () => creds,
    getProfile: () => profile,
    getRegion: () => region,
  };
}

module.exports = { createLcuEngine, homeSummary };
