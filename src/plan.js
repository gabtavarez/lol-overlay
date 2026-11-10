/**
 * Plano do usuário (grátis x Pro).
 *
 * A cobrança é ligada pelo servidor (painel admin): enquanto estiver desligada, todo mundo tem tudo.
 * Com ela ligada, o app libera o Pro com uma licença assinada (Ed25519) emitida pelo servidor:
 *  - a compra (Pix ou cartão, Mercado Pago) é ligada à instalação; o app busca a licença sozinho;
 *  - a licença vale alguns dias e é renovada em segundo plano; sem internet, vale até expirar + tolerância;
 *  - a assinatura é conferida com a chave pública embutida, então não dá para forjar no PC do usuário.
 */
const crypto = require('crypto');

const SERVER = 'https://wzvpedyefbmevazdxtoc.supabase.co/functions/v1/pro';
// Chave pública do servidor de licenças. A chave privada fica só no servidor.
const LICENSE_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAbTk+P/yeiQPJqG58zwxuacUodSVP8tZHoZqWezO+VHc=\n-----END PUBLIC KEY-----\n';
const GRACE_MS = 3 * 24 * 3600 * 1000;
const PLANS = [{ id: 'm1', days: 30, price: 9.9 }, { id: 'y1', days: 365, price: 59.9 }, { id: 'life', days: null, price: 99.9 }];

/** O que é grátis e o que é Pro. */
const FEATURES = {
  build: 'free', import: 'free', overlay: 'free', tierlist: 'free', patchNotes: 'free', aram: 'free', profile: 'free', damageComp: 'free',
  lab: 'pro', roleSwitch: 'pro', picks: 'pro', bans: 'pro', skins: 'pro', items: 'pro',
};

/** Valida uma licença "base64url(payload).base64url(assinatura)" -> payload ou null. */
function verifyLicense(token, publicKeyPem = LICENSE_PUBLIC_KEY, now = Date.now(), install = null) {
  if (!token || !publicKeyPem) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  try {
    const ok = crypto.verify(null, Buffer.from(body), crypto.createPublicKey(publicKeyPem), Buffer.from(sig, 'base64url'));
    if (!ok) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p.exp || now > p.exp + GRACE_MS) return null;
    if (install && p.install && p.install !== install) return null; // licença copiada de outro PC
    return p; // { plan: 'pro', kind, install, exp, until }
  } catch {
    return null;
  }
}

/**
 * getLicense() -> token salvo; getPaywall() -> último valor conhecido da chave geral do servidor;
 * getInstall() -> id desta instalação.
 */
function createPlan({ getLicense = () => '', getPaywall = () => false, getInstall = () => null, publicKey = LICENSE_PUBLIC_KEY } = {}) {
  const current = () => {
    if (!getPaywall()) return { plan: 'pro', paywall: false };
    const lic = verifyLicense(getLicense(), publicKey, Date.now(), getInstall());
    return lic && lic.plan === 'pro' ? { plan: 'pro', paywall: true, kind: lic.kind || null, exp: lic.exp, until: lic.until == null ? null : lic.until } : { plan: 'free', paywall: true };
  };
  return {
    current,
    /** can('lab') -> true/false */
    can: (feature) => FEATURES[feature] !== 'pro' || current().plan === 'pro',
  };
}

/** Conversa com o servidor de licenças. */
function createLicenseClient({ fetchImpl = fetch, server = SERVER, log = () => {} } = {}) {
  const post = async (path, body) => {
    const r = await fetchImpl(`${server}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok && !data.error) data.error = `HTTP ${r.status}`;
    return data;
  };
  return {
    /** -> { token, key, kind, expires_at, paywall } | { token: null, reason, paywall } | { error } */
    async license(install, key = null) {
      try { return await post('/license', key ? { install, key } : { install }); } catch (err) { log(`licença: ${err.message}`); return { error: err.message, offline: true }; }
    },
    /** -> { url, order } | { error } */
    async checkout(install, plan) {
      try { return await post('/checkout', { install, plan }); } catch (err) { log(`checkout: ${err.message}`); return { error: err.message }; }
    },
  };
}

module.exports = { createPlan, createLicenseClient, verifyLicense, FEATURES, PLANS, SERVER, LICENSE_PUBLIC_KEY };
