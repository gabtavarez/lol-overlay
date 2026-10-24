const fs = require('fs');
const path = require('path');

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIV = { IV: 0, III: 1, II: 2, I: 3 };

/** Elo em pontos absolutos (Ferro IV 0 PDL = 0; cada divisão = 100). Mestre+ soma o PDL direto. */
function absLp(r) {
  if (!r || !r.tier) return null;
  const t = TIERS.indexOf(String(r.tier).toUpperCase());
  if (t < 0) return null;
  if (t >= 7) return 7 * 400 + (r.lp || 0);
  return t * 400 + (DIV[r.division] || 0) * 100 + (r.lp || 0);
}

/** Guarda a evolução do PDL (uma entrada a cada mudança) e calcula o saldo do dia e da semana. */
function createEloTracker({ dir, now = () => Date.now() }) {
  const file = path.join(dir, 'lp-history.json');
  let hist = [];
  try { hist = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { hist = []; }
  const save = () => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(hist.slice(-500))); } catch { /* sem disco */ } };

  return {
    record(rank) {
      const abs = absLp(rank);
      if (abs === null) return;
      const last = hist[hist.length - 1];
      if (last && last.abs === abs && last.wins === rank.wins && last.losses === rank.losses) return;
      hist.push({ at: now(), abs, tier: rank.tier, division: rank.division, lp: rank.lp, wins: rank.wins, losses: rank.losses });
      save();
    },
    summary() {
      if (!hist.length) return null;
      const cur = hist[hist.length - 1];
      const dayStart = new Date(now()); dayStart.setHours(0, 0, 0, 0);
      const before = (t) => [...hist].reverse().find((h) => h.at < t) || hist[0];
      const delta = (t) => cur.abs - before(t).abs;
      return {
        current: cur,
        today: delta(dayStart.getTime()),
        week: delta(now() - 7 * 24 * 3600 * 1000),
        points: hist.filter((h) => h.at >= now() - 14 * 24 * 3600 * 1000).map((h) => [h.at, h.abs]),
      };
    },
  };
}

/** A partir das partidas do OP.GG: sequência atual e melhores/piores campeões da semana (ranqueada solo). */
function weekStats(matches, now = Date.now()) {
  const solo = (matches || []).filter((g) => g.me && g.type === 'SOLORANKED');
  let streak = 0;
  let kind = null;
  for (const g of solo) {
    const w = g.me.stats.result === 'WIN';
    if (kind === null) kind = w;
    if (w !== kind) break;
    streak += 1;
  }
  const week = solo.filter((g) => now - Date.parse(g.createdAt) <= 7 * 24 * 3600 * 1000);
  const by = {};
  for (const g of week) {
    const c = (by[g.me.champion] ||= { champion: g.me.champion, games: 0, wins: 0 });
    c.games += 1;
    if (g.me.stats.result === 'WIN') c.wins += 1;
  }
  const champs = Object.values(by).filter((c) => c.games >= 2).map((c) => ({ ...c, wr: c.wins / c.games }));
  champs.sort((a, b) => b.wr - a.wr || b.games - a.games);
  return {
    streak: kind === null ? null : { wins: kind, count: streak },
    weekGames: week.length, weekWins: week.filter((g) => g.me.stats.result === 'WIN').length,
    best: champs.slice(0, 2), worst: champs.length > 2 ? champs.slice(-2).reverse() : [],
  };
}

module.exports = { createEloTracker, absLp, weekStats };
