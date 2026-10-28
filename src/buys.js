const { damageProfile } = require('./recommender');
const defaultFlags = require('../data/champion-flags.json');
const { t: tr } = require('./i18n');
const reactive = require('../data/reactive-items.json');
const { laterItems } = require('./buildPath');
const { rankThreats, kdaText } = require('./threat');
const { goldCompare } = require('./goldDiff');

const BOOT_TAG = 'Boots';

/**
 * Classe do seu campeão para escolher os itens reativos: ap | adc | ad | tank | support.
 * Sem build do OP.GG (ou build híbrida), decide pelas tags do campeão — antes disso um mago sem build caía em "ad".
 */
function classOf(me, build, flags = defaultFlags, role = '') {
  const tags = me.tags || [];
  const id = me.championId || me.id;
  if (String(role).toLowerCase() === 'utility' && (flags.enchanters || []).includes(id)) return 'support';
  if (build && build.damageType === 'AP') return 'ap';
  const apChamp = (flags.apOverrides || []).includes(id) || tags[0] === 'Mage' || (tags.includes('Mage') && !tags.includes('Fighter') && !tags.includes('Marksman'));
  if (tags.includes('Marksman') && !(flags.apOverrides || []).includes(id)) return 'adc';
  if (tags[0] === 'Tank') return 'tank';
  if ((!build || !build.damageType || build.damageType === 'BOTH') && apChamp) return 'ap';
  // assassino AD (Zed, Talon, Qiyana, Kha'Zix…) defende diferente de lutador (Darius, Sett…)
  if (tags[0] === 'Assassin') return 'assassin';
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
const DEFAULT_BOOTS = { ap: [3020], adc: [3006], ad: [3047, 3111], assassin: [3158, 3047], tank: [3047, 3111], support: [3158, 3020] };

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
    return { id: mercs, score: losing ? 70 : 64, reason: tr('Muito controle de grupo ({champs}): tenacidade', { champs: names(cc) }) };
  }
  if (opp && !losing) {
    if ((flags.autoAttackers || []).includes(opp.e.championId) && steel) return { id: steel, score: 63, reason: tr('{champ} vive de ataque básico: Aço', { champ: opp.e.champion }) };
    if (opp.d.ap >= 0.6 && (flags.hardCc || []).includes(opp.e.championId) && mercs) return { id: mercs, score: 63, reason: tr('{champ} (AP com controle de grupo): Mercúrio', { champ: opp.e.champion }) };
  }
  if (losing && opp) {
    const vs = `${opp.e.champion} ${opp.e.scores.kills}/${opp.e.scores.deaths}/${opp.e.scores.assists}`;
    if (opp.d.ap >= 0.6 && mercs) return { id: mercs, score: 68, reason: tr('Perdendo a rota para {vs}: bota defensiva', { vs }) };
    if (opp.d.ad >= 0.6 && steel) return { id: steel, score: 68, reason: tr('Perdendo a rota para {vs}: bota defensiva', { vs }) };
  }
  if (adShare >= 0.65 && steel) return { id: steel, score: 62, reason: tr('Time inimigo quase todo AD: armadura na bota') };
  if (apShare >= 0.65 && mercs) return { id: mercs, score: 62, reason: tr('Time inimigo quase todo AP: RM na bota') };
  if (meta) return { id: meta, score: losing ? 52 : 60, reason: losing ? tr('Bota do meta') : tr('Rota sob controle: bota ofensiva do meta') };
  return null;
}

/**
 * Próximas compras: 3 itens com motivo. Mistura o caminho do meta (build do OP.GG
 * para o seu campeão e rota) com itens reativos contra o time inimigo.
 */
const isMr = (id) => [].concat(reactive.bootsMr || []).includes(id);
const isSteel = (id) => [].concat(reactive.bootsArmor || []).includes(id);

/** Rótulo "Bom contra" (estilo LoLTheory) a partir do motivo do item. */
const GOOD = {
  antishield: { key: 'shield', label: 'Escudos' },
  anticrit: { key: 'ad', label: 'Crítico' },
  antiheal: { key: 'heal', label: 'Cura' },
  antiburst: { key: 'burst', label: 'Burst mágico' },
  antiburstAd: { key: 'burst', label: 'Assassinos' },
  mr: { key: 'ap', label: 'Dano mágico' },
  armor: { key: 'ad', label: 'Dano físico' },
  antitank: { key: 'tank', label: 'Tanques' },
  pen: { key: 'tank', label: 'Armadura e RM' },
};
function goodAgainst(tag, id) {
  if (tag === 'defensive') return { key: 'lane', label: 'Pressão na rota' };
  if (tag === 'boots') {
    if (isMr(id)) return { key: 'ap', label: 'Dano mágico e CC' };
    if (isSteel(id)) return { key: 'ad', label: 'Ataques básicos' };
    return null;
  }
  return GOOD[tag] || null;
}

/* ---------- leitura dos itens do inimigo ---------- */

const statsOf = (dd, id) => ((dd.item(id) || {}).stats) || {};
const goldOf = (dd, id) => (((dd.item(id) || {}).gold) || {}).total || 0;

/**
 * Tipo de dano pelo que o inimigo realmente comprou (Kai'Sa AP, Ezreal AP, Shaco AP…):
 * com itens de dano suficientes, os itens pesam 65% e o campeão 35%.
 */
function liveProfile(e, dd, flags) {
  const base = damageProfile(e, flags);
  let ap = 0;
  let ad = 0;
  for (const it of e.items || []) {
    const st = statsOf(dd, it.id);
    ap += st.FlatMagicDamageMod || 0;
    ad += (st.FlatPhysicalDamageMod || 0) + (st.FlatCritChanceMod || 0) * 50 + (st.PercentAttackSpeedMod || 0) * 40;
  }
  if (ap + ad < 60) return base;
  const share = ad / (ad + ap);
  const out = { ad: 0.35 * base.ad + 0.65 * share, ap: 0.35 * base.ap + 0.65 * (1 - share) };
  if (base.ad >= 0.6 && out.ap >= 0.55) out.offbuild = 'AP';
  else if (base.ap >= 0.6 && out.ad >= 0.55) out.offbuild = 'AD';
  return out;
}

/** Armadura e RM vindas de itens (o que a sua penetração precisa vencer). */
function itemResists(e, dd) {
  let armor = 0;
  let mr = 0;
  for (const it of e.items || []) {
    const st = statsOf(dd, it.id);
    armor += st.FlatArmorMod || 0;
    mr += st.FlatSpellBlockMod || 0;
  }
  return { armor, mr };
}

/** Itens de crítico do inimigo (para Presságio de Randuin). */
const critItems = (e, dd) => (e.items || []).filter((it) => (statsOf(dd, it.id).FlatCritChanceMod || 0) > 0 && goldOf(dd, it.id) >= 1000).length;

/** Fontes de escudo: kit do campeão + itens cuja descrição fala de escudo. */
function shieldSources(e, dd, flags) {
  const out = [];
  if ((flags.shielders || []).includes(e.championId)) out.push(e.champion);
  for (const it of e.items || []) {
    const meta = dd.item(it.id) || {};
    if (goldOf(dd, it.id) >= 2000 && /escudo|shield/i.test(meta.description || '') && !/reduz.*escudo|anti-?escudo|shield reaver|ceifa/i.test(meta.description || '')) out.push(meta.name || it.name);
  }
  return out;
}

function buyAdvice({ state, build, dd, flags = defaultFlags }) {
  if (!dd || !state || !state.me) return { items: [], notes: [tr('Aguardando dados do jogo…')] };
  const me = state.me;
  const enemies = state.enemies || [];
  const owned = ownedIds(me);
  const ownedSet = new Set(owned);
  const cls = classOf(me, build, flags, state.myRole || me.position || '');
  const early = state.gameTime < 600;
  const cands = new Map(); // id -> { score, reason, tag }

  // Mesmo item pedido por duas regras: fica a maior nota, mas o motivo reativo (contra quem) vence
  // o "Build do meta" — senão a resposta ao inimigo fed some atrás do caminho padrão.
  const REACTIVE_OVER = (t) => t && !['core', 'starter'].includes(t);
  const add = (id, score, reason, tag, vs = []) => {
    if (!id || ownedSet.has(id) || !dd.item(id)) return;
    const prev = cands.get(id);
    if (!prev) { cands.set(id, { score, reason, tag, vs }); return; }
    const best = Math.max(score, prev.score);
    if (REACTIVE_OVER(tag) && !REACTIVE_OVER(prev.tag)) cands.set(id, { score: best + 4, reason: `${reason}${tr(' · também na build do meta')}`, tag, vs });
    else if (REACTIVE_OVER(prev.tag) && !REACTIVE_OVER(tag)) cands.set(id, { ...prev, score: Math.max(prev.score, score + 4), reason: prev.reason.includes(tr(' · também na build do meta')) ? prev.reason : `${prev.reason}${tr(' · também na build do meta')}` });
    else if (REACTIVE_OVER(tag) && REACTIVE_OVER(prev.tag) && tag !== prev.tag) {
      // duas respostas no mesmo item (ex.: Randuin = armadura + anti-crítico): junta os motivos
      const [win, lose] = score > prev.score ? [{ score, reason, tag, vs }, prev] : [prev, { score, reason, tag, vs }];
      cands.set(id, { ...win, score: best + 3, reason: `${win.reason} · ${lose.reason}`, vs: [...new Set([...(win.vs || []), ...(lose.vs || [])])].slice(0, 4) });
    } else if (score > prev.score) cands.set(id, { score, reason, tag, vs });
  };
  const ids = (list) => list.map((x) => x.e.championId).filter(Boolean).slice(0, 4);

  /* --- item inicial (começo da partida, inventário vazio) --- */
  if (!owned.length) {
    const role = state.myRole || '';
    const fallback = reactive.starters[role === 'jungle' || role === 'utility' ? role : cls] || [];
    const starter = (build && build.starter && build.starter.length ? build.starter : fallback).filter((id) => dd.item(id));
    const counts = new Map();
    for (const id of starter) counts.set(id, (counts.get(id) || 0) + 1);
    [...counts].forEach(([id, n], i) => add(id, 97 - i * 2, `${build && build.starter && build.starter.length ? tr('Item inicial do meta') : tr('Item inicial')}${n > 1 ? ` · ${tr('compre {n}', { n })}` : ''}`, 'starter'));
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
  const pickTxt = build && build.corePick ? ` · ${tr('{p}% dos jogadores', { p: Math.round(build.corePick * 100) })}` : '';
  pathLeft.slice(0, 3).forEach((id, i) => {
    add(id, 72 - i * 14, `${tr('Build do meta')}${i === 0 ? pickTxt : ''}`, 'core');
  });

  /* --- reativos --- */
  // Cada inimigo pesa pela ameaça ao vivo (KDA, ouro, nível, oponente de rota).
  const laneOpponentName = (state.laneOpponent && state.laneOpponent.champion) || (build && build.matchup && build.matchup.vs) || null;
  const t = rankThreats(enemies, { dd, laneOpponentName, myLevel: me.level }).map((x) => ({ ...x, d: liveProfile(x.e, dd, flags) }));
  const wSum = t.reduce((s, x) => s + x.w, 0) || 1;
  const adShare = t.reduce((s, x) => s + x.w * x.d.ad, 0) / wSum;
  const apShare = t.reduce((s, x) => s + x.w * x.d.ap, 0) / wSum;
  const biggest = t[0];
  const factor = early ? 0.75 : 1;
  const react = (need, score, reason, vs = []) => {
    const list = (reactive[need] || {})[cls] || [];
    const id = firstAvailable(list, dd, ownedSet);
    const alreadyHas = list.some((x) => ownedSet.has(x));
    if (id && !alreadyHas) add(id, Math.round(score * factor), reason, need, vs);
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
    for (const [id, c] of cands) if (c.tag === 'core') cands.set(id, { ...c, score: c.score + 6, reason: `${c.reason}${tr(' · rota ganha: acelere o dano')}` });
  }
  const legendaries = owned.filter((id) => ((dd.item(id) || {}).gold || {}).total >= 2200).length;
  const opp = t.find((x) => x.lane);
  if (laneState === 'losing' && legendaries === 0 && owned.length >= 1) {
    const kind = opp ? (opp.d.ad >= 0.6 ? 'ad' : opp.d.ap >= 0.6 ? 'ap' : 'mixed') : adShare >= apShare ? 'ad' : 'ap';
    const id = firstAvailable(reactive.defComponent[kind], dd, ownedSet);
    const diffTxt = laneDiff < 0 ? ` (${(laneDiff / 1000).toFixed(1)}k)` : '';
    if (id) add(id, 74, opp ? tr('Perdendo a rota{diff} para {champ}: componente defensivo antes de fechar o 1º item', { diff: diffTxt, champ: opp.e.champion }) : tr('Perdendo a rota{diff}: componente defensivo antes de fechar o 1º item', { diff: diffTxt }), 'defensive', opp ? ids([opp]) : []);
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
    react('antiheal', Math.min(92, (healers.length ? 62 : 54) + hw * 12), tr('Anti-cura contra {champs} · o componente de 800 g já resolve', { champs: why }), ids(all));
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
    const zedTip = main.e.championId === 'Zed' && cls === 'ap' ? tr('Zhonya na marca do ult de Zed: anula o combo') : null;
    react(adBurst ? 'antiburstAd' : 'antiburst', score + (adBurst ? 4 : 0),
      zedTip || (adBurst ? tr('Cancela o combo de {champs}', { champs: names }) : cls === 'ap' ? tr('Escudo de feitiço contra o combo de {champs}', { champs: names }) : tr('Cancela o combo de {champs}', { champs: names })), ids(bursts));
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
    // rota ganha alivia a defesa, mas não contra um inimigo fed
    react('mr', (52 + Math.max(0, apShare - 0.55) * 90 + carryBoost(carryAp) + (monoAP ? 14 : 0)) * (carryAp && carryAp.fed ? 1 : defFactor),
      carryAp && carryAp.fed ? tr('Resistência mágica: {champ} está fed', { champ: foco }) : monoAP ? tr('Time inimigo com {n} campeões AP: RM é prioridade', { n: apCount }) : tr('Resistência mágica: dano inimigo mais AP · foco: {champs}', { champs: foco }),
      ids([...t].filter((x) => x.d.ap >= 0.5).sort((a, b) => b.w * b.d.ap - a.w * a.d.ap)));
  }
  if (adShare >= 0.55 || monoAD || (carryAd && carryAd.fed)) {
    const foco = who(t, (x) => x.w * x.d.ad);
    react('armor', (52 + Math.max(0, adShare - 0.55) * 90 + carryBoost(carryAd) + (monoAD ? 14 : 0)) * (carryAd && carryAd.fed ? 1 : defFactor),
      carryAd && carryAd.fed ? tr('Armadura: {champ} está fed', { champ: foco }) : monoAD ? tr('Time inimigo quase todo AD ({n}): armadura é prioridade', { n: adCount }) : tr('Armadura: dano inimigo mais AD · foco: {champs}', { champs: foco }),
      ids([...t].filter((x) => x.d.ad >= 0.5).sort((a, b) => b.w * b.d.ad - a.w * a.d.ad)));
  }
  if (!hasBoots && owned.length >= 1) {
    const b = chooseBoots({ me, t, apShare, adShare, build, dd, ownedSet, flags, laneOpponentName, cls });
    if (b) {
      // Timing: botas entram depois do 1º item (ou ~8 min) e sobem se você já tem a bota básica.
      const due = legendaries >= 1 || state.gameTime >= 480;
      const bonus = (due ? 18 : 0) + (hasBasicBoots ? 10 : 0);
      const bootVs = isMr(b.id) ? ids(t.filter((x) => x.d.ap >= 0.5 || (flags.hardCc || []).includes(x.e.championId)))
        : isSteel(b.id) ? ids(t.filter((x) => x.d.ad >= 0.5)) : [];
      add(b.id, b.score + bonus, `${b.reason}${hasBasicBoots ? tr(' · você já tem a bota básica') : due ? tr(' · hora de fechar a bota') : ''}`, 'boots', bootVs);
    }
  }

  // Tanque = campeão tanque de fato, ou alguém que empilhou MUITA resistência em itens. Lutador/assassino com
  // 2 itens híbridos (Dança da Morte, Mandíbula…) não é tanque: ~80 de resistência não justifica % de vida.
  const isTanky = (e) => {
    const r = itemResists(e, dd);
    const heavy = (e.items || []).filter((i) => { const st = statsOf(dd, i.id); return (st.FlatArmorMod || 0) + (st.FlatSpellBlockMod || 0) >= 40; }).length;
    return r.armor + r.mr >= 150 && heavy >= 3;
  };
  const tanks = enemies.filter((e) => e.tags[0] === 'Tank' || isTanky(e));
  if (tanks.length >= 2 && me.items.length >= 2) {
    const names = tanks.slice(0, 2).map((e) => e.champion).join(', ');
    const tv = tanks.map((e) => e.championId).filter(Boolean).slice(0, 4);
    react('antitank', 58 + tanks.length * 5, tr('Dano por % de vida contra {champs}', { champs: names }), tv);
  }

  // Penetração pela defesa que os inimigos realmente compraram: AD olha armadura, AP olha RM.
  const myAp = cls === 'ap';
  const resist = enemies.map((e) => ({ e, r: itemResists(e, dd)[myAp ? 'mr' : 'armor'] })).filter((x) => x.r >= 40).sort((a, b) => b.r - a.r);
  const stack = resist.reduce((sum, x) => sum + x.r, 0);
  if (me.items.length >= 2 && (resist.length >= 2 || stack >= 110 || tanks.length >= 2)) {
    const list = resist.length ? resist : tanks.map((e) => ({ e, r: 0 }));
    const names = list.slice(0, 2).map((x) => (x.r ? `${x.e.champion} (+${Math.round(x.r)} ${myAp ? tr('RM') : tr('armadura')})` : x.e.champion)).join(', ');
    react('pen', 54 + Math.min(30, stack / 8) + tanks.length * 3, (myAp ? tr('Penetração mágica contra {champs}', { champs: names }) : tr('Penetração de armadura contra {champs}', { champs: names })), list.map((x) => x.e.championId).filter(Boolean).slice(0, 4));
  }

  // Escudos: 3+ fontes (kits como Lulu/Sett e itens de escudo) -> Presa da Serpente para AD.
  if (cls === 'ad' || cls === 'adc' || cls === 'assassin') {
    const src = enemies.map((e) => ({ e, s: shieldSources(e, dd, flags) })).filter((x) => x.s.length);
    const n = src.reduce((sum, x) => sum + x.s.length, 0);
    if (n >= 3 && me.items.length >= 1) {
      react('antishield', 50 + n * 6, tr('Muitos escudos: {list}', { list: src.flatMap((x) => x.s).slice(0, 3).join(', ') }), src.map((x) => x.e.championId).filter(Boolean).slice(0, 4));
    }
  }

  // Crítico: carry inimigo com 2+ itens de crítico -> Presságio de Randuin (tanque/lutador).
  if (cls === 'tank' || (cls === 'ad' && (me.tags || []).includes('Fighter'))) {
    const crit = enemies.map((e) => ({ e, n: critItems(e, dd) })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n);
    if (crit.length) {
      const w = (t.find((x) => x.e === crit[0].e) || { w: 1 }).w;
      react('anticrit', 52 + crit[0].n * 7 + Math.min(15, (w - 1) * 25), tr('{champ} com {n} itens de crítico: reduz o dano de crítico', { champ: crit[0].e.champion, n: crit[0].n }), crit.map((x) => x.e.championId).filter(Boolean).slice(0, 3));
    }
  }

  // botas: se já tem botas, descarta sugestão de botas de outra categoria repetida
  if (hasBoots) for (const [id, c] of [...cands]) if (c.tag === 'boots') cands.delete(id);

  /* --- 1º item lendário primeiro: sem ninguém fed e sem perder a rota, defesa completa espera o item principal --- */
  const firstCore = pathLeft[0];
  const urgent = t.some((x) => x.fed) || laneState === 'losing' || monoAD || monoAP; // time todo de um tipo de dano também justifica
  if (legendaries === 0 && firstCore && cands.has(firstCore) && !urgent) {
    const DEF_TAGS = ['armor', 'mr', 'antiburst', 'antiburstAd', 'anticrit', 'antishield'];
    const top = cands.get(firstCore);
    for (const [id, c] of [...cands]) {
      if (id === firstCore || !DEF_TAGS.includes(c.tag)) continue;
      if (((dd.item(id) || {}).gold || {}).total < 2200) continue; // componente barato pode vir antes
      if (c.score >= top.score - 3) cands.set(id, { ...c, score: top.score - 6, reason: `${c.reason}${tr(' · depois do 1º item')}` });
    }
    cands.set(firstCore, { ...top, reason: top.tag === 'core' && top.reason.startsWith(tr('Build do meta')) ? top.reason.replace(tr('Build do meta'), tr('Build do meta · 1º item')) : top.reason });
  }

  /* --- defesa que já cobre: se você já tem o item defensivo e a ameaça daquele tipo está atrás, priorize dano --- */
  const DEF = {
    ad: new Set(['armor', 'antiburstAd', 'anticrit'].flatMap((n) => (reactive[n] || {})[cls] || [])),
    ap: new Set(['mr', 'antiburst'].flatMap((n) => (reactive[n] || {})[cls] || [])),
  };
  const threatOf = (kind) => t.filter((x) => (kind === 'ad' ? x.d.ad : x.d.ap) >= 0.55);
  const covered = [];
  for (const kind of ['ad', 'ap']) {
    const held = owned.find((id) => DEF[kind].has(id));
    if (!held) continue;
    const foes = threatOf(kind);
    const danger = foes.some((x) => x.fed || (x.lane && x.e.scores.kills - x.e.scores.deaths >= 2));
    const share = kind === 'ad' ? adShare : apShare;
    if (!danger && share < 0.6) covered.push({ kind, held, foes, share });
  }
  for (const c of covered) {
    const tags = c.kind === 'ad' ? ['armor', 'antiburstAd', 'anticrit'] : ['mr', 'antiburst'];
    for (const [id, cand] of [...cands]) if (tags.includes(cand.tag)) cands.set(id, { ...cand, score: cand.score - 15 });
    for (const [id, cand] of [...cands]) {
      if (cand.tag === 'core') cands.set(id, { ...cand, score: cand.score + 8, reason: `${cand.reason} · ${tr(c.kind === 'ad' ? '{item} já cobre o dano físico: acelere o dano' : '{item} já cobre o dano mágico: acelere o dano', { item: (dd.item(c.held) || {}).name || tr('sua defesa') })}` });
    }
  }

  /* --- inventário cheio, elixir e sentinela de controle --- */
  // slot 6 = amuleto (trinket). Seis slots ocupados: cada sugestão diz o que vender/trocar.
  const bag = (me.items || []).filter((it) => it.slot !== 6);
  const full = bag.length >= 6;
  const isConsumable = (it) => ((dd.item(it.id) || {}).tags || []).includes('Consumable');
  const valueOf = (it) => goldOf(dd, it.id);
  let sell = null;
  if (full) {
    const ranked = [...bag].sort((a, b) => (isConsumable(b) - isConsumable(a)) || valueOf(a) - valueOf(b));
    const pick = ranked.find((it) => isConsumable(it) || (!isBoots(dd, it.id) && valueOf(it) < 1300)) || ranked.find((it) => !isBoots(dd, it.id));
    if (pick) sell = { id: pick.id, name: (dd.item(pick.id) || {}).name || pick.name || 'item', cheap: isConsumable(pick) || valueOf(pick) < 1300 };
  }
  const buildDone = build && pathLeft.length === 0 && owned.length >= 5;
  if ((full || buildDone) && (me.level || 1) >= 9 && state.gameTime >= 1500) {
    const ex = firstAvailable((reactive.elixir || {})[cls], dd, new Set());
    if (ex) add(ex, full ? 58 : 48, full ? tr('Inventário cheio: elixir para a próxima luta (dura 3 min)') : tr('Build completa: elixir antes de dragão ou barão'), 'elixir');
  }
  const ward = firstAvailable(reactive.controlWard, dd, ownedSet);
  if (ward && !full && state.gameTime >= 300 && me.gold >= 75) add(ward, 34, tr('Sentinela de controle: leve uma a cada volta à base'), 'ward');
  // fim de jogo, inventário cheio e a ameaça que a defesa respondia sumiu: troque a defesa por dano
  if (full && state.gameTime >= 1500) {
    const useless = covered.find((c) => c.share < 0.35 && !c.foes.some((x) => x.fed));
    const dmg = useless && firstAvailable(((reactive.swap || {})[cls]) || [], dd, ownedSet);
    if (useless && dmg) {
      const defName = (dd.item(useless.held) || {}).name || tr('o item defensivo');
      add(dmg, 70, tr(useless.kind === 'ad' ? 'Troque {item} por este: pouco dano físico inimigo agora ({p}%)' : 'Troque {item} por este: pouco dano mágico inimigo agora ({p}%)', { item: defName, p: Math.round(useless.share * 100) }), 'swapdmg');
      sell = { id: useless.held, name: defName, cheap: false };
    }
  }
  if (full && sell) {
    for (const [id, c] of [...cands]) {
      if (['elixir'].includes(c.tag)) continue;
      if (c.tag === 'swapdmg') { cands.set(id, { ...c, swap: { id: sell.id, name: sell.name } }); continue; }
      const swap = sell.cheap ? tr('venda {item} para abrir espaço', { item: sell.name }) : tr('troque {item} por este', { item: sell.name });
      cands.set(id, { ...c, score: c.score - (sell.cheap ? 0 : 8), reason: `${c.reason} · ${swap}`, swap: { id: sell.id, name: sell.name } });
    }
  }

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
        good: goodAgainst(c.tag, id),
        vs: c.vs || [],
        swap: c.swap || null,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  let recall = null;
  const buyable = items.filter((i) => i.canBuy && i.cost >= 900).sort((a, b) => b.score - a.score)[0];
  if (buyable && me.gold >= 1300) {
    recall = tr('Você tem {g} g: volte e feche {item}.', { g: me.gold, item: buyable.name });
  } else if (me.gold >= 1300 && items[0]) {
    // >= 1300 g: o componente épico mais caro que cabe no bolso, rumo ao item principal
    const comp = bestComponent(dd, items[0].id, owned, me.gold);
    recall = comp
      ? tr('Você tem {g} g: volte e compre {item} ({cost} g) rumo a {target}.', { g: me.gold, item: comp.name, cost: comp.cost, target: items[0].name })
      : tr('{g} g parados: vale voltar à base.', { g: me.gold });
  } else if (me.gold >= 800 && !hasBoots && state.gameTime < 900) {
    recall = tr('{g} g: bota básica + componentes menores se for voltar.', { g: me.gold });
  }

  const notes = [];
  if (build && build.matchup) notes.push(`${tr('Matchup vs {champ}', { champ: build.matchup.vs })}${build.matchup.used.length ? ` (${build.matchup.used.join(', ')})` : ''}`);
  if (!build) notes.push(tr('Sem build do OP.GG para este campeão (usando só regras contra o time inimigo).'));
  if (biggest && biggest.fed) notes.push(tr('Maior ameaça agora: {champ} {kda}', { champ: biggest.e.champion, kda: kdaText(biggest.e) }));
  const off = t.filter((x) => x.d.offbuild);
  for (const c of covered) notes.push(tr(c.kind === 'ad' ? 'Você já tem {item} contra dano físico e ninguém desse tipo está fed: próximos itens de dano' : 'Você já tem {item} contra dano mágico e ninguém desse tipo está fed: próximos itens de dano', { item: (dd.item(c.held) || {}).name || tr('defesa') }));
  if (full) notes.push(sell ? tr(sell.cheap ? 'Inventário cheio: venda {item} para o próximo item' : 'Inventário cheio: troque {item} para o próximo item', { item: sell.name }) : tr('Inventário cheio'));
  if (off.length) notes.push(tr('Build fora do padrão: {list} (contado pelos itens)', { list: off.map((x) => `${x.e.champion} ${x.d.offbuild}`).join(', ') }));
  const threatsOut = t.slice(0, 3).map((x) => ({ champion: x.e.champion, kda: kdaText(x.e), w: Math.round(x.w * 100) / 100, fed: x.fed, lane: x.lane }));
  return { items, notes, cls, full, recall, matchup: (build && build.matchup) || null, threats: threatsOut };
}

module.exports = {
  goodAgainst, liveProfile, itemResists, critItems, shieldSources, buyAdvice, missingGold, classOf, isBoots };
