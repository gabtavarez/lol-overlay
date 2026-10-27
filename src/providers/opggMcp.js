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
    oppWinRate: typeof c.win_rate === 'number' ? c.win_rate : null,
    // WR deste campeão contra o outro (o OP.GG manda nas duas listas)
    myWinRate: typeof c.my_win_rate === 'number' ? c.my_win_rate : null,
  }));
}

/** Sinergias com WR bruto (para a página do campeão): [{ name, winRate, games }]. */
function parseSynergyList(text) {
  const rows = (parseCompact(text).data || {}).synergies || [];
  return rows.filter((r) => r && r.synergy_champion_name && (r.play || 0) >= 100)
    .map((r) => ({ name: r.synergy_champion_name, winRate: r.win_rate || 0, games: r.play || 0 }));
}

function rawCounters(positions) {
  const out = {};
  for (const p of Array.isArray(positions) ? positions : []) {
    if (!p || !p.name || !Array.isArray(p.counters)) continue;
    out[String(p.name).toUpperCase()] = p.counters.filter((c) => c && c.champion_name && c.play)
      .map((c) => ({ name: c.champion_name, games: c.play, myWinRate: (c.win || 0) / c.play }));
  }
  return out;
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
    // matchups crus por rota (amostra menor): { MID: [{ name, games, myWinRate }] }
    rawCounters: rawCounters(d.summary && d.summary.positions),
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

const RUNE_FIELDS = 'data.runes.{play,pick_rate,primary_page_id,primary_page_name,primary_rune_ids[],primary_rune_names[],secondary_page_id,secondary_page_name,secondary_rune_ids[],secondary_rune_names[],stat_mod_ids[],win}';

/** Página de runas com jogos, pick % e win %. */
function parseRunePage(text) {
  const r = (parseCompact(text).data || {}).runes;
  if (!r || !Array.isArray(r.primary_rune_ids) || !Array.isArray(r.secondary_rune_ids)) return null;
  const play = r.play || 0;
  return {
    primaryStyleId: r.primary_page_id, primaryStyleName: r.primary_page_name,
    subStyleId: r.secondary_page_id, subStyleName: r.secondary_page_name,
    names: [...(r.primary_rune_names || []), ...(r.secondary_rune_names || [])],
    perks: [...r.primary_rune_ids, ...r.secondary_rune_ids, ...(r.stat_mod_ids || [])],
    pickRate: r.pick_rate || 0, games: play, winRate: play ? (r.win || 0) / play : 0,
  };
}

function parseChampStats(text) {
  const a = (((parseCompact(text).data || {}).summary) || {}).average_stats;
  if (!a || !a.play) return null;
  return {
    tier: Number(a.tier) || 5, rank: Number(a.rank) || 999, rankPrev: Number(a.tier_data && a.tier_data.rank_prev) || null,
    winRate: a.win_rate || 0, pickRate: a.pick_rate || 0, banRate: a.ban_rate || 0, games: a.play || 0, kda: a.kda || 0,
  };
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

/** Perfil do invocador (lane scouting): elo solo, vitórias, sequência e campeões mais jogados. */
function parseSummoner(text) {
  const s = (parseCompact(text).data || {}).summoner || {};
  const solo = (s.league_stats || []).find((l) => l && l.game_type === 'SOLORANKED') || null;
  const ti = (solo && solo.tier_info) || {};
  const champs = ((s.most_champions || {}).champion_stats || []).filter((c) => c && c.champion_name).map((c) => ({
    name: c.champion_name, games: c.play || 0, wins: c.win || 0,
    kda: c.death ? Number(((c.kill + c.assist) / c.death).toFixed(2)) : (c.kill || 0) + (c.assist || 0),
  }));
  return {
    tier: ti.tier || null, division: ti.division || null, lp: ti.lp || 0,
    wins: (solo && solo.win) || 0, losses: (solo && solo.lose) || 0, hot: Boolean(solo && solo.is_hot_streak),
    champs,
  };
}

const STAT_FIELDS = '{assist,death,kill,gold_earned,minion_kill,neutral_minion_kill,total_damage_dealt_to_champions,total_damage_taken,vision_wards_bought_in_game,ward_place,op_score,op_score_rank,result,time_ccing_others}';
const TEAM_FIELDS = '{baron_kill,dragon_kill,tower_kill,horde_kill,rift_herald_kill,is_win,champion_kill,gold_earned}';

function mapStats(s = {}) {
  return {
    kills: s.kill || 0, deaths: s.death || 0, assists: s.assist || 0, gold: s.gold_earned || 0,
    cs: (s.minion_kill || 0) + (s.neutral_minion_kill || 0), damage: s.total_damage_dealt_to_champions || 0,
    taken: s.total_damage_taken || 0, controlWards: s.vision_wards_bought_in_game || 0, wards: s.ward_place || 0,
    opScore: s.op_score || 0, opRank: s.op_score_rank || 0, result: s.result || '', cc: s.time_ccing_others || 0,
    timeline: Array.isArray(s.op_score_timeline) ? s.op_score_timeline.map((p) => [p.second, p.score]) : [],
  };
}
const mapTeam = (t) => ({ key: t.key, win: Boolean(t.game_stat && t.game_stat.is_win), kills: (t.game_stat || {}).champion_kill || 0, gold: (t.game_stat || {}).gold_earned || 0,
  dragons: (t.game_stat || {}).dragon_kill || 0, barons: (t.game_stat || {}).baron_kill || 0, towers: (t.game_stat || {}).tower_kill || 0,
  grubs: (t.game_stat || {}).horde_kill || 0, heralds: (t.game_stat || {}).rift_herald_kill || 0 });
const mapPart = (p) => ({ champion: p.champion_name, position: p.position || '', team: p.team_key, items: (p.items || []).filter(Boolean), target: Boolean(p.is_target),
  spells: p.spells || [], keystone: p.rune ? p.rune.primary_rune_id : null, secondary: p.rune ? p.rune.secondary_page_id : null,
  name: p.summoner ? `${p.summoner.game_name || ''}#${p.summoner.tagline || ''}` : '', stats: mapStats(p.stats) });

/** Ranking de um campeão: melhores jogadores (one-tricks) com Riot ID, elo e partidas. */
function parseLeaderboard(text) {
  const rows = (parseCompact(text) || {}).leaderboard || [];
  return rows.filter((r) => r && r.summoner && r.summoner.game_name).map((r) => {
    const solo = (r.summoner.league_stats || []).find((l) => l && l.game_type === 'SOLORANKED') || {};
    const ti = solo.tier_info || {};
    const st = r.most_champion_stat || {};
    return { rank: r.rank, riotId: `${r.summoner.game_name}#${r.summoner.tagline}`, tier: ti.tier || null, division: ti.division || null, lp: ti.lp || 0, games: st.play || 0, wins: st.win || 0 };
  });
}

/** Partidas recentes do invocador (só a linha dele + placar dos times). */
function parseMatches(text) {
  const rows = (parseCompact(text).data || {}).game_history || [];
  return rows.filter((g) => g && g.id).map((g) => ({
    id: g.id, createdAt: g.created_at, type: g.game_type, duration: g.game_length_second || 0,
    me: (g.participants || []).map(mapPart)[0] || null,
    teams: (g.teams || []).map(mapTeam),
  }));
}

/** Detalhe de uma partida: os 10 jogadores, com o foco marcado em `target`. */
function parseGameDetail(text) {
  const d = (parseCompact(text).data || {}).game_detail || {};
  const teams = (d.teams || []).map((t) => ({ ...mapTeam(t), players: (t.participants || []).map(mapPart) }));
  return { id: d.id, type: d.game_type, duration: d.game_length_second || 0, teams };
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

  const MODE_ROLES = ['aram', 'arena'];
  const ANALYSIS_FIELDS = [
    'data.summary.average_stats', 'data.damage_type', 'data.strong_counters', 'data.weak_counters',
    'data.core_items', 'data.boots', 'data.starter_items', 'data.fourth_items', 'data.fifth_items',
    'data.sixth_items', 'data.summoner_spells', 'data.runes', 'data.skills.order',
    'data.summary.positions[].name', 'data.summary.positions[].counters[].{champion_name,play,win}',
  ];

  return {
    // role 'aram' / 'arena' = modo de jogo (sem rota): pede a build daquele modo ao OP.GG
    analysis: async (champ, role, priority = 0, tier = null) =>
      parseAnalysis(await call('lol_get_champion_analysis', {
        // ARAM exige uma rota no parâmetro, mas ignora (mesmo resultado em qualquer uma)
        game_mode: role === 'aram' ? 'aram' : 'ranked', champion: String(champ.id).toUpperCase(), position: role === 'aram' ? 'mid' : POSITION[role] || 'none',
        lang: 'en_US', desired_output_fields: MODE_ROLES.includes(role) ? ANALYSIS_FIELDS.filter((f) => !/positions|counters|tier/.test(f)) : ANALYSIS_FIELDS,
        ...(tier && !MODE_ROLES.includes(role) ? { tier } : {}),
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
    synergyList: async (champ, role, partnerRole) =>
      parseSynergyList(await call('lol_get_champion_synergies', {
        champion: String(champ.id).toUpperCase(), my_position: POSITION[role] || 'none',
        synergy_position: POSITION[partnerRole] || 'none', lang: 'en_US',
        desired_output_fields: ['data.synergies[].{champion_name,synergy_champion_name,win_rate,play}'],
      }, 6)),
    summoner: async (gameName, tagLine, region) =>
      parseSummoner(await call('lol_get_summoner_profile', {
        game_name: gameName, tag_line: tagLine, region: String(region || 'BR').toUpperCase(), lang: 'en_US',
        desired_output_fields: ['data.summoner.league_stats[].{game_type,is_hot_streak,lose,win}', 'data.summoner.league_stats[].tier_info.{division,lp,tier}',
          'data.summoner.most_champions.champion_stats[].{assist,champion_name,death,kill,lose,play,win}'],
      }, 15)),
    leaderboard: async (champ, region) =>
      parseLeaderboard(await call('lol_list_champion_leaderboard', {
        region: String(region || 'BR').toUpperCase(), champion: String(champ.id).toUpperCase(),
        desired_output_fields: ['leaderboard[].rank', 'leaderboard[].most_champion_stat.{play,win}', 'leaderboard[].summoner.{game_name,tagline}',
          'leaderboard[].summoner.league_stats[].game_type', 'leaderboard[].summoner.league_stats[].tier_info.{division,lp,tier}'],
      }, 3)),
    matches: async (gameName, tagLine, region, limit = 15, priority = 8) =>
      parseMatches(await call('lol_list_summoner_matches', {
        game_name: gameName, tag_line: tagLine, region: String(region || 'BR').toUpperCase(), lang: 'en_US', limit,
        desired_output_fields: ['data.game_history[].{created_at,game_length_second,game_type,id}',
          'data.game_history[].participants[].{champion_name,items[],position,spells[],team_key}',
          'data.game_history[].participants[].rune.{primary_page_id,primary_rune_id,secondary_page_id}',
          `data.game_history[].participants[].stats.${STAT_FIELDS}`,
          'data.game_history[].participants[].stats.op_score_timeline[].{score,second}',
          'data.game_history[].teams[].key', `data.game_history[].teams[].game_stat.${TEAM_FIELDS}`],
      }, priority)),
    gameDetail: async (id, createdAt, riotId, region) =>
      parseGameDetail(await call('lol_get_summoner_game_detail', {
        region: String(region || 'BR').toUpperCase(), lang: 'en_US', game_id: id, created_at: createdAt, focus_riot_id: riotId,
        desired_output_fields: ['data.game_detail.{game_length_second,game_type,id}',
          'data.game_detail.teams[].participants[].{champion_name,is_target,items[],position,team_key}',
          'data.game_detail.teams[].participants[].summoner.{game_name,tagline}',
          `data.game_detail.teams[].participants[].stats.${STAT_FIELDS.replace(',op_score_timeline', '')}`,
          'data.game_detail.teams[].key', `data.game_detail.teams[].game_stat.${TEAM_FIELDS}`],
      }, 20)),
    /** Só a página de runas mais jogada num elo (o OP.GG expõe 1 por consulta). */
    /** Augments do ARAM: Desordem para um campeão (tier 3+), ordenados por desempenho. */
    aramAugments: async (champKey) => {
      const d = parseCompact(await call('lol_list_aram_augments', {
        champion_id: Number(champKey), lang: 'pt_BR', desired_output_fields: ['data.augments[].{id,name,tier,performance,popular}'],
      }, 5)).data || {};
      return (d.augments || []).filter((a) => a && a.name).map((a) => ({ id: a.id, name: a.name, tier: a.tier, score: a.performance, pick: a.popular }))
        .sort((a, b) => b.score - a.score);
    },
    runes: async (champ, role, tier, priority = 1) =>
      parseRunePage(await call('lol_get_champion_analysis', {
        game_mode: 'ranked', champion: String(champ.id).toUpperCase(), position: POSITION[role] || 'none', lang: 'en_US',
        desired_output_fields: [RUNE_FIELDS], ...(tier ? { tier } : {}),
      }, priority)),
    /** Estatísticas de um campeão numa rota e elo (para a tier list por elo). */
    champStats: async (champ, role, tier, priority = 2) =>
      parseChampStats(await call('lol_get_champion_analysis', {
        game_mode: 'ranked', champion: String(champ.id).toUpperCase(), position: POSITION[role] || 'none', lang: 'en_US',
        desired_output_fields: ['data.summary.average_stats.{play,win_rate,pick_rate,ban_rate,kda,tier,rank}', 'data.summary.average_stats.tier_data.{rank_prev}'],
        ...(tier ? { tier } : {}),
      }, priority)),
    tierList: async () =>
      parseTierList(await call('lol_list_lane_meta_champions', { lang: 'en_US', position: 'all', desired_output_fields: TL_FIELDS }, 4)),
    laneMeta: async (role) =>
      parseLaneMeta(await call('lol_list_lane_meta_champions', {
        lang: 'en_US', position: POSITION[role],
      }, 5)),
  };
}

module.exports = {
  parseRunePage, parseChampStats, parseSynergyList, createMcpClient, parseTierList, parseSummoner, parseMatches, parseGameDetail, parseLeaderboard, parseCompact, parseAnalysis, parseLaneMeta, parseMatchup, parseSynergies, POSITION };
