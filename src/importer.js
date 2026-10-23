const { lcuRequest, lcuGetJson } = require('./lcu');
const { laterItems } = require('./buildPath');

const PAGE_PREFIX = 'LoL Overlay';
const ok = (res) => res.status >= 200 && res.status < 300;

function validRunes(r) {
  return Boolean(
    r && Number.isInteger(r.primaryStyleId) && Number.isInteger(r.subStyleId) &&
    Array.isArray(r.perks) && r.perks.length === 9 && r.perks.every(Number.isInteger),
  );
}

/** Cria ou atualiza a página de runas "LoL Overlay · Campeão" e a seleciona. */
async function importRunes(creds, runes, championName) {
  if (!validRunes(runes)) throw new Error('runas inválidas');
  const name = `${PAGE_PREFIX} · ${championName}`.slice(0, 25);
  const body = {
    name, primaryStyleId: runes.primaryStyleId, subStyleId: runes.subStyleId,
    selectedPerkIds: runes.perks, current: true,
  };
  const pages = await lcuGetJson(creds, '/lol-perks/v1/pages');
  const mine = pages.find((p) => String(p.name).startsWith(PAGE_PREFIX));

  let res = null;
  if (mine) {
    res = await lcuRequest(creds, `/lol-perks/v1/pages/${mine.id}`, { method: 'PUT', json: body });
    if (!ok(res)) {
      await lcuRequest(creds, `/lol-perks/v1/pages/${mine.id}`, { method: 'DELETE' });
      res = null;
    }
  }
  if (!res) {
    res = await lcuRequest(creds, '/lol-perks/v1/pages', { method: 'POST', json: body });
    if (!ok(res)) {
      // limite de páginas: libera uma que não seja a atual
      const spare = pages.find((p) => p.isDeletable && !p.current && !String(p.name).startsWith(PAGE_PREFIX));
      if (!spare) throw new Error('sem espaço para uma nova página de runas');
      await lcuRequest(creds, `/lol-perks/v1/pages/${spare.id}`, { method: 'DELETE' });
      res = await lcuRequest(creds, '/lol-perks/v1/pages', { method: 'POST', json: body });
    }
  }
  if (!ok(res)) throw new Error(`o cliente recusou a página (HTTP ${res.status})`);
  if (res.body && Number.isInteger(res.body.id)) {
    await lcuRequest(creds, '/lol-perks/v1/currentpage', { method: 'PUT', json: res.body.id }).catch(() => {});
  }
  return { name };
}

/** Define os dois feitiços na seleção atual (só funciona durante o champ select). */
async function importSpells(creds, spells, { flashOnF = true } = {}) {
  if (!Array.isArray(spells) || spells.length < 2 || !spells.every(Number.isInteger)) {
    throw new Error('feitiços inválidos');
  }
  let [a, b] = spells;
  // Flash na tecla escolhida: spell1 = D, spell2 = F
  if (flashOnF && a === 4) [a, b] = [b, a];
  else if (!flashOnF && b === 4) [a, b] = [b, a];
  const res = await lcuRequest(creds, '/lol-champ-select/v1/session/my-selection', {
    method: 'PATCH', json: { spell1Id: a, spell2Id: b },
  });
  if (!ok(res)) throw new Error(`o cliente recusou os feitiços (HTTP ${res.status})`);
  return { spell1Id: a, spell2Id: b };
}

/** Cria/atualiza o conjunto de itens "LoL Overlay · Campeão" na loja do cliente. */
async function importItemSet(creds, build, champ) {
  const block = (type, ids) => ({ type, items: ids.map((id) => ({ id: String(id), count: 1 })) });
  const later = laterItems(build);
  const blocks = [
    build.starter.length && block('Inicial', build.starter),
    build.boots.length && block('Botas', build.boots),
    build.core.length && block(build.matchup ? `Core vs ${build.matchup.vs}` : 'Core', build.core),
    later.length && block('Depois', later),
  ].filter(Boolean);
  if (!blocks.length) throw new Error('sem itens para importar');

  const me = await lcuGetJson(creds, '/lol-summoner/v1/current-summoner');
  const sets = await lcuGetJson(creds, `/lol-item-sets/v1/item-sets/${me.summonerId}/sets`);
  const title = `${PAGE_PREFIX} · ${champ.name}`;
  const keep = (sets.itemSets || []).filter((s) => !String(s.title).startsWith(`${PAGE_PREFIX} · ${champ.name}`));
  keep.push({
    title,
    uid: `lol-overlay-${champ.key}`,
    type: 'custom',
    map: 'any',
    mode: 'any',
    sortrank: 0,
    startedFrom: 'blank',
    associatedChampions: [Number(champ.key)],
    associatedMaps: [],
    blocks,
  });
  const res = await lcuRequest(creds, `/lol-item-sets/v1/item-sets/${me.summonerId}/sets`, {
    method: 'PUT', json: { ...sets, accountId: sets.accountId || me.accountId, itemSets: keep, timestamp: Date.now() },
  });
  if (!ok(res)) throw new Error(`o cliente recusou o conjunto de itens (HTTP ${res.status})`);
  return { title };
}

module.exports = { importRunes, importSpells, importItemSet, validRunes };
