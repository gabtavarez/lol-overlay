/** Sonda manual: Lolalytics (tier e página por confronto) para o laboratório de builds. */
const fs = require('fs');
const { qwikObjects } = require('../src/providers/lolalytics');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const shape = (v, d = 0) => (Array.isArray(v) ? (d > 2 ? `[${v.length}]` : [v.length, shape(v[0], d + 1)]) : v && typeof v === 'object' ? (d > 2 ? '{…}' : Object.fromEntries(Object.entries(v).slice(0, 40).map(([k, x]) => [k, shape(x, d + 1)]))) : v);
(async () => {
  fs.mkdirSync('audit/probe', { recursive: true });
  const out = {};
  const urls = {
    dia: 'https://lolalytics.com/lol/ahri/build/?lane=middle&tier=diamond_plus',
    all: 'https://lolalytics.com/lol/ahri/build/?lane=middle&tier=all',
    vs: 'https://lolalytics.com/lol/ahri/vs/zed/build/?lane=middle&tier=emerald_plus',
    vs2: 'https://lolalytics.com/lol/ahri/vs/zed/build/?lane=middle&vslane=middle&tier=emerald_plus',
  };
  for (const [k, url] of Object.entries(urls)) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      const html = await r.text();
      out[k] = { status: r.status, len: html.length };
      fs.writeFileSync(`audit/probe/lola-${k}.html`, html);
      try {
        const z = qwikObjects(html);
        out[k].keys = Object.keys(z);
        out[k].header = z.header;
        out[k].item1 = (z.item1 || []).slice(0, 3); out[k].item4 = (z.item4 || []).slice(0, 3);
        out[k].runesShape = shape(z.runes);
        out[k].stat8112 = z.runes && z.runes.stats && z.runes.stats[8112];
      } catch (e) {
        out[k].parse = e.message;
        const m = /<script type="qwik\/json">([\s\S]*?)<\/script>/.exec(html);
        if (m) { const objs = JSON.parse(m[1]).objs || []; out[k].objKeys = objs.filter((o) => o && typeof o === 'object' && !Array.isArray(o)).slice(0, 60).map((o) => Object.keys(o).slice(0, 12).join(',')); }
      }
    } catch (e) { out[k] = { error: e.message }; }
  }
  fs.writeFileSync('audit/probe/lola2.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out).slice(0, 3000));
})();
