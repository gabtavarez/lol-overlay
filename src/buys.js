const { damageProfile } = require('./recommender');
const defaultFlags = require('../data/champion-flags.json');
const reactive = require('../data/reactive-items.json');
const { laterItems } = require('./buildPath');

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
function missingGold(dd, id, owned) {
  if (!dd.item(id)) return null;
  const pool = [...owned];
  const cost = (itemId) => {
    const it = dd.item(itemId);
    if (!it) return 0;
    let sum = it.from && it.from.length ? (it.gold && it.gold.base) || 0 : (it.gold && it.gold.total) || 0;
    for (const part of it.from || []) {
      const idx = pool.indexOf(Number(part));
      if (idx >= 0) pool.splice(idx, 1);
      else sum += cost(part);
    }
    return sum;
  };
  return cost(id);
}

function firstAvailable(ids, dd, ownedSet) {
  return (ids || []).find((id) => dd.item(id) && !ownedSet.has(id)) || null;
}

function threats(enemies, flags) {
  return enemies.map((e) => ({ e, d: damageProfile(e, flags), kd: e.scores.kills - e.scores.deaths }));
}

function top(list, key, n = 2) {
  return [...list].sort((a, b) => key(b) - key(a)).slice(0, n).map((x) => x.e.champion);
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
  if (!hasBoots && build && build.boots[0] && owned.length >= 1) {
    add(build.boots[0], 58, 'Botas do meta', 'core');
  }

  /* --- reativos --- */
  const n = enemies.length || 1;
  const t = threats(enemies, flags);
  const adShare = t.reduce((s, x) => s + x.d.ad, 0) / n;
  const apShare = t.reduce((s, x) => s + x.d.ap, 0) / n;
  const factor = early ? 0.75 : 1;
  const react = (need, score, reason) => {
    const id = firstAvailable(reactive[need][cls], dd, ownedSet);
    const alreadyHas = (reactive[need][cls] || []).some((x) => ownedSet.has(x));
    if (id && !alreadyHas) add(id, Math.round(score * factor), reason, need);
  };

  const healers = enemies.filter((e) => flags.healers.includes(e.championId));
  if (healers.length) {
    const who = healers.map((e) => e.champion).slice(0, 2).join(', ');
    react('antiheal', healers.length >= 2 ? 82 : 74, `Anti-cura contra ${who}`);
  }
  if (apShare >= 0.55) {
    const who = top(t, (x) => x.d.ap * (1 + Math.max(0, x.kd) / 5)).join(', ');
    react('mr', 52 + (apShare - 0.55) * 90, `Resistência mágica: inimigos mais AP · foco: ${who}`);
    const boot = firstAvailable(reactive.bootsMr, dd, ownedSet);
    if (boot && apShare >= 0.6) add(boot, Math.round(60 * factor), `Botas anti-AP contra ${who}`, 'boots');
  }
  if (adShare >= 0.55) {
    const who = top(t, (x) => x.d.ad * (1 + Math.max(0, x.kd) / 5)).join(', ');
    react('armor', 52 + (adShare - 0.55) * 90, `Armadura: inimigos mais AD · foco: ${who}`);
    const boot = firstAvailable(reactive.bootsArmor, dd, ownedSet);
    if (boot && adShare >= 0.6) add(boot, Math.round(60 * factor), `Botas anti-AD contra ${who}`, 'boots');
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
      const missing = missingGold(dd, id, owned);
      const afford = missing !== null && me.gold >= missing ? 8 : 0;
      return {
        id,
        name: it.name,
        cost: (it.gold && it.gold.total) || 0,
        missing,
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
  return { items, notes, cls, recall, matchup: (build && build.matchup) || null };
}

module.exports = { buyAdvice, missingGold, classOf };
