const { damageProfile } = require('./recommender');
const defaultFlags = require('../data/champion-flags.json');
const reactive = require('../data/reactive-items.json');
const { laterItems } = require('./buildPath');
const { rankThreats, kdaText } = require('./threat');

const BOOT_TAG = 'Boots';

function classOf(me, build) {
  if (build && build.damageType === 'AP') return 'ap';
  if (me.tags.includes('Marksman')) return 'adc';
  if (me.tags[0] === 'Tank') return 'tank';
  return 'ad';
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
function chooseBoots({ me, t, apShare, adShare, build, dd, ownedSet, flags, laneOpponentName }) {
  const meta = build && build.boots && build.boots.find((id) => dd.item(id));
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

  /* --- caminho do meta --- */
  const hasBoots = owned.some((id) => (dd.item(id) || { tags: [] }).tags.includes(BOOT_TAG));
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

  const healers = t.filter((x) => flags.healers.includes(x.e.championId));
  if (healers.length) {
    const hw = healers.reduce((s, x) => s + x.w, 0);
    react('antiheal', Math.min(92, 62 + hw * 12), `Anti-cura contra ${who(healers, (x) => x.w)}`);
  }

  // Um inimigo fed (ou o oponente de rota ganhando) puxa a defesa contra o dano dele, mesmo se o time for misto.
  const carryAp = biggest && (biggest.fed || biggest.lane) && biggest.d.ap >= 0.7 ? biggest : null;
  const carryAd = biggest && (biggest.fed || biggest.lane) && biggest.d.ad >= 0.7 ? biggest : null;
  const carryBoost = (c) => (c ? Math.min(24, (c.w - 1) * 30 + (c.lane ? 6 : 0)) : 0);

  if (apShare >= 0.55 || (carryAp && carryAp.fed)) {
    const foco = who(t, (x) => x.w * x.d.ap);
    react('mr', 52 + Math.max(0, apShare - 0.55) * 90 + carryBoost(carryAp),
      carryAp && carryAp.fed ? `Resistência mágica: ${foco} está fed` : `Resistência mágica: dano inimigo mais AP · foco: ${foco}`);
  }
  if (adShare >= 0.55 || (carryAd && carryAd.fed)) {
    const foco = who(t, (x) => x.w * x.d.ad);
    react('armor', 52 + Math.max(0, adShare - 0.55) * 90 + carryBoost(carryAd),
      carryAd && carryAd.fed ? `Armadura: ${foco} está fed` : `Armadura: dano inimigo mais AD · foco: ${foco}`);
  }
  if (!hasBoots && owned.length >= 1) {
    const b = chooseBoots({ me, t, apShare, adShare, build, dd, ownedSet, flags, laneOpponentName });
    if (b) add(b.id, b.score, b.reason, 'boots');
  }

  const tanks = enemies.filter((e) => e.tags[0] === 'Tank' || e.items.filter((i) => i.tags.includes('Armor') || i.tags.includes('SpellBlock')).length >= 2);
  if (tanks.length >= 2 && me.items.length >= 3) {
    react('pen', 54 + tanks.length * 5, `Penetração contra ${tanks.slice(0, 2).map((e) => e.champion).join(', ')}`);
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
  } else if (me.gold >= 2500) {
    recall = `${me.gold} g parados: vale voltar à base.`;
  }

  const notes = [];
  if (build && build.matchup) notes.push(`Matchup vs ${build.matchup.vs}${build.matchup.used.length ? ` (${build.matchup.used.join(', ')})` : ''}`);
  if (!build) notes.push('Sem build do OP.GG para este campeão (usando só regras contra o time inimigo).');
  if (biggest && biggest.fed) notes.push(`Maior ameaça agora: ${biggest.e.champion} ${kdaText(biggest.e)}`);
  const threatsOut = t.slice(0, 3).map((x) => ({ champion: x.e.champion, kda: kdaText(x.e), w: Math.round(x.w * 100) / 100, fed: x.fed, lane: x.lane }));
  return { items, notes, cls, recall, matchup: (build && build.matchup) || null, threats: threatsOut };
}

module.exports = { buyAdvice, missingGold, classOf };
