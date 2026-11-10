/** Estado local do Pro: id da instalação, chave, licença assinada e se a cobrança está ligada. */
const fs = require('fs');
const crypto = require('crypto');

function createProStore(file) {
  let state = { install: '', key: '', token: '', paywall: false, expiresAt: null, kind: null };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* primeira execução */ }
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(state)); } catch { /* disco cheio/sem permissão: segue em memória */ } };
  if (!/^[A-Za-z0-9-]{16,64}$/.test(state.install || '')) { state.install = crypto.randomUUID(); save(); }
  return {
    get: () => state,
    set(patch) { state = { ...state, ...patch }; save(); return state; },
  };
}

module.exports = { createProStore };
