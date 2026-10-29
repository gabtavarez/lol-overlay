/**
 * Plano do usuário (grátis x Pro) — estrutura pronta para a assinatura, DESLIGADA por enquanto:
 * com PAYWALL_ON = false todo mundo tem tudo, e nada muda para quem usa o app hoje.
 *
 * Como vai funcionar quando ligar:
 *  1) o usuário assina no site (Mercado Pago no Brasil / Paddle fora); o webhook grava a assinatura no servidor;
 *  2) no app, ele informa o e-mail e recebe um código; o servidor devolve uma licença assinada (Ed25519)
 *     com e-mail, plano e validade (7 dias), renovada sozinha em segundo plano;
 *  3) o app confere a assinatura com a chave pública embutida (funciona offline) e libera os recursos Pro;
 *     sem internet, a licença vale até expirar + 3 dias de tolerância.
 */
const crypto = require('crypto');

const PAYWALL_ON = false;
// Chave pública do servidor de licenças (preencher ao criar o servidor). Sem ela, nenhuma licença é aceita.
const LICENSE_PUBLIC_KEY = '';
const GRACE_MS = 3 * 24 * 3600 * 1000;

/** O que é grátis e o que é Pro (mesma divisão da proposta de assinatura). */
const FEATURES = {
  picks: 'free', bans: 'free', build: 'free', import: 'free', buysBasic: 'free', timers: 'free',
  tierlist: 'free', patchNotes: 'free', aram: 'free', gradeOverall: 'free', damageComp: 'free',
  laneCoach: 'pro', matchupBuild: 'pro', buysAdvanced: 'pro', tierByElo: 'pro', scouting: 'pro',
  postgameFull: 'pro', tilt: 'pro', skinAdvisor: 'pro', overlayThemes: 'pro',
};

/** Valida uma licença "base64url(payload).base64url(assinatura)" -> payload ou null. */
function verifyLicense(token, publicKeyPem = LICENSE_PUBLIC_KEY, now = Date.now()) {
  if (!token || !publicKeyPem) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  try {
    const ok = crypto.verify(null, Buffer.from(body), crypto.createPublicKey(publicKeyPem), Buffer.from(sig, 'base64url'));
    if (!ok) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p.exp || now > p.exp + GRACE_MS) return null;
    return p; // { email, plan: 'pro', exp }
  } catch {
    return null;
  }
}

function createPlan({ getLicense = () => '', publicKey = LICENSE_PUBLIC_KEY, paywall = PAYWALL_ON } = {}) {
  const current = () => {
    if (!paywall) return { plan: 'pro', paywall: false, reason: 'liberado' };
    const lic = verifyLicense(getLicense(), publicKey);
    return lic && lic.plan === 'pro' ? { plan: 'pro', paywall: true, email: lic.email, exp: lic.exp } : { plan: 'free', paywall: true };
  };
  return {
    current,
    /** can('laneCoach') -> true/false */
    can: (feature) => FEATURES[feature] !== 'pro' || current().plan === 'pro',
  };
}

module.exports = { createPlan, verifyLicense, FEATURES, PAYWALL_ON };
