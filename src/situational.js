/**
 * Itens situacionais para o champ select: respostas à composição inimiga já escolhida
 * (mesmas regras do overlay em partida) + alternativas populares do OP.GG fora do caminho principal.
 */
const reactive = require('../data/reactive-items.json');
const defaultFlags = require('../data/champion-flags.json');
const { damageProfile } = require('./recommender');
const { laterItems } = require('./buildPath');

function classFor(champ, build, role = '', flags = defaultFlags) {
  const tags = (champ && champ.tags) || [];
  if (String(role).toLowerCase() === 'utility' && champ && (flags.enchanters || []).includes(champ.id)) return 'support';
  if (build && build.damageType === 'AP') return 'ap';
  if (build && build.damageType === 'AD') return tags.includes('Marksman') ? 'adc' : tags[0] === 'Tank' ? 'tank' : tags[0] === 'Assassin' ? 'assassin' : 'ad';
  if (tags.includes('Mage')) return 'ap';
  if (tags.includes('Marksman')) return 'adc';
  if (tags[0] === 'Tank') return 'tank';
  if (tags[0] === 'Assassin') return 'assassin';
  return 'ad';
}

/** enemies: [{ id, name, tags }] (campeões inimigos já escolhidos). */
function situationalItems({ champ, build, enemies = [], dd, flags = defaultFlags, limit = 8, role = '' }) {
  if (!dd || !build) return [];
  const cls = classFor(champ, build, role, flags);
  const main = new Set([...(build.core || []), ...(build.boots || []), ...laterItems(build)]);
  const out = new Map();
  const add = (ids, why, prio, good = null, vs = []) => {
    const id = (ids || []).find((x) => dd.item(x) && !main.has(x));
    if (!id) return;
    const prev = out.get(id);
    if (!prev || prio > prev.prio) out.set(id, { id, name: dd.item(id).name, why, prio, good, vs: vs.map((x) => x.id).slice(0, 4) });
  };
  const G = (key, label) => ({ key, label });
  const e = enemies.filter((x) => x && x.id).map((x) => ({ ...x, d: damageProfile({ championId: x.id, tags: x.tags || [] }, flags) }));
  const names = (list) => list.slice(0, 3).map((x) => x.name).join(', ');
  if (e.length) {
    const ad = e.filter((x) => x.d.ad >= 0.6);
    const ap = e.filter((x) => x.d.ap >= 0.6);
    const healers = e.filter((x) => flags.healers.includes(x.id));
    const burstAd = e.filter((x) => (flags.burst || []).includes(x.id) && x.d.ad >= 0.6);
    const burstAp = e.filter((x) => (flags.burst || []).includes(x.id) && x.d.ap >= 0.6);
    const tanks = e.filter((x) => (x.tags || [])[0] === 'Tank');
    const cc = e.filter((x) => (flags.hardCc || []).includes(x.id));
    if (healers.length) add(reactive.antiheal[cls], `Anti-cura contra ${names(healers)}`, 90, G('heal', 'Cura'), healers);
    if (burstAd.length) add(reactive.antiburstAd[cls], `Contra o combo de ${names(burstAd)}`, 85, G('burst', 'Assassinos'), burstAd);
    if (burstAp.length) add(reactive.antiburst[cls], `Contra o combo de ${names(burstAp)}`, 84, G('burst', 'Burst mágico'), burstAp);
    if (ad.length >= 3) add(reactive.armor[cls], `${ad.length} inimigos de dano físico`, 70 + ad.length * 3, G('ad', 'Dano físico'), ad);
    if (ap.length >= 3) add(reactive.mr[cls], `${ap.length} inimigos de dano mágico`, 70 + ap.length * 3, G('ap', 'Dano mágico'), ap);
    if (tanks.length >= 2) { add(reactive.antitank[cls], `Contra tanques: ${names(tanks)}`, 75, G('tank', 'Tanques'), tanks); add(reactive.pen[cls], `Penetração contra ${names(tanks)}`, 65, G('tank', 'Armadura e RM'), tanks); }
    if (cls === 'support' && cc.length >= 2) add((reactive.anticc || {}).support, `Bênção de Mikael: tira o controle de grupo do seu carry (${names(cc)})`, 74, G('cc', 'Controle de grupo'), cc);
    if (cc.length >= 3) add(reactive.bootsMr, `Muito controle de grupo: ${names(cc)}`, 72, G('ap', 'Controle de grupo'), cc);
    if (ad.length >= 4) add(reactive.bootsArmor, 'Time quase todo de dano físico', 68, G('ad', 'Ataques básicos'), ad);
  }
  // alternativas populares do OP.GG para o 4º-6º item
  for (const slot of build.later || []) {
    for (const o of [...slot].sort((a, b) => b.pick - a.pick).slice(0, 3)) {
      if (o.ids.length === 1) add(o.ids, `Alternativa do meta (${Math.round((o.pick || 0) * 100)}% dos jogadores)`, 40 + (o.pick || 0) * 40);
    }
  }
  // sem inimigos ainda: as respostas mais comuns da classe, para ter à mão
  if (!e.length) {
    add(reactive.antiheal[cls], 'Se o inimigo tiver cura', 30, G('heal', 'Cura'));
    add(reactive.armor[cls], 'Se o dano físico inimigo apertar', 29, G('ad', 'Dano físico'));
    add(reactive.mr[cls], 'Se o dano mágico inimigo apertar', 28, G('ap', 'Dano mágico'));
  }
  return [...out.values()].sort((a, b) => b.prio - a.prio).slice(0, limit).map(({ prio, ...rest }) => rest);
}

module.exports = { situationalItems, classFor };
