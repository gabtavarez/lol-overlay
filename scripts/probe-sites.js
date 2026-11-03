/** Sonda manual (autorizada pelo dono do app): página da build do Lolalytics, para mapear onde ficam os dados. */
const fs = require('fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
(async () => {
  fs.mkdirSync('audit/probe', { recursive: true });
  const out = {};
  for (const [k, url] of Object.entries({ page: 'https://lolalytics.com/lol/ahri/build/', vs: 'https://lolalytics.com/lol/ahri/vs/zed/build/' })) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      const body = await r.text();
      out[k] = { url, status: r.status, len: body.length };
      fs.writeFileSync(`audit/probe/lola-${k}.html`, body);
    } catch (e) { out[k] = { url, error: e.message }; }
  }
  fs.writeFileSync('audit/probe/lola.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
})();
