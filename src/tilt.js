/**
 * Sequência e tilt: lê o histórico do cliente (todas as filas, sem remakes) e diz se é hora de pausar,
 * qual o campeão de conforto e em que horário do dia você ganha mais.
 */
const SESSION_GAP_MS = 90 * 60 * 1000; // mais de 1h30 sem jogar = nova sessão
const BLOCKS = [
  { key: 'madrugada', label: 'Madrugada', from: 0, to: 6 },
  { key: 'manha', label: 'Manhã', from: 6, to: 12 },
  { key: 'tarde', label: 'Tarde', from: 12, to: 18 },
  { key: 'noite', label: 'Noite', from: 18, to: 24 },
];
const MIN_BLOCK_GAMES = 5;

const valid = (g) => g && !g.remake && g.at;

/** Sequência atual a partir da partida mais recente: { type: 'win'|'loss', count }. */
function currentStreak(games) {
  const list = games.filter(valid).sort((a, b) => b.at - a.at);
  if (!list.length) return null;
  const type = list[0].win ? 'win' : 'loss';
  let count = 0;
  for (const g of list) { if ((g.win ? 'win' : 'loss') !== type) break; count += 1; }
  return { type, count };
}

/** Partidas da sessão atual (jogadas em sequência, sem pausa longa) — só se a última foi há pouco. */
function currentSession(games, now) {
  const list = games.filter(valid).sort((a, b) => b.at - a.at);
  const end = (g) => g.at + (g.duration || 0) * 1000;
  if (!list.length || now - end(list[0]) > SESSION_GAP_MS) return [];
  const out = [list[0]];
  for (let i = 1; i < list.length; i++) {
    if (out[out.length - 1].at - end(list[i]) > SESSION_GAP_MS) break;
    out.push(list[i]);
  }
  return out;
}

/** Vitórias por bloco do dia (hora local de quando a partida começou). */
function byHour(games, tzOffsetMin = new Date().getTimezoneOffset()) {
  const rows = BLOCKS.map((b) => ({ ...b, games: 0, wins: 0 }));
  for (const g of games.filter(valid)) {
    const h = new Date(g.at - tzOffsetMin * 60000).getUTCHours();
    const r = rows.find((b) => h >= b.from && h < b.to);
    r.games += 1;
    if (g.win) r.wins += 1;
  }
  for (const r of rows) r.winRate = r.games ? r.wins / r.games : null;
  return rows;
}

/** Campeão de conforto: melhor % de vitória nas últimas partidas (mín. 3 jogos); senão o de mais maestria. */
function comfortPick(games, mastery) {
  const by = new Map();
  for (const g of games.filter(valid).slice(0, 60)) {
    const r = by.get(g.championId) || { championId: g.championId, games: 0, wins: 0 };
    r.games += 1;
    if (g.win) r.wins += 1;
    by.set(g.championId, r);
  }
  const best = [...by.values()].filter((r) => r.games >= 3)
    .sort((a, b) => b.wins / b.games - a.wins / a.games || b.games - a.games)[0];
  if (best && best.wins / best.games >= 0.5) return { championId: best.championId, games: best.games, winRate: best.wins / best.games, why: 'recent' };
  const top = mastery ? [...mastery.entries()].sort((a, b) => b[1].points - a[1].points)[0] : null;
  return top ? { championId: Number(top[0]), why: 'mastery' } : null;
}

/**
 * -> { status: 'stop'|'pause'|'tired'|'hot'|'ok'|'none', title, text, streak, session, recent, hours, best, worst, comfort }
 */
function tiltReport(games = [], { now = Date.now(), mastery = null, tzOffsetMin } = {}) {
  const list = games.filter(valid).sort((a, b) => b.at - a.at);
  if (!list.length) return { status: 'none', title: 'Sem partidas recentes', text: 'Jogue algumas partidas para ver sua sequência.', recent: [], hours: byHour([], tzOffsetMin) };
  const streak = currentStreak(list);
  const sess = currentSession(list, now);
  const session = { games: sess.length, wins: sess.filter((g) => g.win).length, losses: sess.filter((g) => !g.win).length };
  const hours = byHour(list, tzOffsetMin);
  const ranked = hours.filter((h) => h.games >= MIN_BLOCK_GAMES).sort((a, b) => b.winRate - a.winRate);
  const best = ranked.length >= 2 ? ranked[0] : null;
  const worst = ranked.length >= 2 && ranked[ranked.length - 1].winRate < ranked[0].winRate - 0.08 ? ranked[ranked.length - 1] : null;
  const comfort = comfortPick(list, mastery);
  const active = sess.length > 0; // jogando agora (sessão em andamento)

  let status = 'ok';
  let title = 'Tudo certo';
  let text = 'Siga jogando no seu ritmo.';
  if (active && streak.type === 'loss' && streak.count >= 3) {
    status = 'stop'; title = `${streak.count} derrotas seguidas`;
    text = 'Hora de parar por hoje ou fazer uma pausa longa (30 min+). Partidas jogadas no tilt costumam virar mais derrotas.';
  } else if (active && streak.type === 'loss' && streak.count === 2) {
    status = 'pause'; title = '2 derrotas seguidas';
    text = 'Faça uma pausa de 10 min antes da próxima e volte com um campeão de conforto.';
  } else if (active && sess.length >= 6 && session.losses > session.wins) {
    status = 'tired'; title = `${sess.length} partidas nesta sessão`;
    text = `Sessão longa e no negativo (${session.wins}V ${session.losses}D): o cansaço pesa. Considere encerrar.`;
  } else if (streak.type === 'win' && streak.count >= 3) {
    status = 'hot'; title = `${streak.count} vitórias seguidas`;
    text = 'Você está em boa fase: aproveite, mas pare se perder duas seguidas.';
  }
  if (worst && status !== 'stop') {
    const h = new Date(now - (tzOffsetMin != null ? tzOffsetMin : new Date().getTimezoneOffset()) * 60000).getUTCHours();
    if (h >= worst.from && h < worst.to) text += ` Obs.: ${worst.label.toLowerCase()} é o seu pior horário (${Math.round(worst.winRate * 100)}% de vitória).`;
  }
  return {
    status, title, text, streak, session, comfort, hours, best, worst,
    recent: list.slice(0, 10).map((g) => ({ win: g.win, championId: g.championId, at: g.at })),
  };
}

module.exports = { tiltReport, currentStreak, currentSession, byHour, comfortPick };
