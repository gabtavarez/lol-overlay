/**
 * Mudanças do patch nos seus campeões: compara o champion/<id>.json do Data Dragon
 * do patch atual com o anterior (recarga, custo e alcance das skills + atributos base).
 * O Data Dragon não traz o dano das habilidades, então mudanças só de dano não aparecem aqui.
 */

// atributo -> [nome, maior é melhor?]
const STATS = {
  hp: ['Vida', true], hpperlevel: ['Vida por nível', true], mp: ['Mana', true], mpperlevel: ['Mana por nível', true],
  movespeed: ['Velocidade de movimento', true], armor: ['Armadura', true], armorperlevel: ['Armadura por nível', true],
  spellblock: ['Resistência mágica', true], spellblockperlevel: ['RM por nível', true], attackrange: ['Alcance de ataque', true],
  hpregen: ['Regeneração de vida', true], mpregen: ['Regeneração de mana', true],
  attackdamage: ['Dano de ataque', true], attackdamageperlevel: ['Dano de ataque por nível', true],
  attackspeed: ['Velocidade de ataque', true], attackspeedperlevel: ['Vel. de ataque por nível', true],
};

const fmt = (n) => (Math.round(n * 1000) / 1000).toLocaleString('pt-BR');
// [7,7,7,7,7] vira "7"; valores por rank diferentes ficam "7/6,5/6"
const list = (a) => (Array.isArray(a) ? (a.every((x) => x === a[0]) ? fmt(a[0]) : a.map(fmt).join('/')) : fmt(a));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sum = (a) => (Array.isArray(a) ? a.reduce((s, x) => s + Number(x || 0), 0) : Number(a || 0));

/** -> [{ what, from, to, buff: true|false|null }] */
function diffChampion(prev, cur) {
  if (!prev || !cur) return [];
  const out = [];
  for (const [k, [label, higherBetter]] of Object.entries(STATS)) {
    const a = prev.stats && prev.stats[k];
    const b = cur.stats && cur.stats[k];
    if (typeof a !== 'number' || typeof b !== 'number' || a === b) continue;
    out.push({ what: label, from: fmt(a), to: fmt(b), buff: (b > a) === higherBetter });
  }
  (cur.spells || []).slice(0, 4).forEach((s, i) => {
    const p = (prev.spells || [])[i];
    if (!p) return;
    const key = `${'QWER'[i]} (${s.name})`;
    if (!same(p.cooldown, s.cooldown)) out.push({ what: `${key}: recarga`, from: `${list(p.cooldown)} s`, to: `${list(s.cooldown)} s`, buff: sum(s.cooldown) < sum(p.cooldown) });
    if (!same(p.cost, s.cost) && sum(p.cost) + sum(s.cost) > 0) out.push({ what: `${key}: custo`, from: list(p.cost), to: list(s.cost), buff: sum(s.cost) < sum(p.cost) });
    if (!same(p.range, s.range) && sum(s.range) < 25000 && sum(p.range) < 25000) out.push({ what: `${key}: alcance`, from: list(p.range), to: list(s.range), buff: sum(s.range) > sum(p.range) });
  });
  return out;
}

/** Veredito de uma lista de mudanças: buff / nerf / ajuste. */
function verdict(changes) {
  if (!changes.length) return null;
  const up = changes.filter((c) => c.buff === true).length;
  const down = changes.filter((c) => c.buff === false).length;
  return up && !down ? 'buff' : down && !up ? 'nerf' : 'ajuste';
}

module.exports = { diffChampion, verdict };
