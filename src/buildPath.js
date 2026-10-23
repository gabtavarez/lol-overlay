/**
 * Itens depois do core (4º ao 6º slot) sem repetir nenhum: em cada slot pega a opção mais
 * usada cujos itens ainda não apareceram no core, nas botas ou nos slots anteriores.
 */
function laterItems(build, exclude = []) {
  const used = new Set([...(build.core || []), ...(build.boots || []), ...exclude]);
  const out = [];
  for (const slot of build.later || []) {
    const options = [...slot].sort((a, b) => b.pick - a.pick);
    const pick = options.find((o) => o.ids.length && o.ids.every((id) => !used.has(id)));
    if (!pick) continue;
    for (const id of pick.ids) {
      used.add(id);
      out.push(id);
    }
  }
  return out;
}

module.exports = { laterItems };
