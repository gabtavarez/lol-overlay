/** Sonda manual: DDragon vs CommunityDragon (skins novas e imagens). */
const fs = require('fs');
(async () => {
  fs.mkdirSync('audit/probe', { recursive: true });
  const out = {};
  const get = async (k, url, text) => { try { const r = await fetch(url); out[k] = { status: r.status, type: r.headers.get('content-type') }; return text ? await r.text() : r; } catch (e) { out[k] = { error: e.message }; } };
  const v = JSON.parse(await get('versions', 'https://ddragon.leagueoflegends.com/api/versions.json', true));
  out.latest = v[0];
  const raw = JSON.parse(await get('skins', 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/pt_br/v1/skins.json', true));
  const all = Object.values(raw);
  out.total = all.length;
  const fire = all.filter((s) => /firestarter/i.test(JSON.stringify([s.name, s.skinLines])));
  out.firestarter = fire.slice(0, 12).map((s) => ({ id: s.id, name: s.name, rarity: s.rarity, lines: s.skinLines }));
  const newest = all.sort((a, b) => b.id - a.id).slice(0, 5).map((s) => ({ id: s.id, name: s.name }));
  out.newestIds = newest;
  // imagens: DDragon loading para as skins firestarter vs CDragon
  const champs = JSON.parse(await get('champs', `https://ddragon.leagueoflegends.com/cdn/${v[0]}/data/en_US/champion.json`, true)).data;
  const byKey = Object.fromEntries(Object.values(champs).map((c) => [Number(c.key), c.id]));
  out.imgs = [];
  for (const s of fire.slice(0, 6)) {
    const cid = Math.floor(s.id / 1000); const num = s.id % 1000; const name = byKey[cid];
    const a = name ? await fetch(`https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${name}_${num}.jpg`).then((r) => r.status).catch((e) => e.message) : 'champ-missing-in-ddragon';
    const b = await fetch(`https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-splashes/${cid}/${s.id}.jpg`).then((r) => r.status).catch((e) => e.message);
    const c = await fetch(`https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-loadscreens/${cid}/${s.id}.jpg`).then((r) => r.status).catch((e) => e.message);
    out.imgs.push({ id: s.id, name: s.name, champ: name, ddragonLoading: a, cdragonSplash: b, cdragonLoadscreen: c });
  }
  fs.writeFileSync('audit/probe/assets.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
})();
