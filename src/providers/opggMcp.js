const { norm, clamp } = require('../util');

const ENDPOINT = 'https://mcp-api.op.gg/mcp';
const PROTOCOL = '2025-06-18';
const TIMEOUT_MS = 20_000;
const MIN_GAP_MS = 120;
const CONCURRENCY = 3;

// Papel do app -> papel do OP.GG
const POSITION = { top: 'top', jungle: 'jungle', middle: 'mid', bottom: 'adc', utility: 'support' };

/* ---------- parser do formato compacto: Nome(arg, [lista], "texto", 1.5) ---------- */

function parseValue(src, pos) {
  let i = pos;
  const skip = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  skip();
  const c = src[i];
  if (c === '"') {
    let out = '';
    i++;
    while (i < src.length && src[i] !== '"') {
      if (src[i] === '\\') i++;
      out += src[i++];
    }
    return [out, i + 1];
  }
  if (c === '[') {
    const arr = [];
    i++;
    skip();
    while (src[i] !== ']') {
      if (i >= src.length) throw new Error('lista sem fim');
      const [v, next] = parseValue(src, i);
      arr.push(v);
      i = next;
      skip();
      if (src[i] === ',') i++;
      skip();
    }
    return [arr, i + 1];
  }
  const m = /^[A-Za-z0-9_.+-]+/.exec(src.slice(i));
  if (!m) throw new Error(`token inesperado em ${i}`);
  i += m[0].length;
  if (src[i] === '(') {
    const args = [];
    i++;
    skip();
    while (src[i] !== ')') {
      if (i >= src.length) throw new Error('chamada sem fim');
      const [v, next] = parseValue(src, i);
      args.push(v);
      i = next;
      skip();
      if (src[i] === ',') i++;
      skip();
    }
    return [{ $: m[0], args }, i + 1];
  }
  const t = m[0];
  if (t === 'true') return [true, i];
  if (t === 'false') return [false, i];
  if (t === 'null') return [null, i];
  return [Number.isNaN(Number(t)) ? t : Number(t), i];
}

/** Lê "class X: a,b" + a chamada raiz e devolve objetos com os nomes dos campos. */
function parseCompact(text) {
  const defs = {};
  for (const m of String(text).matchAll(/^class (\w+): ([\w,]+)$/gm)) defs[m[1]] = m[2].split(',');
  const start = String(text).search(/^[A-Z]\w*\(/m);
  if (start < 0) throw new Error('resposta sem dados');
  const [root] = parseValue(String(text), start);
  const build = (v) => {
    if (Array.isArray(v)) return v.map(build);
    if (v && typeof v === 'object' && '$' in v) {
      const keys = defs[v.$] || [];
      const out = {};
      v.args.forEach((a, idx) => { out[keys[idx] || `_${idx}`] = build(a); });
      return out;
    }
    return v;
  };
  return build(root);
}

/* ---------- conversões ---------- */

const TIER_LETTER = { 1: 'S', 2: 'A', 3: 'B', 4: 'C', 5: 'D' };

function pct(v) {
  return typeof v === 'number' ? v : null;
}

function counterList(list, sign) {
  return (Array.isArray(list) ? list : []).map((c) => ({
    id: c.champion_id,
    name: c.champion_name,
    // win_rate = chance do campeão contrário vencer; vira nota em [-1, 1] para o meu pick
    value: clamp((sign * ((c.win_rate || 0.5) - 0.5)) / 0.08, -1, 1),
    games: c.play || 0,
  }));
}

function parseAnalysis(text) {
  const d = parseCompact(text).data || {};
  const items = (o) => (o && Array.isArray(o.ids) ? o.ids : []);
  const options = (list) => (Array.isArray(list) ? list.map((o) => ({ ids: items(o), pick: o.pick_rate || 0 })) : []);
  const r = d.runes;
  const build = {
    damageType: d.damage_type || null,
    winRate: pct(d.summary && d.summary.average_stats && d.summary.average_stats.win_rate),
    weakCounters: counterList(d.weak_counters, 1), // quem counteria ESTE campeão: bom para mim se eu o enfrento
    strongCounters: counterList(d.strong_counters, -1),
    core: items(d.core_items),
    corePick: (d.core_items && d.core_items.pick_rate) || 0,
    boots: items(d.boots),
    starter: items(d.starter_items),
    later: [options(d.fourth_items), options(d.fifth_items), options(d.sixth_items)],
    spells: items(d.summoner_spells).slice(0, 2),
    skills: d.skills && Array.isArray(d.skills.order) ? d.skills.order : [],
    runes: null,
  };
  if (r && Array.isArray(r.primary_rune_ids) && Array.isArray(r.secondary_rune_ids)) {
    build.runes = {
      primaryStyleId: r.primary_page_id,
      primaryStyleName: r.primary_page_name,
      subStyleId: r.secondary_page_id,
      subStyleName: r.secondary_page_name,
      names: [...(r.primary_rune_names || []), ...(r.secondary_rune_names || [])],
      perks: [...r.primary_rune_ids, ...r.secondary_rune_ids, ...(r.stat_mod_ids || [])],
      pickRate: r.pick_rate || 0,
    };
  }
  return build;
}

/** Lista de campeões da rota -> { [norm(nome)]: 'S+'|'S'|'A'|'B'|'C'|'D' } */
function parseLaneMeta(text) {
  const d = parseCompact(text).data || {};
  const rows = (d.positions && Object.values(d.positions).find(Array.isArray)) || [];
  const out = {};
  for (const r of rows) {
    if (!r || !r.champion) continue;
    let tier = TIER_LETTER[r.tier] || 'C';
    if (r.tier === 1 && r.rank <= 3) tier = 'S+';
    out[norm(r.champion)] = tier;
  }
  return out;
}

const TL_POS = { top: 'top', jungle: 'jungle', mid: 'middle', adc: 'bottom', support: 'utility' };
const TL_FIELDS = Object.keys(TL_POS).map((p) => `data.positions.${p}[].{champion,play,win_rate,pick_rate,role_rate,ban_rate,kda,tier,rank,rank_prev}`);

/** Tier list completa (todas as rotas) -> { [rota]: [{ champion, tier, rank, rankPrev, winRate, pickRate, banRate, games, kda }] } */
function parseTierList(text) {
  const positions = (parseCompact(text).data || {}).positions || {};
  const out = {};
  for (const [pos, role] of Object.entries(TL_POS)) {
    out[role] = (Array.isArray(positions[pos]) ? positions[pos] : []).filter((r) => r && r.champion).map((r) => ({
      champion: r.champion, tier: Number(r.tier) || 5, rank: Number(r.rank) || 999, rankPrev: Number(r.rank_prev) || null,
      winRate: r.win_rate || 0, pickRate: r.pick_rate || 0, banRate: r.ban_rate || 0, roleRate: r.role_rate || 0, games: r.play || 0, kda: r.kda || 0,
    })).sort((a, b) => a.rank - b.rank);
  }
  return out;
}

/** Guia de matchup (JSON): melhores runas/itens/feitiços CONTRA aquele oponente + dica. */
function parseMatchup(text) {
  const d = (JSON.parse(text) || {}).data;
  if (!d) throw new Error('matchup sem dados');
  const first = (list) => (Array.isArray(list) && list[0]) || null;
  const ids = (o) => (o && Array.isArray(o.ids) ? o.ids : []);
  const core = first(d.core_items);
  const boots = first(d.boots);
  const spells = first(d.summoner_spells);
  const r = first(d.runes);
  const skills = first(d.skills);
  return {
    tip: typeof d.opponent_champion_tip === 'string' ? d.opponent_champion_tip : '',
    laneAdvantage: d.lane_advantage_champion || null,
    playStyle: d.recommended_play_style || null,
    core: ids(core),
    coreGames: (core && core.play) || 0,
    corePick: (core && core.pick_rate) || 0,
    boots: ids(boots),
    starter: ids(first(d.starter_items)),
    spells: ids(spells).slice(0, 2),
    skills: skills && Array.isArray(skills.order) ? skills.order : [],
    runes: r && Array.isArray(r.primary_rune_ids) && Array.isArray(r.secondary_rune_ids)
      ? {
        primaryStyleId: r.primary_page_id, primaryStyleName: r.primary_page_name,
        subStyleId: r.secondary_page_id, subStyleName: r.secondary_page_name,
        names: [...(r.primary_rune_names || []), ...(r.secondary_rune_names || [])],
        perks: [...r.primary_rune_ids, ...r.secondary_rune_ids, ...(r.stat_mod_ids || [])],
        pickRate: r.pick_rate || 0,
      }
      : null,
  };
}

/** Sinergias de um campeão aliado com a minha rota -> { [norm(campeão)]: [-1, 1] } (mín. 100 partidas). */
function parseSynergies(text) {
  const rows = (parseCompact(text).data || {}).synergies || [];
  const out = {};
  for (const r of rows) {
    if (!r || !r.synergy_champion_name || (r.play || 0) < 100) continue;
    out[norm(r.synergy_champion_name)] = clamp(((r.win_rate || 0.5) - 0.5) / 0.05, -1, 1);
  }
  return out;
}

/* ---------- cliente MCP (HTTP) ---------- */

function createMcpClient({ fetchImpl = fetch, endpoint = ENDPOINT, gapMs = MIN_GAP_MS, concurrency = CONCURRENCY } = {}) {
  let session = null;
  let initing = null;
  let last = 0;
  const queue = []; // { run, priority, resolve, reject }
  let active = 0;
  let nextId = 1;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function post(body, withSession) {
    const wait = last + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (withSession && session) headers['Mcp-Session-Id'] = session;
    const res = await fetchImpl(endpoint, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res;
  }

  async function readJsonRpc(res) {
    const raw = await res.text();
    const line = raw.trim().startsWith('{') ? raw.trim() : (raw.split('\n').find((l) => l.startsWith('data:')) || '').slice(5).trim();
    return JSON.parse(line);
  }

  async function init() {
    const res = await post({
      jsonrpc: '2.0', id: nextId++, method: 'initialize',
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'lol-overlay', version: '0.4' } },
    }, false);
    if (!res.ok) throw new Error(`OP.GG respondeu HTTP ${res.status}`);
    session = res.headers.get('mcp-session-id');
    await readJsonRpc(res);
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, true).catch(() => {});
  }

  async function ensureSession() {
    if (session) return;
    if (!initing) initing = init().finally(() => { initing = null; });
    await initing;
  }

  async function callOnce(name, args) {
    await ensureSession();
    const res = await post({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }, true);
    if (res.status === 404 || res.status === 400) {
      session = null;
      const err = new Error('sessão expirada');
      err.retry = true;
      throw err;
    }
    if (!res.ok) throw new Error(`OP.GG respondeu HTTP ${res.status}`);
    const msg = await readJsonRpc(res);
    if (msg.error) throw new Error(msg.error.message || 'erro do OP.GG');
    const text = msg.result && msg.result.content && msg.result.content[0] && msg.result.content[0].text;
    if (!text || msg.result.isError) throw new Error((text || 'resposta vazia').slice(0, 120));
    return text;
  }

  function pump() {
    while (active < concurrency && queue.length) {
      queue.sort((a, b) => b.priority - a.priority);
      const job = queue.shift();
      active++;
      job.run().then(job.resolve, job.reject).finally(() => { active--; pump(); });
    }
  }

  /** Chamadas em paralelo (até `concurrency`), as de maior prioridade primeiro. */
  function call(name, args, priority = 0) {
    const run = async () => {
      try {
        return await callOnce(name, args);
      } catch (err) {
        if (!err.retry) throw err;
        return callOnce(name, args);
      }
    };
    return new Promise((resolve, reject) => { queue.push({ run, priority, resolve, reject }); pump(); });
  }

  const ANALYSIS_FIELDS = [
    'data.summary.average_stats', 'data.damage_type', 'data.strong_counters', 'data.weak_counters',
    'data.core_items', 'data.boots', 'data.starter_items', 'data.fourth_items', 'data.fifth_items',
    'data.sixth_items', 'data.summoner_spells', 'data.runes', 'data.skills.order',
  ];

  return {
    analysis: async (champ, role, priority = 0, tier = null) =>
      parseAnalysis(await call('lol_get_champion_analysis', {
        game_mode: 'ranked', champion: String(champ.id).toUpperCase(), position: POSITION[role] || 'none',
        lang: 'en_US', desired_output_fields: ANALYSIS_FIELDS, ...(tier ? { tier } : {}),
      }, priority)),
    matchup: async (me, enemy, role) =>
      parseMatchup(await call('lol_get_lane_matchup_guide', {
        lang: 'en_US', position: POSITION[role] || 'none',
        my_champion: String(me.id).toUpperCase(), opponent_champion: String(enemy.id).toUpperCase(),
      })),
    synergies: async (ally, allyRole, myRole) =>
      parseSynergies(await call('lol_get_champion_synergies', {
        champion: String(ally.id).toUpperCase(), my_position: POSITION[allyRole] || 'none',
        synergy_position: POSITION[myRole] || 'none', lang: 'en_US',
        desired_output_fields: ['data.synergies[].{champion_name,synergy_champion_name,win_rate,play}'],
      })),
    tierList: async () =>
      parseTierList(await call('lol_list_lane_meta_champions', { lang: 'en_US', position: 'all', desired_output_fields: TL_FIELDS }, 4)),
    laneMeta: async (role) =>
      parseLaneMeta(await call('lol_list_lane_meta_champions', {
        lang: 'en_US', position: POSITION[role],
      }, 5)),
  };
}

module.exports = { createMcpClient, parseTierList, parseCompact, parseAnalysis, parseLaneMeta, parseMatchup, parseSynergies, POSITION };
