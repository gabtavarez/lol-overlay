/** Sonda manual: servidor de licenças do Pro (Supabase Edge Function). */
const fs = require('fs');
const B = 'https://wzvpedyefbmevazdxtoc.supabase.co/functions/v1/pro';
const KEY = process.env.PROBE_KEY || '';
(async () => {
  fs.mkdirSync('audit/probe', { recursive: true });
  const out = {};
  const call = async (name, path, body, headers = {}) => {
    try {
      const r = await fetch(B + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) } : {});
      out[name] = { status: r.status, body: await r.json().catch(() => null) };
    } catch (e) { out[name] = { error: e.message }; }
    return out[name];
  };
  await call('status', '/status');
  await call('licenseNone', '/license', { install: 'probe-install-0000000001' });
  await call('licenseBadInstall', '/license', { install: 'x' });
  await call('checkout', '/checkout', { install: 'probe-install-0000000001', plan: 'm1' });
  await call('checkoutBad', '/checkout', { install: 'probe-install-0000000001', plan: 'zzz' });
  await call('admin', '/admin/list', {}, { 'x-admin': 'errada' });
  await call('webhookNoise', '/webhook', { type: 'test' });
  await call('order', '/order?o=00000000-0000-0000-0000-000000000000&t=x');
  if (fs.existsSync('audit/probe-key.txt') || KEY) {
    const key = KEY || fs.readFileSync('audit/probe-key.txt', 'utf8').trim();
    const a = await call('licenseKey', '/license', { install: 'probe-install-0000000001', key });
    await call('licenseAuto', '/license', { install: 'probe-install-0000000001' });
    await call('licenseSecondPc', '/license', { install: 'probe-install-0000000002', key });
    await call('licenseThirdPc', '/license', { install: 'probe-install-0000000003', key });
    if (a.body && a.body.token) {
      const { verifyLicense } = require('../src/plan');
      const p = verifyLicense(a.body.token, out.status.body.publicKey);
      out.verify = { ok: !!p, payload: p, tampered: verifyLicense(a.body.token.replace(/^./, (c) => (c === 'e' ? 'f' : 'e')), out.status.body.publicKey) };
      for (const k of ['licenseKey', 'licenseAuto', 'licenseSecondPc']) if (out[k].body && out[k].body.token) out[k].body.token = out[k].body.token.slice(0, 20) + '…';
    }
  }
  fs.writeFileSync('audit/probe/pro.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
})();
