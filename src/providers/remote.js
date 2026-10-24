const fs = require('fs');
const path = require('path');
const { norm } = require('../util');
const { createMcpClient } = require('./opggMcp');

const TTL_MS = 12 * 3600 * 1000;
const RETRY_MS = 5 * 60 * 1000;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Dados do OP.GG (servidor MCP oficial): tier list por rota, e por campeão+rota
 * runas, feitiços, itens e counters. Cache em disco de 12 h; em falha usa o cache antigo.
 */
function createRemoteData({ cacheDir, isEnabled, onStatus = () => {}, client = createMcpClient(), getTier = () => null }) {
  const file = path.join(cacheDir, 'opgg-cache.json');
  const cache = readJson(file) || {};
  for (const k of ['tiers', 'builds', 'matchups', 'synergies', 'tierlist', 'scout', 'matches', 'details', 'otp']) if (!cache[k]) cache[k] = {};
  const inflight = new Map();
  const retryAfter = new Map();
  const failures = new Map(); // id -> mensagem do último erro (para a UI não ficar "carregando" pra sempre)

  function save() {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(cache));
      fs.renameSync(`${file}.tmp`, file);
    } catch {
      // sem escrita em disco: fica só em memória
    }
  }

  function refresh(bucket, key, fetcher, onDone, ttl = TTL_MS) {
    if (!isEnabled()) return Promise.resolve();
    const id = `${bucket}:${key}`;
    if (inflight.has(id)) return inflight.get(id);
    const entry = cache[bucket][key];
    if (entry && Date.now() - entry.at < ttl) return Promise.resolve();
    if ((retryAfter.get(id) || 0) > Date.now()) return Promise.resolve();

    const job = (async () => {
      try {
        const data = await fetcher();
        if (!data || (typeof data === 'object' && !Object.keys(data).length)) throw new Error('resposta vazia');
        cache[bucket][key] = { at: Date.now(), data };
        failures.delete(id);
        save();
        onStatus('OP.GG: dados atualizados', 'ok');
      } catch (err) {
        retryAfter.set(id, Date.now() + RETRY_MS);
        failures.set(id, err.message);
        // "Invalid position or champion" = o OP.GG não tem dados desse campeão nessa rota: não é erro do app.
        if (!/invalid position|champion specified/i.test(err.message)) {
          onStatus(`OP.GG: ${err.message}${cache[bucket][key] ? ' (usando cache antigo)' : ''}`, 'warn');
        }
      } finally {
        inflight.delete(id);
        if (onDone) onDone();
      }
    })();
    inflight.set(id, job);
    return job;
  }

  // Campeão sem dados na rota pedida (ex.: off-meta ou recém-lançado): tenta as outras rotas.
  const ROLES = ['middle', 'top', 'jungle', 'bottom', 'utility'];
  // Sem rota (modo treino, ARAM, personalizada): começa pela rota mais provável pelas tags do campeão.
  function guessRoles(champ) {
    const t = (champ && champ.tags) || [];
    const first = t.includes('Marksman') ? 'bottom' : t.includes('Support') ? 'utility'
      : t.includes('Mage') || t.includes('Assassin') ? 'middle' : t.includes('Tank') || t.includes('Fighter') ? 'top' : 'middle';
    return [first, ...ROLES.filter((r) => r !== first)];
  }
  async function analysisWithFallback(champ, role, priority) {
    if (!role) {
      for (const r of guessRoles(champ)) {
        try {
          return { ...(await client.analysis(champ, r, priority, tierArg())), fromRole: r };
        } catch (err) {
          if (!/invalid|position|champion|vazia/i.test(err.message)) throw err;
        }
      }
      throw new Error(`o OP.GG ainda não tem dados de ${champ.name || champ.id}`);
    }
    try {
      return await client.analysis(champ, role, priority, tierArg());
    } catch (err) {
      if (!/invalid|position|champion|vazia/i.test(err.message)) throw err;
      for (const r of ROLES.filter((x) => x !== role)) {
        try {
          const data = await client.analysis(champ, r, priority, tierArg());
          return { ...data, fromRole: r };
        } catch { /* tenta a próxima */ }
      }
      throw new Error(`o OP.GG ainda não tem dados de ${champ.name || champ.id}`);
    }
  }

  // Elo das builds: o padrão do OP.GG (Esmeralda+) mantém a chave antiga do cache.
  const tierArg = () => { const t = getTier(); return t && t !== 'EMERALD_PLUS' ? t : null; };
  const buildKey = (champ, role) => `${norm(champ.id)}:${role || 'none'}${tierArg() ? `:${tierArg()}` : ''}`;

  return {
    /** Tier list ranqueada de todas as rotas, atualizada a cada 3 h (segue o patch atual do OP.GG). */
    ensureTierList: (onDone, force = false) => refresh('tierlist', 'all', () => client.tierList(), onDone, force ? 60 * 1000 : 3 * 3600 * 1000),
    getTierList: () => cache.tierlist.all || null,
    /** Lane scouting: perfil OP.GG de um Riot ID (cache de 1 h). */
    ensureScout: (riotId, region, onDone) => {
      const [name, tag] = String(riotId || '').split('#');
      if (!name || !tag) return Promise.resolve();
      return refresh('scout', `${region}:${riotId.toLowerCase()}`, () => client.summoner(name, tag, region), onDone, 3600 * 1000);
    },
    /**
     * One-tricks: os 3 melhores do ranking do campeão na região e a build da última partida de cada um com ele
     * (itens finais, runa principal e feitiços). Cache de 12 h.
     */
    ensureOtp: (champ, region, onDone) => refresh('otp', `${region}:${norm(champ.id)}`, async () => {
      const top = (await client.leaderboard(champ, region)).slice(0, 3);
      const out = [];
      for (const p of top) {
        const [name, tag] = p.riotId.split('#');
        let game = null;
        try {
          const games = await client.matches(name, tag, region, 10, 2);
          game = games.find((g) => g.me && g.me.champion.replace(/\W/g, '').toLowerCase() === String(champ.id).toLowerCase() || (g.me && g.me.champion.toLowerCase() === String(champ.name || '').toLowerCase()));
        } catch { /* jogador sem partidas visíveis */ }
        out.push({ ...p, build: game ? { items: game.me.items, keystone: game.me.keystone, secondary: game.me.secondary, spells: game.me.spells, win: game.me.stats.result === 'WIN', kda: `${game.me.stats.kills}/${game.me.stats.deaths}/${game.me.stats.assists}`, at: game.createdAt } : null });
      }
      return out;
    }, onDone, 12 * 3600 * 1000),
    getOtp: (champ, region) => { const e = cache.otp[`${region}:${norm(champ.id)}`]; return e ? e.data : null; },
    otpError: (champ, region) => failures.get(`otp:${region}:${norm(champ.id)}`) || null,
    /** Partidas recentes no OP.GG (cache de 3 min). */
    ensureMatches: (riotId, region, onDone, force = false) => {
      const [name, tag] = String(riotId || '').split('#');
      if (!name || !tag) return Promise.resolve();
      return refresh('matches', `${region}:${riotId.toLowerCase()}`, () => client.matches(name, tag, region), onDone, force ? 0 : 3 * 60 * 1000);
    },
    getMatches: (riotId, region) => { const e = cache.matches[`${region}:${String(riotId).toLowerCase()}`]; return e ? { list: e.data, at: e.at } : null; },
    matchesError: (riotId, region) => failures.get(`matches:${region}:${String(riotId).toLowerCase()}`) || null,
    /** Detalhe de uma partida (não muda depois que acaba: cache permanente, até 60 partidas). */
    async gameDetail(id, createdAt, riotId, region) {
      if (cache.details[id]) return cache.details[id].data;
      const data = await client.gameDetail(id, createdAt, riotId, region);
      cache.details[id] = { at: Date.now(), data };
      const keys = Object.keys(cache.details).sort((a, b) => cache.details[a].at - cache.details[b].at);
      while (keys.length > 60) delete cache.details[keys.shift()];
      save();
      return data;
    },
    scoutError: (riotId, region) => failures.get(`scout:${region}:${String(riotId).toLowerCase()}`) || null,
    getScout: (riotId, region) => { const e = cache.scout[`${region}:${String(riotId).toLowerCase()}`]; return e ? e.data : null; },
    tierListError: () => failures.get('tierlist:all') || null,
    ensureTiers: (role, onDone) => (role ? refresh('tiers', role, () => client.laneMeta(role), onDone) : Promise.resolve()),
    ensureBuild: (champ, role, onDone, priority = 0) =>
      champ ? refresh('builds', buildKey(champ, role), () => analysisWithFallback(champ, role, priority), onDone) : Promise.resolve(),
    /** Erro da última tentativa de buscar a build (null se ok ou ainda não tentou). */
    buildError: (champ, role) => (champ ? failures.get(`builds:${buildKey(champ, role)}`) || null : null),

    ensureMatchup: (me, enemy, role, onDone) =>
      me && enemy ? refresh('matchups', `${norm(me.id)}:${norm(enemy.id)}:${role || 'none'}`, () => client.matchup(me, enemy, role), onDone) : Promise.resolve(),
    ensureSynergy: (ally, allyRole, myRole, onDone) =>
      ally && allyRole && myRole ? refresh('synergies', `${norm(ally.id)}:${allyRole}:${myRole}`, () => client.synergies(ally, allyRole, myRole), onDone) : Promise.resolve(),

    getMatchup(me, enemy, role) {
      const e = me && enemy && cache.matchups[`${norm(me.id)}:${norm(enemy.id)}:${role || 'none'}`];
      return e ? e.data : null;
    },

    /** Build em cache (mesmo antiga) de um campeão numa rota, ou null. */
    getBuild(champ, role) {
      const e = champ && cache.builds[buildKey(champ, role)];
      return e ? e.data : null;
    },

    /**
     * Mescla o cache sobre `local` (o meta.json do usuário sempre ganha).
     * Counters: do build de cada inimigo, "quem o counteria" (+) e "quem ele counteria" (-).
     */
    merge(local) {
      if (!isEnabled()) return local;
      const out = { patch: local.patch, tiers: {}, counters: {}, synergies: {} };
      for (const [role, e] of Object.entries(cache.tiers)) out.tiers[role] = { ...e.data };
      for (const [key, e] of Object.entries(cache.builds)) {
        const enemy = key.split(':')[0];
        const row = out.counters[enemy] || (out.counters[enemy] = {});
        for (const c of e.data.strongCounters || []) row[norm(c.name)] = c.value;
        for (const c of e.data.weakCounters || []) row[norm(c.name)] = c.value;
      }
      for (const [key, e] of Object.entries(cache.synergies)) {
        const ally = key.split(':')[0];
        out.synergies[ally] = { ...(out.synergies[ally] || {}), ...e.data };
      }
      for (const [role, entries] of Object.entries(local.tiers)) out.tiers[role] = { ...(out.tiers[role] || {}), ...entries };
      for (const [enemy, row] of Object.entries(local.counters)) out.counters[enemy] = { ...(out.counters[enemy] || {}), ...row };
      return out;
    },
  };
}

module.exports = { createRemoteData };
