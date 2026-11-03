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

module.exports = { mergeOpts, rank, labView, minGames };
