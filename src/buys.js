const { damageProfile } = require('./recommender');
const defaultFlags = require('../data/champion-flags.json');
const reactive = require('../data/reactive-items.json');
const { laterItems } = require('./buildPath');
const { rankThreats, kdaText } = require('./threat');
const { goldCompare } = require('./goldDiff');

const BOOT_TAG = 'Boots';

function classOf(me, build) {
  if (build && build.damageType === 'AP') return 'ap';
  if (me.tags.includes('Marksman')) return 'adc';
  if (me.tags[0] === 'Tank') return 'tank';
  return 'ad';
}

/**
 * Bota (inclusive as evoluídas: Grevas Bélicas 3172 vem das Grevas do Berserker e o Data Dragon
 * não marca a tag "Boots" nela). Conta como bota se tiver a tag ou se for feita a partir de uma bota.
 */
function isBoots(dd, id, depth = 0) {
  const it = dd.item(id);
  if (!it) return false;
  if ((it.tags || []).includes(BOOT_TAG)) return true;
  return depth < 2 && (it.from || []).some((p) => isBoots(dd, Number(p), depth + 1));
}

function ownedIds(me) {
  const ids = [];
  for (const it of me.items) for (let i = 0; i < (it.count || 1); i++) ids.push(it.id);
  return ids;
}

/** Ouro que ainda falta: custo de combinar + partes que você ainda não tem (recursivo). */
function missingGold(dd, id, owned, used = []) {
  if (!dd.item(id)) return null;
  const pool = [...owned];
  const cost = (itemId) => {
    const it = dd.item(itemId);
    if (!it) return 0;
    let sum = it.from && it.from.length ? (it.gold && it.gold.base) || 0 : (it.gold && it.gold.total) || 0;
    for (const part of it.from || []) {
      const idx = pool.indexOf(Number(part));
      if (idx >= 0) { pool.splice(idx, 1); used.push(Number(part)); }
      else sum += cost(part);
    }
    return sum;
  };
  return cost(id);
}

/** Componente (de qualquer nível da receita) mais caro que ainda não tenho e que cabe em `gold`. */
function bestComponent(dd, id, owned, gold) {
  const have = new Set(owned);
  let best = null;
  const walk = (itemId) => {
    const it = dd.item(itemId);
    if (!it) return;
    for (const part of it.from || []) {
      const p = dd.item(part);
      if (!p || have.has(Number(part))) continue;
      const cost = (p.gold && p.gold.total) || 0;
      if (cost <= gold && cost >= 400 && (!best || cost > best.cost)) best = { id: Number(part), name: p.name, cost };
      walk(part);
    }
  };
  walk(id);
  return best;
}

function firstAvailable(ids, dd, ownedSet) {
  return (ids || []).find((id) => dd.item(id) && !ownedSet.has(id)) || null;
}

/** Cita o inimigo que pesa mais naquele tipo de dano, com KDA se ele estiver fed. */
function who(list, key, n = 2) {
  return [...list].sort((a, b) => key(b) - key(a)).slice(0, n)
    .map((x) => (x.fed || x.lane ? `${x.e.champion} ${kdaText(x.e)}${x.lane ? ' (sua rota)' : ''}` : x.e.champion)).join(', ');
}

/**
 * Bota certa para o momento: defensiva se você está perdendo a rota ou o time inimigo tem muito CC/dano
 * de um tipo; senão, a bota ofensiva do meta (janela pra buildar dano).
 */
const DEFAULT_BOOTS = { ap: [3020], adc: [3006], ad: [3158, 3047], tank: [3047, 3111] };

function chooseBoots({ me, t, apShare, adShare, build, dd, ownedSet, flags, laneOpponentName, cls = 'ad' }) {
  const meta = (build && build.boots && build.boots.find((id) => dd.item(id))) || (DEFAULT_BOOTS[cls] || []).find((id) => dd.item(id));
  const mercs = firstAvailable(reactive.bootsMr, dd, ownedSet);
  const steel = firstAvailable(reactive.bootsArmor, dd, ownedSet);
  const opp = t.find((x) => x.lane) || t.find((x) => x.e.champion === laneOpponentName) || null;
  const my = me.scores || { kills: 0, deaths: 0 };
  const losing = (opp && (opp.fed || opp.e.scores.kills - opp.e.scores.deaths >= 3 || (opp.e.level || 1) - (me.level || 1) >= 2))
    || (my.deaths - my.kills >= 3);
  const cc = t.filter((x) => (flags.hardCc || []).includes(x.e.championId));
  const ccWeight = cc.reduce((s, x) => s + x.w, 0);
  const names = (list) => list.slice(0, 3).map((x) => x.e.champion).join(', ');

  if (mercs && (ccWeight >= 3 || (cc.length >= 3 && apShare >= 0.45))) {
    return { id: mercs, score: losing ? 70 : 64, reason: `Muito controle de grupo (${names(cc)}): tenacidade` };
  }
  if (opp && !losing) {
    if ((flags.autoAttackers || []).includes(opp.e.championId) && steel) return { id: steel, score: 63, reason: `${opp.e.champion} vive de ataque básico: Aço` };
    if (opp.d.ap >= 0.6 && (flags.hardCc || []).includes(opp.e.championId) && mercs) return { id: mercs, score: 63, reason: `${opp.e.champion} (AP com controle de grupo): Mercúrio` };
  }
  if (losing && opp) {
    const vs = `${opp.e.champion} ${opp.e.scores.kills}/${opp.e.scores.deaths}/${opp.e.scores.assists}`;
    if (opp.d.ap >= 0.6 && mercs) return { id: mercs, score: 68, reason: `Perdendo a rota para ${vs}: bota defensiva` };
    if (opp.d.ad >= 0.6 && steel) return { id: steel, score: 68, reason: `Perdendo a rota para ${vs}: bota defensiva` };
  }
  if (adShare >= 0.65 && steel) return { id: steel, score: 62, reason: 'Time inimigo quase todo AD: armadura na bota' };
  if (apShare >= 0.65 && mercs) return { id: mercs, score: 62, reason: 'Time inimigo quase todo AP: RM na bota' };
  if (meta) return { id: meta, score: losing ? 52 : 60, reason: losing ? 'Bota do meta' : 'Rota sob controle: bota ofensiva do meta' };
  return null;
}

/**
 * Próximas compras: 3 itens com motivo. Mistura o caminho do meta (build do OP.GG
 * para o seu campeão e rota) com itens reativos contra o time inimigo.
 */
function buyAdvice({ state, build, dd, flags = defaultFlags }) {
  if (!dd || !state || !state.me) return { items: [], notes: ['Aguardando dados do jogo…'] };
  const me = state.me;
  const enemies = state.enemies || [];
  const owned = ownedIds(me);
  const ownedSet = new Set(owned);
  const cls = classOf(me, build);
  const early = state.gameTime < 600;
  const cands = new Map(); // id -> { score, reason, tag }

  const add = (id, score, reason, tag) => {
    if (!id || ownedSet.has(id) || !dd.item(id)) return;
    const prev = cands.get(id);
    if (!prev || score > prev.score) cands.set(id, { score, reason, tag });
  };

  /* --- item inicial (começo da partida, inventário vazio) --- */
  if (!owned.length) {
    const role = state.myRole || '';
    const fallback = reactive.starters[role === 'jungle' || role === 'utility' ? role : cls] || [];
    const starter = (build && build.starter && build.starter.length ? build.starter : fallback).filter((id) => dd.item(id));
    const counts = new Map();
    for (const id of starter) counts.set(id, (counts.get(id) || 0) + 1);
    [...counts].forEach(([id, n], i) => add(id, 97 - i * 2, `Item inicial${build && build.starter && build.starter.length ? ' do meta' : ''}${n > 1 ? ` · compre ${n}` : ''}`, 'starter'));
  }

  /* --- caminho do meta --- */
  // Bota básica (1001) não conta: ela precisa virar a bota final, e o ouro que falta já desconta a básica.
  const BASIC_BOOTS = 1001;
  const hasBoots = owned.some((id) => id !== BASIC_BOOTS && isBoots(dd, id));
  const hasBasicBoots = owned.includes(BASIC_BOOTS);
  const path = [];
  if (build) {
    path.push(...build.core, ...laterItems(build));
  }
  const pathLeft = path.filter((id) => !ownedSet.has(id) && dd.item(id));
  const pickTxt = build && build.corePick ? ` · ${Math.round(build.corePick * 100)}% dos jogadores` : '';
  pathLeft.slice(0, 3).forEach((id, i) => {
    add(id, 72 - i * 14, `Build do meta${i === 0 ? pickTxt : ''}`, 'core');
  });

  /* --- reativos --- */
  // Cada inimigo pesa pela ameaça ao vivo (KDA, ouro, nível, oponente de rota).
  const laneOpponentName = (state.laneOpponent && state.laneOpponent.champion) || (build && build.matchup && build.matchup.vs) || null;
  const t = rankThreats(enemies, { dd, laneOpponentName, myLevel: me.level }).map((x) => ({ ...x, d: damageProfile(x.e, flags) }));
  const wSum = t.reduce((s, x) => s + x.w, 0) || 1;
  const adShare = t.reduce((s, x) => s + x.w * x.d.ad, 0) / wSum;
  const apShare = t.reduce((s, x) => s + x.w * x.d.ap, 0) / wSum;
  const biggest = t[0];
  const factor = early ? 0.75 : 1;
  const react = (need, score, reason) => {
    const id = firstAvailable(reactive[need][cls], dd, ownedSet);
    const alreadyHas = (reactive[need][cls] || []).some((x) => ownedSet.has(x));
    if (id && !alreadyHas) add(id, Math.round(score * factor), reason, need);
  };

  // Estado da rota (doc de heurísticas, seção B): ganhando acelera dano, perdendo compra defesa antes do 1º item.
  const gold = goldCompare(state, dd);
  const myLane = gold && gold.lanes.find((l) => l.ally && l.ally.me);
  const laneDiff = myLane && myLane.enemy ? myLane.diff : 0;
  const sc = me.scores || { kills: 0, deaths: 0 };
  const laneState = laneDiff >= 1500 || sc.kills - sc.deaths >= 3 ? 'winning'
    : laneDiff <= -1000 || sc.deaths - sc.kills >= 2 ? 'losing' : 'neutral';
  const defFactor = laneState === 'winning' ? 0.85 : 1;
  if (laneState === 'winning') {
    for (const [id, c] of cands) if (c.tag === 'core') cands.set(id, { ...c, score: c.score + 6, reason: `${c.reason} · rota ganha: acelere o dano` });
  }
  const legendaries = owned.filter((id) => ((dd.item(id) || {}).gold || {}).total >= 2200).length;
  const opp = t.find((x) => x.lane);
  if (laneState === 'losing' && legendaries === 0 && owned.length >= 1) {
    const kind = opp ? (opp.d.ad >= 0.6 ? 'ad' : opp.d.ap >= 0.6 ? 'ap' : 'mixed') : adShare >= apShare ? 'ad' : 'ap';
    const id = firstAvailable(reactive.defComponent[kind], dd, ownedSet);
    const diffTxt = laneDiff < 0 ? ` (${(laneDiff / 1000).toFixed(1)}k)` : '';
    if (id) add(id, 74, `Perdendo a rota${diffTxt}${opp ? ` para ${opp.e.champion}` : ''}: componente defensivo antes de fechar o 1º item`, 'defensive');
  }

  // Anti-cura: curandeiros nativos ou 2+ inimigos com roubo de vida. Começa pelo componente de 800 g.
  const healers = t.filter((x) => flags.healers.includes(x.e.championId));
  // Roubo de vida só conta com item LENDÁRIO de cura (ex.: Sedenta por Sangue); Lâmina de Doran e afins não.
  const healIds = new Set((reactive.lifestealItems && reactive.lifestealItems.ids) || []);
  const healItem = (e) => (e.items || []).map((i) => ({ ...i, meta: dd.item(i.id) })).find((i) => healIds.has(Number(i.id)) && i.meta);
  const lifesteal = t.filter((x) => !flags.healers.includes(x.e.championId) && healItem(x.e));
  if (healers.length || lifesteal.length >= 2) {
    const all = [...healers, ...(lifesteal.length >= 2 ? lifesteal : [])];
    const hw = all.reduce((s, x) => s + x.w, 0);
    const why = all.map((x) => (healers.includes(x) ? x.e.champion : `${x.e.champion} (${healItem(x.e).meta.name})`)).slice(0, 3).join(', ');
    react('antiheal', Math.min(92, (healers.length ? 62 : 54) + hw * 12), `Anti-cura contra ${why} · o componente de 800 g já resolve`);
  }

  // Burst AP explosivo vivo (Veigar, Syndra, Fizz, LeBlanc…): Zhonya / Malmortius / Bordo da Noite.
  const bursts = t.filter((x) => (flags.burst || []).includes(x.e.championId) && (x.fed || x.lane || x.w >= 1.15));
  if (bursts.length) {
    // Véu da Banshee (mago) bloqueia a habilidade de abertura/ult do assassino; Zhonya é a alternativa.
    // Antes do 1º item lendário fica abaixo do core: completar o item principal ainda vem primeiro.
    const lane = bursts.find((x) => x.lane);
    const early = legendaries === 0;
    const score = (60 + Math.min(25, bursts.reduce((s, x) => s + x.w, 0) * 10) + (lane ? 8 : 0)) * (early ? 0.8 : 1);
    // o assassino mais perigoso define a resposta: AD (Zed, Talon…) -> Zhonya / Bordo; AP (Fizz, LeBlanc…) -> Banshee / Malmortius
    const main = [...bursts].sort((a, b) => (b.lane ? 1 : 0) - (a.lane ? 1 : 0) || b.w - a.w)[0];
    const adBurst = main.d.ad >= 0.6;
    const names = who(bursts, (x) => x.w);
    const zedTip = main.e.championId === 'Zed' && cls === 'ap' ? `Zhonya na marca do ult de Zed: anula o combo` : null;
    react(adBurst ? 'antiburstAd' : 'antiburst', score + (adBurst ? 4 : 0),
      zedTip || (adBurst ? `Cancela o combo de ${names}` : cls === 'ap' ? `Escudo de feitiço contra o combo de ${names}` : `Cancela o combo de ${names}`));
  }

  // Um inimigo fed (ou o oponente de rota ganhando) puxa a defesa contra o dano dele, mesmo se o time for misto.
  const carryAp = biggest && (biggest.fed || biggest.lane) && biggest.d.ap >= 0.7 ? biggest : null;
  const carryAd = biggest && (biggest.fed || biggest.lane) && biggest.d.ad >= 0.7 ? biggest : null;
  const carryBoost = (c) => (c ? Math.min(24, (c.w - 1) * 30 + (c.lane ? 6 : 0)) : 0);

  const adCount = t.filter((x) => x.d.ad >= 0.6).length;
  const apCount = t.filter((x) => x.d.ap >= 0.6).length;
  const monoAD = adCount >= 4 || (t.length >= 4 && apCount === 0);
  const monoAP = apCount >= 4;
  if (apShare >= 0.55 || monoAP || (carryAp && carryAp.fed)) {
    const foco = who(t, (x) => x.w * x.d.ap);
    react('mr', (52 + Math.max(0, apShare - 0.55) * 90 + carryBoost(carryAp) + (monoAP ? 14 : 0)) * defFactor,
      carryAp && carryAp.fed ? `Resistência mágica: ${foco} está fed` : monoAP ? `Time inimigo com ${apCount} campeões AP: RM é prioridade` : `Resistência mágica: dano inimigo mais AP · foco: ${foco}`);
  }
  if (adShare >= 0.55 || monoAD || (carryAd && carryAd.fed)) {
    const foco = who(t, (x) => x.w * x.d.ad);
    react('armor', (52 + Math.max(0, adShare - 0.55) * 90 + carryBoost(carryAd) + (monoAD ? 14 : 0)) * defFactor,
      carryAd && carryAd.fed ? `Armadura: ${foco} está fed` : monoAD ? `Time inimigo quase todo AD (${adCount}): armadura é prioridade` : `Armadura: dano inimigo mais AD · foco: ${foco}`);
  }
  if (!hasBoots && owned.length >= 1) {
    const b = chooseBoots({ me, t, apShare, adShare, build, dd, ownedSet, flags, laneOpponentName, cls });
    if (b) {
      // Timing: botas entram depois do 1º item (ou ~8 min) e sobem se você já tem a bota básica.
      const due = legendaries >= 1 || state.gameTime >= 480;
      const bonus = (due ? 18 : 0) + (hasBasicBoots ? 10 : 0);
      add(b.id, b.score + bonus, `${b.reason}${hasBasicBoots ? ' · você já tem a bota básica' : due ? ' · hora de fechar a bota' : ''}`, 'boots');
    }
  }

  const tanks = enemies.filter((e) => e.tags[0] === 'Tank' || e.items.filter((i) => i.tags.includes('Armor') || i.tags.includes('SpellBlock')).length >= 2);
  if (tanks.length >= 2 && me.items.length >= 2) {
    const names = tanks.slice(0, 2).map((e) => e.champion).join(', ');
    react('antitank', 58 + tanks.length * 5, `Dano por % de vida contra ${names}`);
    if (me.items.length >= 3) react('pen', 54 + tanks.length * 5, `Penetração contra ${names}`);
  }

  // botas: se já tem botas, descarta sugestão de botas de outra categoria repetida
  if (hasBoots) for (const [id, c] of [...cands]) if (c.tag === 'boots') cands.delete(id);

  const items = [...cands.entries()]
    .map(([id, c]) => {
      const it = dd.item(id);
      const used = [];
      const missing = missingGold(dd, id, owned, used);
      const afford = missing !== null && me.gold >= missing ? 8 : 0;
      return {
        id,
        name: it.name,
        cost: (it.gold && it.gold.total) || 0,
        missing,
        needGold: missing === null ? null : Math.max(0, missing - me.gold),
        parts: used.map((p) => (dd.item(p) || {}).name).filter(Boolean),
        canBuy: missing !== null && me.gold >= missing,
        score: Math.min(99, Math.round(c.score + afford)),
        reason: c.reason,
        tag: c.tag,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  let recall = null;
  const buyable = items.filter((i) => i.canBuy && i.cost >= 900).sort((a, b) => b.score - a.score)[0];
  if (buyable && me.gold >= 1300) {
    recall = `Você tem ${me.gold} g: volte e feche ${buyable.name}.`;
  } else if (me.gold >= 1300 && items[0]) {
    // >= 1300 g: o componente épico mais caro que cabe no bolso, rumo ao item principal
    const comp = bestComponent(dd, items[0].id, owned, me.gold);
    recall = comp
      ? `Você tem ${me.gold} g: volte e compre ${comp.name} (${comp.cost} g) rumo a ${items[0].name}.`
      : `${me.gold} g parados: vale voltar à base.`;
  } else if (me.gold >= 800 && !hasBoots && state.gameTime < 900) {
    recall = `${me.gold} g: bota básica + componentes menores se for voltar.`;
  }

  const notes = [];
  if (build && build.matchup) notes.push(`Matchup vs ${build.matchup.vs}${build.matchup.used.length ? ` (${build.matchup.used.join(', ')})` : ''}`);
  if (!build) notes.push('Sem build do OP.GG para este campeão (usando só regras contra o time inimigo).');
  if (biggest && biggest.fed) notes.push(`Maior ameaça agora: ${biggest.e.champion} ${kdaText(biggest.e)}`);
  const threatsOut = t.slice(0, 3).map((x) => ({ champion: x.e.champion, kda: kdaText(x.e), w: Math.round(x.w * 100) / 100, fed: x.fed, lane: x.lane }));
  return { items, notes, cls, recall, matchup: (build && build.matchup) || null, threats: threatsOut };
}

module.exports = { buyAdvice, missingGold, classOf, isBoots };
