/**
 * Bater a meta da área = B (70). Nota da partida por área (Farm, Combate, Visão, Dano, Objetivos) e nota geral (S a D),
 * comparando com o ritmo do elo acima do seu (goals.targetsFor). Cada área traz o porquê
 * e uma dica concreta para a próxima partida quando for a pior.
 */
const { targetsFor } = require('./goals');

const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
const letter = (s) => (s >= 90 ? 'S' : s >= 78 ? 'A' : s >= 64 ? 'B' : s >= 50 ? 'C' : 'D');

const TIPS = {
  farm: 'Farm: priorize a última hit nas ondas de canhão e volte para a rota entre as lutas — cada onda vale ~150 g.',
  combat: 'Combate: menos mortes antes dos 15 min; se o seu oponente sumiu do mapa, recue até ter visão.',
  vision: 'Visão: compre uma sentinela de controle a cada volta à base e use o amuleto antes de cada objetivo.',
  damage: 'Dano: fique nas lutas até o fim e use suas habilidades no alvo mais próximo, não só no carry.',
  objectives: 'Objetivos: depois de abater o oponente de rota, chame o time para dragão ou torre em vez de farmar.',
};

/**
 * stats: { kills, deaths, assists, cs, damage, wards(colocadas) | vision(placar), gold }
 * ctx: { minutes, role, tier, teamKills, teamDamage, objDiff, opp: stats do oponente | null }
 */
function gradeMatch(stats, ctx) {
  const t = targetsFor(ctx.tier, ctx.role);
  const min = Math.max(1, ctx.minutes);
  const areas = [];
  if (t.cs != null) {
    const csm = stats.cs / min;
    areas.push({ key: 'farm', label: 'Farm', score: clamp(70 + (csm / t.cs - 1) * 150), text: `${csm.toFixed(1)} CS/min (meta ${t.cs})` });
  }
  const kda = (stats.kills + stats.assists) / Math.max(1, stats.deaths);
  const kp = ctx.teamKills ? (stats.kills + stats.assists) / ctx.teamKills : null;
  areas.push({ key: 'combat', label: 'Combate', score: clamp(42 + Math.min(kda, 6) * 9 + (kp != null ? (kp - 0.5) * 60 : 0) - Math.max(0, stats.deaths - 6) * 4),
    text: `KDA ${kda.toFixed(2)}${kp != null ? ` · ${Math.round(kp * 100)}% de participação` : ''}` });
  if (stats.vision != null || stats.wards != null) {
    const v = stats.vision != null ? stats.vision / min : stats.wards / min;
    const target = stats.vision != null ? t.vision || 0.8 : ctx.role === 'utility' ? 1.1 : 0.45;
    areas.push({ key: 'vision', label: 'Visão', score: clamp(70 + (v / target - 1) * 80),
      text: stats.vision != null ? `${v.toFixed(2)} de visão/min (meta ${target})` : `${stats.wards} sentinelas (${v.toFixed(2)}/min)` });
  }
  if (ctx.teamDamage && stats.damage != null) {
    const share = stats.damage / ctx.teamDamage;
    const target = ctx.role === 'utility' ? 0.1 : ctx.role === 'jungle' ? 0.17 : 0.23;
    areas.push({ key: 'damage', label: 'Dano', score: clamp(70 + (share / target - 1) * 70), text: `${Math.round(share * 100)}% do dano do time` });
  }
  if (ctx.objDiff != null) {
    areas.push({ key: 'objectives', label: 'Objetivos', score: clamp(62 + ctx.objDiff * 8), text: ctx.objText || '' });
  }
  for (const a of areas) { a.score = Math.round(a.score); a.grade = letter(a.score); }
  const weights = { farm: 1.1, combat: 1.4, vision: 0.7, damage: 1, objectives: 0.8 };
  const wsum = areas.reduce((s, a) => s + weights[a.key], 0) || 1;
  const overall = Math.round(areas.reduce((s, a) => s + a.score * weights[a.key], 0) / wsum);
  const sorted = [...areas].sort((a, b) => a.score - b.score);
  const worst = sorted[0];
  return {
    overall, grade: letter(overall) + (overall >= 96 ? '+' : ''),
    aimTier: t.aimTier, areas,
    best: [...areas].sort((a, b) => b.score - a.score).filter((a) => a.score >= 64).slice(0, 2),
    focus: worst && worst.score < 64 ? { label: worst.label, tip: TIPS[worst.key] } : null,
  };
}

module.exports = { gradeMatch, letter };
