/** Sonda manual: baixa os JSON de estatísticas do U.GG (Ahri) para mapear o formato. */
const fs = require('fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
(async () => {
  fs.mkdirSync('audit/probe', { recursive: true });
  const v = await (await fetch('https://static.bigbrain.gg/assets/lol/riot_patch_update/prod/ugg/ugg-api-versions.json', { headers: { 'User-Agent': UA } })).json();
  const patch = Object.keys(v).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  const out = { patch, versions: v[patch] };
  for (const ep of ['overview', 'items', 'matchups', 'builds', 'runes', 'primary_roles']) {
    const ver = v[patch][ep];
    if (!ver) { out[ep] = 'sem versão'; continue; }
    const url = ep === 'primary_roles' ? `https://stats2.u.gg/lol/1.5/primary_roles/${patch}/${ver}.json` : `https://stats2.u.gg/lol/1.5/${ep}/${patch}/ranked_solo_5x5/103/${ver}.json`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      const body = await r.text();
      out[ep] = { url, status: r.status, len: body.length };
      if (r.ok) fs.writeFileSync(`audit/probe/ugg-${ep}.json`, body);
    } catch (e) { out[ep] = { url, error: e.message }; }
  }
  fs.writeFileSync('audit/probe/ugg.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
})();
