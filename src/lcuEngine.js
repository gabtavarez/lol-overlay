const { lcuRequest, lcuGetJson } = require('./lcu');
const { loadProfile } = require('./profile');
const { buildChampSelectState, puuidsToResolve } = require('./champSelect');
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
function createLcuEngine({ credsProvider, getDd, getSettings, getMeta, onState, getBuild = () => null, prefetch = () => {}, intervalMs = 1500 }) {
  let creds = null;
  let lastDiscovery = 0;
  let timer = null;
  let busy = false;

  let profile = null;
  let profileAt = 0;
  let profileLoading = false;
  let region = null;
  let sessionId = null;
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
      return { phase: 'idle', client: 'open' };
    }
    if (res.status !== 200) throw new Error(`cliente respondeu HTTP ${res.status}`);

    const session = res.body;
    if (session.id !== sessionId) {
      sessionId = session.id;
      names.clear();
    }

    const [pickable, bannable] = await Promise.all([
      lcuGetJson(creds, '/lol-champ-select/v1/pickable-champion-ids').catch(() => []),
      lcuGetJson(creds, '/lol-champ-select/v1/bannable-champion-ids').catch(() => []),
    ]);
    await resolveNames(session);

    const dd = getDd();
    const state = buildChampSelectState(session, { names, dd, pickable, bannable });
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
    if (state.action === 'ban') {
      state.advice.bans = recommendBans({
        champSelect: state, picks: state.advice.picks, getBuild, dd, meta: getMeta(), settings: getSettings(),
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
  };
}

module.exports = { createLcuEngine };
