/**
 * Pós-partida a partir do OP.GG: compara você com o oponente de rota, o time com o inimigo
 * e seus itens com a build do meta. Cada ponto traz a evidência (números).
 */
const k = (n) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const ROLE = { TOP: 'top', JUNGLE: 'jungle', MID: 'middle', ADC: 'bottom', SUPPORT: 'utility' };

const { targetsFor } = require('./goals');

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
    if (s.damage < o.damage * 0.7) bad.push({ title: 'Menos dano que o oponente', text: `${k(s.damage)} de dano contra ${k(o.damage)} de ${opp.champion}` });
    else if (s.damage > o.damage * 1.3) good.push({ title: 'Mais dano que o oponente', text: `${k(s.damage)} contra ${k(o.damage)} de ${opp.champion}` });
    const gd = s.gold - o.gold;
    if (gd <= -2000) bad.push({ title: 'Atrás em ouro', text: `${k(gd)} de ouro contra ${opp.champion}` });
    else if (gd >= 2000) good.push({ title: 'À frente em ouro', text: `+${k(gd)} de ouro contra ${opp.champion}` });
    if (role !== 'utility' && role !== 'jungle' && s.cs - o.cs <= -40) bad.push({ title: 'Farm abaixo do oponente', text: `${s.cs} CS contra ${o.cs} de ${opp.champion}` });
  }
  if (role !== 'utility' && role !== 'jungle') {
    const csm = s.cs / min;
    if (csm >= 7.5) good.push({ title: 'Farm forte', text: `${csm.toFixed(1)} CS/min` });
    else if (csm < 5.5) bad.push({ title: 'Farm baixo', text: `${csm.toFixed(1)} CS/min` });
  }
  if (s.deaths >= 7) bad.push({ title: 'Muitas mortes', text: `${s.deaths} mortes` });
  else if (s.deaths <= 2 && detail.duration > 900) good.push({ title: 'Jogou seguro', text: `só ${s.deaths} morte${s.deaths === 1 ? '' : 's'}` });
  if (myTeam && myTeam.kills) {
    const kp = (s.kills + s.assists) / myTeam.kills;
    if (kp >= 0.6) good.push({ title: 'Presente nas lutas', text: `${Math.round(kp * 100)}% de participação em abates` });
    else if (kp < 0.35 && role !== 'top') bad.push({ title: 'Pouca participação', text: `${Math.round(kp * 100)}% de participação em abates` });
  }
  const wpm = s.wards / min;
  if (role === 'utility' ? wpm < 1 : wpm < 0.35) bad.push({ title: 'Pouca visão', text: `${s.wards} sentinelas colocadas (${wpm.toFixed(2)}/min)` });
  if (s.controlWards === 0 && detail.duration > 1200) bad.push({ title: 'Sem sentinela de controle', text: 'nenhuma comprada na partida' });
  if (s.opRank === 1) good.push({ title: 'Melhor da partida', text: `OP Score ${s.opScore} (1º de 10)` });
  else if (s.opRank >= 9) bad.push({ title: 'OP Score baixo', text: `${s.opScore} (${s.opRank}º de 10)` });
  if (myTeam && enemyTeam) {
    const dd = myTeam.dragons - enemyTeam.dragons;
    if (dd <= -3) bad.push({ title: 'Dragões perdidos', text: `${myTeam.dragons} x ${enemyTeam.dragons}` });
    else if (dd >= 3) good.push({ title: 'Controle de dragões', text: `${myTeam.dragons} x ${enemyTeam.dragons}` });
    if (enemyTeam.barons > myTeam.barons) bad.push({ title: 'Barão do inimigo', text: `${myTeam.barons} x ${enemyTeam.barons}` });
  }
  const core = coreOf(me.champion, role) || [];
  if (core.length && detail.duration > 1200) {
    const built = core.filter((id) => me.items.includes(id));
    if (!built.length) bad.push({ title: 'Fora da build do meta', text: `nenhum item core (${core.map(itemName).join(', ')})` });
    else if (built.length >= 2) good.push({ title: 'Build do meta', text: `${built.map(itemName).join(', ')}` });
  }
  const t = targetsFor(tier, role);
  const goals = { aimTier: t.aimTier, cs: t.cs === null ? null : { now: +(s.cs / min).toFixed(1), target: t.cs }, vision: null }; // o OP.GG só informa sentinelas colocadas, não o placar de visão
  return {
    me, opp: opp || null, role, goals,
    teams: { mine: myTeam, enemy: enemyTeam },
    good, bad,
  };
}

module.exports = { reviewMatch };
