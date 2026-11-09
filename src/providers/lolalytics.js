/**
 * Lolalytics (sem API pública): os dados da build vêm serializados na própria página (Qwik, "qwik/json").
 * Extrai combinações de 3 itens (jogos/vitórias), botas, iniciais, 4º/5º item, feitiços, habilidades e
 * a página de runas mais usada. Frágil por natureza: se o site mudar o formato, devolve erro e o app avisa.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const LANE = { top: 'top', jungle: 'jungle', middle: 'middle', bottom: 'bottom', utility: 'support' };
const SLUG = { MonkeyKing: 'wukong', Nunu: 'nunu', Renata: 'renata' };
const TTL = 6 * 3600 * 1000;
// fragmentos: a linha do meio (flex) vem com sufixo "f" nas estatísticas do site (5008f, 5010f, 5001f)
const SHARD_ROWS = [[[5008, '5008'], [5005, '5005'], [5007, '5007']], [[5008, '5008f'], [5010, '5010f'], [5001, '5001f']], [[5011, '5011'], [5013, '5013'], [5001, '5001']]];

/** Desserializa o estado Qwik (objs + referências em base 36). */
function qwikObjects(html) {
  const m = /<script type="qwik\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('formato da página mudou (sem dados)');
  const objs = JSON.parse(m[1]).objs || [];
  const memo = new Map();
  const R = (ref, depth = 0) => {
    if (typeof ref !== 'string') return ref;
    const i = parseInt(ref, 36);
    if (Number.isNaN(i) || i >= objs.length || !/^[0-9a-z]+$/.test(ref)) return ref;
    if (memo.has(i)) return memo.get(i);
    if (depth > 40) return null;
    const o = objs[i];
    let v;
    if (Array.isArray(o)) v = o.map((x) => R(x, depth + 1));
    else if (o && typeof o === 'object') v = Object.fromEntries(Object.entries(o).map(([k, x]) => [k, R(x, depth + 1)]));
    else if (typeof o === 'string' && o.startsWith('\u0012')) v = o === '\u0012' ? null : R(o.slice(1), depth + 1);
    else v = o;
    memo.set(i, v);
    return v;
  };
  // página geral tem "itemSets"; a página por confronto (vs) tem o mesmo formato sem ele
  const idx = objs.findIndex((o) => o && typeof o === 'object' && !Array.isArray(o) && 'item1' in o && 'header' in o && 'boots' in o);
  if (idx < 0) throw new Error('formato da página mudou (sem build)');
  return R(idx.toString(36));
}

/** Página de runas mais usada a partir das estatísticas por runa ([[pick%, wr, jogos] primária, secundária]). */
function topRunePage(stats, styles) {
  if (!stats || !Array.isArray(styles) || !styles.length) return null;
  // aceita a árvore do Data Dragon (slots[].runes) ou já em listas
  styles = styles.map((st) => ({ id: st.id, slots: (st.slots || []).map((sl) => (Array.isArray(sl) ? sl : (sl && sl.runes) || [])) }));
  const pick = (id, sec) => { const s = stats[id]; const e = s && s[sec ? 1 : 0]; return e ? e[0] : -1; };
  const games = (id) => { const s = stats[id]; return s && s[0] ? s[0][2] : 0; };
  let best = null;
  for (const st of styles) for (const r of st.slots[0] || []) if (!best || pick(r.id) > pick(best.r.id)) best = { st, r };
  if (!best) return null;
  const prim = best.st;
  const perks = [best.r.id, ...prim.slots.slice(1, 4).map((row) => [...row].sort((a, b) => pick(b.id) - pick(a.id))[0].id)];
  let sub = null;
  for (const st of styles) {
    if (st.id === prim.id) continue;
    const rows = st.slots.slice(1, 4).map((row) => [...row].sort((a, b) => pick(b.id, true) - pick(a.id, true))[0]);
    const top2 = rows.map((r, i) => ({ r, i, p: pick(r.id, true) })).sort((a, b) => b.p - a.p).slice(0, 2);
    const score = top2.reduce((s, x) => s + x.p, 0);
    if (!sub || score > sub.score) sub = { st, top2: top2.sort((a, b) => a.i - b.i), score };
  }
  const shards = SHARD_ROWS.map((row) => [...row].sort((a, b) => pick(b[1]) - pick(a[1]))[0][0]);
  const ks = stats[best.r.id] && stats[best.r.id][0];
  return { primaryStyleId: prim.id, subStyleId: sub.st.id, perks: [...perks, ...sub.top2.map((x) => x.r.id), ...shards], play: games(best.r.id), keystonePick: pick(best.r.id),
    wr: ks && typeof ks[1] === 'number' ? ks[1] / 100 : null };
}

/** Converte os dados da página no mesmo formato de opções do laboratório (jogos e vitórias). */
function parseBuild(z, styles) {
  const fromRow = (row) => ({ play: row[3] || 0, win: Math.round(((row[1] || 0) / 100) * (row[3] || 0)) }); // [id, wr%, pick%, jogos]
  // As combinações de itens da página não trazem vitórias confiáveis: a build é o item mais escolhido
  // em cada posição (1º, 2º, 3º), e o win rate exibido é o do 3º item (quem completou a build).
  const pos = ['item1', 'item2', 'item3'].map((k) => (z[k] || []).filter((r) => r && r[0]));
  const core = [];
  for (const list of pos) { const r = list.find((x) => !core.includes(x[0])); if (r) core.push(r[0]); }
  const third = pos[2] && pos[2].find((x) => x[0] === core[2]);
  const cores = core.length === 3 && third ? [{ ids: core, ...fromRow(third) }] : [];
  const boots = (z.boots || []).filter((b) => b[0] !== 9999 && b[0] !== 1001).map((b) => ({ ids: [b[0]], ...fromRow(b) }));
  const starters = (z.startSet || []).map((s) => ({ ids: String(s[0]).split('_').map(Number), ...fromRow(s) }));
  const spells = (z.spells || []).map((s) => ({ ids: String(s[0]).split('_').map(Number), ...fromRow(s) }));
  const skills = (z.skillOrder || []).map((s) => ({ order: String(s[0]).split(''), ...fromRow(s) }));
  const page = topRunePage(z.runes && z.runes.stats, styles);
  // win rate da página = o da runa principal (o site não cruza a página inteira)
  const runeWr = page ? (page.wr != null ? page.wr : ((z.header && z.header.wr) || 50) / 100) : 0;
  const runes = page ? [{ primaryStyleId: page.primaryStyleId, subStyleId: page.subStyleId, perks: page.perks, play: page.play, win: Math.round(page.play * runeWr) }] : [];
  const slots = ['item1', 'item2', 'item3', 'item4', 'item5'].map((k) => (z[k] || []).map((r) => ({ ids: [r[0]], ...fromRow(r) })));
  const h = z.header || {};
  return { cores, boots, starters, spells, skills, runes, slots, patch: h.patch || null, wr: h.wr || null, games: h.n || 0, vsWr: h.vsWinRate != null ? h.wr / 100 : null,
    damage: h.damage ? { physical: h.damage.physical, magic: h.damage.magic, true: h.damage.true } : null };
}

const TIER = { ALL: 'all', GOLD: 'gold', PLATINUM_PLUS: 'platinum_plus', EMERALD_PLUS: 'emerald_plus', DIAMOND_PLUS: 'diamond_plus', MASTER_PLUS: 'master_plus', CHALLENGER: 'challenger' };
const slugOf = (id) => SLUG[id] || String(id).toLowerCase().replace(/[^a-z0-9]/g, '');

/** URL da build: geral ou contra um campeão na mesma rota, no elo escolhido. */
function buildUrl(champId, role, { vs = null, tier = 'EMERALD_PLUS' } = {}) {
  const t = TIER[tier] || 'emerald_plus';
  return vs
    ? `https://lolalytics.com/lol/${slugOf(champId)}/vs/${slugOf(vs)}/build/?lane=${LANE[role]}&vslane=${LANE[role]}&tier=${t}`
    : `https://lolalytics.com/lol/${slugOf(champId)}/build/?lane=${LANE[role]}&tier=${t}`;
}

function createLolalytics({ fetchImpl = fetch, log = () => {}, getStyles = () => [], getTier = () => 'EMERALD_PLUS' } = {}) {
  const cache = new Map();
  const inflight = new Set();
  const keyOf = (champId, role, vs) => `${champId}:${role}:${vs || ''}:${getTier() || ''}`;
  return {
    ensure(champId, role, onDone, vs = null) {
      const key = keyOf(champId, role, vs);
      const e = cache.get(key);
      if ((e && Date.now() - e.at < TTL) || inflight.has(key) || !LANE[role]) return;
      inflight.add(key);
      (async () => {
        try {
          const r = await fetchImpl(buildUrl(champId, role, { vs, tier: getTier() }), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
          if (!r.ok) throw new Error(`Lolalytics respondeu HTTP ${r.status}`);
          cache.set(key, { at: Date.now(), data: parseBuild(qwikObjects(await r.text()), getStyles()) });
        } catch (err) {
          log(`Lolalytics: ${err.message}`);
          cache.set(key, { at: Date.now() - TTL + 5 * 60 * 1000, data: { error: err.message } });
        } finally {
          inflight.delete(key);
          if (onDone) onDone();
        }
      })();
    },
    get(champId, role, vs = null) { const e = cache.get(keyOf(champId, role, vs)); return e ? e.data : null; },
  };
}

module.exports = { createLolalytics, qwikObjects, parseBuild, topRunePage, buildUrl };
