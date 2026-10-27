/**
 * Coach de rota: lê o estado da Live API e diz, em uma frase, o que fazer agora na rota
 * (trocar, all-in, recuar, rotacionar), com os motivos em linhas curtas.
 *
 * O que vem da partida: níveis, itens fechados, CS, vida, mortes, eventos (abates/objetivos).
 * O que vem de você: feitiços do inimigo marcados nos timers (o jogo não informa quando ele usa).
 */
const { objectiveTimers, SPELL_CD } = require('./timers');
const { curveOf } = require('./power');
const { targetsFor } = require('./goals');
const { isBoots } = require('./buys');

const mm = (s) => `${Math.floor(s / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const SPELL_PT = { SummonerFlash: 'Flash', SummonerDot: 'Incendiar', SummonerHeal: 'Curar', SummonerBarrier: 'Barreira', SummonerExhaust: 'Exaustão', SummonerBoost: 'Purificar', SummonerHaste: 'Fantasma', SummonerTeleport: 'Teleporte' };
const SIDE = { TOP: 'top', MIDDLE: 'mid', BOTTOM: 'bot', UTILITY: 'bot' };
const SIDE_PT = { top: 'no topo', mid: 'no meio', bot: 'no bot' };
const EVENT_SIDE = { DragonKill: 'bot', HeraldKill: 'top', BaronKill: 'top', HordeKill: 'top' };

const markKey = (p, spell) => `${p.riotId || p.champion}:${spell}`;
const short = (n) => String(n || '').split('#')[0].toLowerCase();

/** Itens lendários fechados (sem bota e sem componente). */
function completedItems(p, dd) {
  if (!dd || !p) return [];
  return (p.items || []).filter((it) => {
    const m = dd.item(it.id);
    return m && m.gold && m.gold.total >= 2000 && !isBoots(dd, it.id) && !(m.into && m.into.length);
  }).map((it) => ({ id: it.id, name: (dd.item(it.id) || {}).name || it.name }));
}

/** Último sinal do caçador inimigo: abate/assistência/objetivo com tempo e lado do mapa. */
function junglerSeen(state, jg) {
  const players = [state.me, ...(state.allies || []), ...(state.enemies || [])];
  const byName = (n) => players.find((p) => short(p.name) === short(n) || short(p.gameName) === short(n));
  const isJg = (n) => n && byName(n) === jg;
  let seen = null;
  for (const e of state.events || []) {
    const involved = isJg(e.killer) || (e.assisters || []).some(isJg);
    if (!involved) continue;
    let side = EVENT_SIDE[e.name] || null;
    if (e.name === 'ChampionKill') { const v = byName(e.victim); side = v && SIDE[v.position] ? SIDE[v.position] : null; }
    if (!seen || e.time >= seen.time) seen = { time: e.time, side };
  }
  return seen;
}

const KEY_LEVELS = [2, 3, 6, 11, 16];

/**
 * ctx: { dd, marks: { 'riotId:Spell': prontoEm }, tier, role, matchupTip }
 * -> { tone: 'go'|'warn'|'bad'|'even', label, head, rows: [{ icon, label, text }], vs } | null
 */
function laneCoach(state, ctx = {}) {
  if (!state || state.phase !== 'ingame' || !state.me) return null;
  const mode = String(state.gameMode || '').toUpperCase();
  if (mode && mode !== 'CLASSIC') return null;
  const { dd, marks = {}, tier, role } = ctx;
  const t = state.gameTime || 0;
  const me = state.me;
  const opp = state.laneOpponent;
  const oppName = opp ? opp.champion : 'o oponente';
  const heads = []; // { pri, tone, label, head }
  const rows = [];
  const say = (pri, tone, label, head) => heads.push({ pri, tone, label, head });

  if (me.isDead) {
    return { tone: 'even', label: 'Morto', head: `Volta em ${Math.ceil(me.respawnTimer || 0)} s: compre e planeje a próxima rota.`, rows: [], vs: opp ? opp.champion : null };
  }

  // feitiços do oponente (marcados por você)
  if (opp) {
    const parts = (opp.spells || []).map((sp) => {
      const ready = marks[markKey(opp, sp)] || 0;
      return { sp, left: Math.round(ready - t) };
    });
    const flash = parts.find((p) => p.sp === 'SummonerFlash');
    if (parts.length) {
      rows.push({ icon: 'flame', label: `Feitiços de ${oppName}`, text: parts.map((p) => `${SPELL_PT[p.sp] || p.sp} ${p.left > 0 ? `volta em ${mm(p.left)}` : 'pronto'}`).join(' · ') });
    }
    if (flash && flash.left > 20) say(60, 'go', 'Sem Flash', `${oppName} está sem Flash até ${mm(t + flash.left)}: jogue agressivo e chame o caçador.`);
    // vida baixa contra Incendiar
    const ign = parts.find((p) => p.sp === 'SummonerDot');
    if (me.hp != null && me.hp < 0.35 && !opp.isDead) {
      say(90, 'bad', 'Recue', ign && ign.left <= 0 ? `Vida baixa e ${oppName} tem Incendiar: volte para a base agora.` : `Vida baixa (${Math.round(me.hp * 100)}%): saia do alcance de ${oppName} ou volte.`);
    }
  }

  // oponente morto
  if (opp && opp.isDead && opp.respawnTimer > 3) {
    say(95, 'go', 'Pressione', `${oppName} morto por ${Math.ceil(opp.respawnTimer)} s: empurre a onda e tire placa ou vá para o objetivo.`);
  }

  // níveis
  if (opp) {
    const a = me.level || 1;
    const b = opp.level || 1;
    rows.push({ icon: 'arrow-up-circle', label: 'Níveis', text: `Você ${a} · ${oppName} ${b}` });
    const mine = KEY_LEVELS.filter((l) => a >= l && b < l).pop();
    const theirs = KEY_LEVELS.filter((l) => b >= l && a < l).pop();
    const early = t < 14 * 60;
    if (mine && (mine >= 6 || early)) {
      say(mine === 6 ? 80 : 70, 'go', mine === 6 ? 'All-in' : 'Janela de troca',
        mine === 6 ? `Você tem ult e ${oppName} não: janela de all-in.` : `Você chegou no nível ${mine} primeiro: troque agora.`);
    } else if (theirs && (theirs >= 6 || early)) {
      say(theirs === 6 ? 85 : 72, 'bad', 'Recue',
        theirs === 6 ? `${oppName} tem ult e você não: recue até o nível 6.` : `${oppName} chegou no nível ${theirs} primeiro: evite trocas até upar.`);
    }
  }

  // picos de item
  if (opp && dd) {
    const mi = completedItems(me, dd);
    const oi = completedItems(opp, dd);
    if (mi.length || oi.length) {
      rows.push({ icon: 'package', label: 'Itens fechados', text: `Você ${mi.length} · ${oppName} ${oi.length}${oi.length ? ` (${oi[oi.length - 1].name})` : ''}` });
    }
    if (oi.length > mi.length) {
      const it = oi[oi.length - 1];
      say(65, 'bad', 'Pico do inimigo', `${oppName} fechou ${it.name} e você tem menos itens: evite trocas longas${me.gold >= 900 ? ` e volte com ${me.gold} g` : ''}.`);
    } else if (mi.length > oi.length && t < 25 * 60) {
      say(62, 'go', 'Seu pico', `Você tem ${mi.length} item${mi.length > 1 ? 's' : ''} contra ${oi.length}: use a vantagem para trocar.`);
    }
  }

  // caçador inimigo
  const jg = (state.enemies || []).find((e) => e.position === 'JUNGLE' || (e.spells || []).includes('SummonerSmite'));
  const mySide = SIDE[me.position] || (role === 'top' ? 'top' : role === 'bottom' || role === 'utility' ? 'bot' : role === 'middle' ? 'mid' : null);
  if (jg && role !== 'jungle' && t < 20 * 60) {
    if (jg.isDead) {
      rows.push({ icon: 'eye', label: 'Caçador', text: `${jg.champion} morto por ${Math.ceil(jg.respawnTimer || 0)} s: sem gank agora.` });
    } else {
      const seen = junglerSeen(state, jg);
      const ago = seen ? Math.round(t - seen.time) : null;
      if (seen && ago <= 40 && seen.side && seen.side !== mySide) {
        rows.push({ icon: 'eye', label: 'Caçador', text: `${jg.champion} apareceu ${SIDE_PT[seen.side]} há ${ago} s: seu lado está livre.` });
      } else if (seen && ago <= 25 && seen.side === mySide) {
        say(75, 'warn', 'Atenção', `${jg.champion} está perto da sua rota (${ago} s atrás): jogue perto da torre.`);
      } else if (t >= 165 && (!seen || ago > 60)) {
        const text = seen ? `${jg.champion} sumido há ${mm(ago)} (último ${SIDE_PT[seen.side] || 'no mapa'})` : `${jg.champion} ainda não apareceu: primeiro gank costuma vir entre 2:45 e 4:00`;
        rows.push({ icon: 'eye', label: 'Caçador', text });
        if (t < 8 * 60) say(40, 'warn', 'Atenção', `${text}. Não avance sem visão.`);
      }
    }
  }

  // objetivos próximos
  for (const o of objectiveTimers(state)) {
    if (o.in > 0 && o.in <= 60) {
      rows.push({ icon: 'flag', label: 'Objetivo', text: `${o.label} em ${mm(o.in)}` });
      if (o.key !== 'baron' || t >= 20 * 60) say(55, 'go', 'Rotação', `${o.label} em ${mm(o.in)}: empurre a onda e chegue primeiro no rio.`);
      break;
    }
    if (o.in === 0 && o.key === 'dragon' && t >= 5 * 60 && opp && opp.isDead) {
      say(96, 'go', 'Objetivo', `${oppName} morto e Dragão vivo: chame o time para o dragão.`);
    }
  }

  // farm
  const min = Math.max(1, t / 60);
  const target = targetsFor(tier, role).cs;
  if (target && role !== 'utility' && t >= 90) {
    const csm = me.scores.cs / min;
    const vs = opp ? me.scores.cs - opp.scores.cs : null;
    rows.push({ icon: 'coin', label: 'Farm', text: `${me.scores.cs} CS · ${csm.toFixed(1)}/min (meta ${target})${vs != null ? ` · ${vs >= 0 ? '+' : '−'}${Math.abs(vs)} contra ${oppName}` : ''}` });
  }

  // fase do jogo (fallback): quem é mais forte agora
  if (opp) {
    const phase = t < 14 * 60 ? 0 : t < 25 * 60 ? 1 : 2;
    const d = curveOf(me.championId, me.tags) [phase] - curveOf(opp.championId, opp.tags)[phase];
    const phaseName = ['início', 'meio', 'fim'][phase];
    if (d > 0) say(10, 'go', 'Vantagem', `No ${phaseName} de jogo você é mais forte que ${oppName}: pressione a rota.`);
    else if (d < 0) say(10, 'warn', 'Cuidado', `No ${phaseName} de jogo ${oppName} é mais forte: farme seguro e espere o seu pico.`);
    else say(5, 'even', 'Neutro', `Rota equilibrada: farme e troque quando ${oppName} errar uma habilidade.`);
  } else {
    say(5, 'even', 'Neutro', 'Oponente de rota não identificado: siga o farm e os timers.');
  }

  heads.sort((x, y) => y.pri - x.pri);
  const top = heads[0];
  return { tone: top.tone, label: top.label, head: top.head, rows: rows.slice(0, 5), vs: opp ? opp.champion : null };
}

module.exports = { laneCoach, completedItems, junglerSeen, SPELL_CD };
