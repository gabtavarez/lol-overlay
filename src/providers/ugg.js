/**
 * U.GG (estatísticas públicas do site, sem API oficial): build recomendada da rota com win rate,
 * opções de 4º/5º/6º item, runas, feitiços, iniciais e habilidades. Mundial, Esmeralda+.
 * Formato: overview[região][elo][rota][0] = [runas, feitiços, iniciais, núcleo, habilidades, opções, total, _, fragmentos]
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const VERSIONS = 'https://static.bigbrain.gg/assets/lol/riot_patch_update/prod/ugg/ugg-api-versions.json';
const ROLE = { jungle: '1', utility: '2', bottom: '3', top: '4', middle: '5' };
const WORLD = '12';
const RANKS = ['17', '10', '8']; // Esmeralda+, depois Platina+, depois todos
const TTL = 6 * 3600 * 1000;

function parseOverview(json, role) {
  const roleId = ROLE[role];
  const reg = json && json[WORLD];
  if (!reg || !roleId) return null;
  const rank = RANKS.find((r) => reg[r] && reg[r][roleId] && reg[r][roleId][0]);
  if (!rank) return null;
  const b = reg[rank][roleId][0];
  const pair = (x) => (Array.isArray(x) ? { play: x[0] || 0, win: x[1] || 0 } : { play: 0, win: 0 });
  const [runes, spells, starters, core, skills, slots, , , shards] = b;
  const opt = (x) => ({ ids: x[2] || [], ...pair(x) });
  const slot = (list) => (Array.isArray(list) ? list : []).map((o) => ({ ids: [o[0]], play: o[2] || 0, win: o[1] || 0 }));
  return {
    rank,
    total: Array.isArray(b[6]) ? { win: b[6][0], play: b[6][1] } : null,
    cores: core && core[2] ? [opt(core)] : [],
    starters: starters && starters[2] ? [opt(starters)] : [],
    spells: spells && spells[2] ? [opt(spells)] : [],
    skills: skills && skills[2] ? [{ order: skills[2], ...pair(skills) }] : [],
    runes: runes && runes[4] ? [{
      primaryStyleId: runes[2], subStyleId: runes[3],
      perks: [...runes[4], ...((shards && shards[2]) || []).map(Number)], ...pair(runes),
    }] : [],
    slots: Array.isArray(slots) ? slots.slice(0, 3).map(slot) : [],
  };
}

function createUgg({ fetchImpl = fetch, log = () => {} } = {}) {
  let versions = null;
  const cache = new Map(); // `${key}:${role}` -> { at, data }
  const inflight = new Map();
  const get = async (url) => {
    const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`U.GG respondeu HTTP ${r.status}`);
    return r.json();
  };
  async function patchInfo() {
    if (versions && Date.now() - versions.at < TTL) return versions;
    const v = await get(VERSIONS);
    const patch = Object.keys(v).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    versions = { at: Date.now(), patch, overview: (v[patch] || {}).overview || '1.5.0' };
    return versions;
  }
  return {
    /** Build da rota (cache de 6 h); onDone avisa quando chegar. */
    ensure(champKey, role, onDone) {
      const id = `${champKey}:${role}`;
      const e = cache.get(id);
      if ((e && Date.now() - e.at < TTL) || inflight.has(id) || !ROLE[role]) return;
      const job = (async () => {
        try {
          const v = await patchInfo();
          const json = await get(`https://stats2.u.gg/lol/1.5/overview/${v.patch}/ranked_solo_5x5/${champKey}/${v.overview}.json`);
          cache.set(id, { at: Date.now(), data: { patch: v.patch.replace('_', '.'), ...parseOverview(json, role) } });
        } catch (err) {
          log(`U.GG: ${err.message}`);
          cache.set(id, { at: Date.now() - TTL + 5 * 60 * 1000, data: { error: err.message } }); // tenta de novo em 5 min
        } finally {
          inflight.delete(id);
          if (onDone) onDone();
        }
      })();
      inflight.set(id, job);
    },
    get(champKey, role) { const e = cache.get(`${champKey}:${role}`); return e ? e.data : null; },
  };
}

module.exports = { createUgg, parseOverview, ROLE };
