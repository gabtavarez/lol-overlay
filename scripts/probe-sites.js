/** Sonda manual (autorizada pelo dono do app): páginas de build do Metasrc, para mapear onde ficam os dados. */
const fs = require('fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
(async () => {
  fs.mkdirSync('audit/probe', { recursive: true });
  const out = {};
  for (const [k, url] of Object.entries({
    page: 'https://www.metasrc.com/lol/build/ahri',
    mid: 'https://www.metasrc.com/lol/build/ahri/mid',
    runes: 'https://www.metasrc.com/lol/runes/ahri',
    robots: 'https://www.metasrc.com/robots.txt',
  })) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
      const body = await r.text();
      out[k] = { url, status: r.status, len: body.length, server: r.headers.get('server'), cf: r.headers.get('cf-mitigated') };
      fs.writeFileSync(`audit/probe/msrc-${k}.html`, body);
    } catch (e) { out[k] = { url, error: e.message + (e.cause ? ` (${e.cause.code || e.cause.message})` : '') }; }
  }
  fs.writeFileSync('audit/probe/msrc.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
})();
