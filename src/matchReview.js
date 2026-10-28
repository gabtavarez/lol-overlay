/**
 * Pós-partida a partir do OP.GG: compara você com o oponente de rota, o time com o inimigo
 * e seus itens com a build do meta. Cada ponto traz a evidência (números).
 */
const { t: tr } = require('./i18n');
const k = (n) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const ROLE = { TOP: 'top', JUNGLE: 'jungle', MID: 'middle', ADC: 'bottom', SUPPORT: 'utility' };

const { targetsFor } = require('./goals');
const { gradeMatch } = require('./grades');

function reviewMatch(detail, { coreOf = () => [], itemName = (id) => String(id), tier = null } = {}) {
  const players = detail.teams.flatMap((t) => t.players);
  const me = players.find((p) => p.target);
  if (!me) return null;
  const myTeam = detail.teams.find((t) => t.key === me.team);
  const enemyTeam = detail.teams.find((t) => t.key !== me.team);
  const opp = enemyTeam && enemyTeam.players.find((p) => p.position && p.position === me.position);
  const min = Math.max(1, detail.duration / 60);
  const role = ROLE[me.position] || '';
  const s = me.stats;
  const good = [];
  const bad = [];

  if (opp) {
    const o = opp.stats;
    if (s.damage < o.damage * 0.7) bad.push({ title: tr('Menos dano que o oponente'), text: tr('{a} de dano contra {b} de {champ}', { a: k(s.damage), b: k(o.damage), champ: opp.champion }) });
    else if (s.damage > o.damage * 1.3) good.push({ title: tr('Mais dano que o oponente'), text: tr('{a} contra {b} de {champ}', { a: k(s.damage), b: k(o.damage), champ: opp.champion }) });
    const gd = s.gold - o.gold;
    if (gd <= -2000) bad.push({ title: tr('Atrás em ouro'), text: tr('{g} de ouro contra {champ}', { g: k(gd), champ: opp.champion }) });
    else if (gd >= 2000) good.push({ title: tr('À frente em ouro'), text: tr('{g} de ouro contra {champ}', { g: `+${k(gd)}`, champ: opp.champion }) });
    if (role !== 'utility' && role !== 'jungle' && s.cs - o.cs <= -40) bad.push({ title: tr('Farm abaixo do oponente'), text: tr('{a} CS contra {b} de {champ}', { a: s.cs, b: o.cs, champ: opp.champion }) });
  }
  if (role !== 'utility' && role !== 'jungle') {
    const csm = s.cs / min;
    if (csm >= 7.5) good.push({ title: tr('Farm forte'), text: `${csm.toFixed(1)} CS/min` });
    else if (csm < 5.5) bad.push({ title: tr('Farm baixo'), text: `${csm.toFixed(1)} CS/min` });
  }
  if (s.deaths >= 7) bad.push({ title: tr('Muitas mortes'), text: tr('{n} mortes', { n: s.deaths }) });
  else if (s.deaths <= 2 && detail.duration > 900) good.push({ title: tr('Jogou seguro'), text: tr('só {n} morte(s)', { n: s.deaths }) });
  if (myTeam && myTeam.kills) {
    const kp = (s.kills + s.assists) / myTeam.kills;
    if (kp >= 0.6) good.push({ title: tr('Presente nas lutas'), text: tr('{p}% de participação em abates', { p: Math.round(kp * 100) }) });
    else if (kp < 0.35 && role !== 'top') bad.push({ title: tr('Pouca participação'), text: tr('{p}% de participação em abates', { p: Math.round(kp * 100) }) });
  }
  const wpm = s.wards / min;
  if (role === 'utility' ? wpm < 1 : wpm < 0.35) bad.push({ title: tr('Pouca visão'), text: tr('{n} sentinelas colocadas ({m}/min)', { n: s.wards, m: wpm.toFixed(2) }) });
  if (s.controlWards === 0 && detail.duration > 1200) bad.push({ title: tr('Sem sentinela de controle'), text: tr('nenhuma comprada na partida') });
  if (s.opRank === 1) good.push({ title: tr('Melhor da partida'), text: tr('OP Score {s} (1º de 10)', { s: s.opScore }) });
  else if (s.opRank >= 9) bad.push({ title: tr('OP Score baixo'), text: tr('{s} ({r}º de 10)', { s: s.opScore, r: s.opRank }) });
  if (myTeam && enemyTeam) {
    const dd = myTeam.dragons - enemyTeam.dragons;
    if (dd <= -3) bad.push({ title: tr('Dragões perdidos'), text: `${myTeam.dragons} x ${enemyTeam.dragons}` });
    else if (dd >= 3) good.push({ title: tr('Controle de dragões'), text: `${myTeam.dragons} x ${enemyTeam.dragons}` });
    if (enemyTeam.barons > myTeam.barons) bad.push({ title: tr('Barão do inimigo'), text: `${myTeam.barons} x ${enemyTeam.barons}` });
  }
  const core = coreOf(me.champion, role) || [];
  if (core.length && detail.duration > 1200) {
    const built = core.filter((id) => me.items.includes(id));
    if (!built.length) bad.push({ title: tr('Fora da build do meta'), text: tr('nenhum item core ({list})', { list: core.map(itemName).join(', ') }) });
    else if (built.length >= 2) good.push({ title: tr('Build do meta'), text: `${built.map(itemName).join(', ')}` });
  }
  const teamDamage = myTeam ? myTeam.players.reduce((sum, p) => sum + (p.stats.damage || 0), 0) : 0;
  const objDiff = myTeam && enemyTeam ? (myTeam.dragons - enemyTeam.dragons) + 2 * (myTeam.barons - enemyTeam.barons) + 0.5 * (myTeam.towers - enemyTeam.towers) : null;
  const grades = gradeMatch({ ...s, vision: null }, {
    minutes: min, role, tier, teamKills: myTeam ? myTeam.kills : 0, teamDamage, objDiff,
    objText: myTeam && enemyTeam ? tr('dragões {a}x{b} · torres {c}x{d}', { a: myTeam.dragons, b: enemyTeam.dragons, c: myTeam.towers, d: enemyTeam.towers }) : '',
  });
  if (!good.length) for (const a of grades.best) good.push({ title: `${a.label} acima da meta`, text: a.text });
  const t = targetsFor(tier, role);
  const goals = { aimTier: t.aimTier, cs: t.cs === null ? null : { now: +(s.cs / min).toFixed(1), target: t.cs }, vision: null }; // o OP.GG só informa sentinelas colocadas, não o placar de visão
  return {
    me, opp: opp || null, role, goals, grades,
    teams: { mine: myTeam, enemy: enemyTeam },
    good, bad,
  };
}

module.exports = { reviewMatch };
