/**
 * Laboratório de builds: junta as listas de opções (núcleo, botas, iniciais, runas, feitiços, habilidades)
 * de um ou vários confrontos do OP.GG, somando partidas e vitórias, e ordena por "mais jogada" ou
 * "maior win rate" (só com amostra mínima, para não destacar acaso).
 */
const KINDS = ['cores', 'boots', 'starters', 'spells', 'skills', 'runes'];
const keyOf = (kind, o) => (kind === 'skills' ? o.order.join('') : kind === 'runes' ? `${o.primaryStyleId}:${o.subStyleId}:${o.perks.join(',')}` : o.ids.join(','));

/** Soma várias listas de opções (ex.: os confrontos mais comuns = visão geral). */
function mergeOpts(list) {
  const out = {};
  for (const kind of KINDS) {
    const m = new Map();
    for (const opts of list) {
      for (const o of (opts && opts[kind]) || []) {
        const k = keyOf(kind, o);
        const cur = m.get(k);
        if (cur) { cur.play += o.play; cur.win += o.win; } else m.set(k, { ...o });
      }
    }
    out[kind] = [...m.values()];
  }
  return out;
}

/** Amostra mínima para "maior win rate": 5% da opção mais jogada, entre 50 e 1000 partidas. */
function minGames(list) {
  const top = Math.max(0, ...list.map((o) => o.play));
  return Math.max(50, Math.min(1000, Math.round(top * 0.05)));
}

/** Ordena com win rate calculado: mode 'play' (mais jogada) ou 'wr' (maior win rate, com amostra mínima). */
function rank(list, mode = 'play', limit = 6) {
  const withWr = (list || []).filter((o) => o.play > 0).map((o) => ({ ...o, wr: o.win / o.play }));
  if (mode === 'wr') {
    const min = minGames(withWr);
    return withWr.filter((o) => o.play >= min).sort((a, b) => b.wr - a.wr || b.play - a.play).slice(0, limit);
  }
  return withWr.sort((a, b) => b.play - a.play).slice(0, limit);
}

/** Todas as listas já ordenadas. */
function labView(opts, mode = 'play') {
  const out = { minGames: minGames((opts && opts.cores) || []) };
  for (const kind of KINDS) out[kind] = rank((opts && opts[kind]) || [], mode, kind === 'cores' ? 6 : 4);
  return out;
}

const idList = (x) => (Array.isArray(x) ? x.map(Number).filter((n) => Number.isFinite(n) && n > 0) : null);

/** Valida a build montada na tela (laboratório) antes de virar a build usada no Importar e no overlay. */
function cleanPatch(p = {}) {
  const out = {};
  for (const k of ['core', 'boots', 'starter', 'spells']) { const v = idList(p[k]); if (v && v.length) out[k] = v; }
  if (Array.isArray(p.skills) && p.skills.length) {
    const sk = p.skills.map(String).filter((k) => /^[QWER]$/.test(k));
    if (sk.length) out.skills = sk;
  }
  if (p.runes && Number(p.runes.primaryStyleId) && Array.isArray(p.runes.perks) && p.runes.perks.length >= 6) {
    out.runes = { primaryStyleId: Number(p.runes.primaryStyleId), subStyleId: Number(p.runes.subStyleId), perks: idList(p.runes.perks) };
  }
  if (Array.isArray(p.later)) {
    const later = p.later.map((slot) => (Array.isArray(slot) ? slot.map((o) => ({ ids: idList(o && o.ids) || [], pick: Number(o && o.pick) || 0 })).filter((o) => o.ids.length) : [])).filter((sl) => sl.length);
    if (later.length) out.later = later;
  }
  return out;
}

/** Build do OP.GG com a sua escolha por cima (o que não foi escolhido continua o do OP.GG). */
function applyPatch(build, patch, chosen = {}) {
  if (!build || !patch) return build;
  const out = { ...build, matchup: null, chosen };
  for (const k of ['core', 'boots', 'starter', 'spells', 'skills', 'runes', 'later']) if (patch[k]) out[k] = patch[k];
  return out;
}

module.exports = { mergeOpts, rank, labView, minGames, cleanPatch, applyPatch };
