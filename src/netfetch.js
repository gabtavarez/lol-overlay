// fetch resiliente: tenta a rede do Chromium (usa proxy/DNS do Windows) e cai no fetch do Node.
function describe(e) {
  const c = e && e.cause && (e.cause.code || e.cause.message);
  return c ? `${e.message} (${c})` : (e && e.message) || String(e);
}
function netFetch(url, opts = {}) {
  let electronNet = null;
  try { electronNet = require('electron').net; } catch { /* fora do Electron */ }
  const viaNet = electronNet && electronNet.fetch ? () => electronNet.fetch(url, opts) : null;
  const viaNode = () => fetch(url, opts);
  const order = viaNet ? [viaNet, viaNode] : [viaNode];
  return (async () => {
    let first = null;
    for (const run of order) {
      try { return await run(); } catch (e) { if (!first) first = e; }
    }
    throw new Error(describe(first));
  })();
}
module.exports = { netFetch, describe };
