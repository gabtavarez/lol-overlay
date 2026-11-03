/** Sonda manual: testa se U.GG, Lolalytics, League of Graphs e DeepLoL respondem a acesso automático (status + trecho). */
const fs = require('fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const urls = {
  'ugg-versions': 'https://static.bigbrain.gg/assets/lol/riot_patch_update/prod/ugg/ugg-api-versions.json',
  'ugg-page': 'https://u.gg/lol/champions/ahri/build',
  'lolalytics-page': 'https://lolalytics.com/lol/ahri/build/',
  'lolalytics-api': 'https://a1.lolalytics.com/mega/?ep=build-itemset&p=d&v=1&patch=30&cid=103&lane=middle&tier=emerald_plus&queue=420&region=all',
  'log-page': 'https://www.leagueofgraphs.com/champions/builds/ahri/middle',
  'deeplol-page': 'https://www.deeplol.gg/champions/ahri/build/mid',
};
(async () => {
  fs.mkdirSync('audit/probe', { recursive: true });
  const out = {};
  for (const [k, u] of Object.entries(urls)) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json' }, signal: AbortSignal.timeout(20000) });
      const body = await r.text();
      out[k] = { url: u, status: r.status, type: r.headers.get('content-type'), len: body.length, head: body.slice(0, 1500) };
      fs.writeFileSync(`audit/probe/site-${k}.txt`, body.slice(0, 400000));
    } catch (e) { out[k] = { url: u, error: e.message }; }
  }
  // U.GG: se a lista de versões vier, tenta o JSON de estatísticas da Ahri
  try {
    const v = JSON.parse(fs.readFileSync('audit/probe/site-ugg-versions.txt', 'utf8'));
    const patch = Object.keys(v).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    const ver = v[patch] && v[patch].overview;
    const u = `https://stats2.u.gg/lol/1.5/overview/${patch}/ranked_solo_5x5/103/${ver}.json`;
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    const body = await r.text();
    out['ugg-overview'] = { url: u, status: r.status, len: body.length, head: body.slice(0, 1500) };
    fs.writeFileSync('audit/probe/site-ugg-overview.txt', body.slice(0, 400000));
  } catch (e) { out['ugg-overview'] = { error: e.message }; }
  fs.writeFileSync('audit/probe/sites.json', JSON.stringify(out, null, 1));
  console.log(Object.entries(out).map(([k, x]) => `${k}: ${x.status || x.error} ${x.len || ''}`).join('\n'));
})();
