/*
 * Idiomas do app. O português é o texto-fonte: cada dicionário (locales/<lang>.js) mapeia
 * "texto em português" -> tradução. Sem tradução, o português aparece (nunca quebra).
 * Nomes de campeões, itens, runas e habilidades NÃO passam por aqui: vêm do Data Dragon no idioma da região.
 */
window.LOCALES = window.LOCALES || {};
const LANGS = { pt: 'Português', en: 'English', es: 'Español' };
const LANG = (() => {
  const q = new URLSearchParams(location.search).get('lang');
  return q && LANGS[q] ? q : 'pt';
})();
document.documentElement.lang = { pt: 'pt-BR', en: 'en', es: 'es' }[LANG];

/** t('Faltam {n} g', { n: 300 }) */
function t(text, vars) {
  if (typeof text !== 'string') return text;
  const dict = LANG === 'pt' ? null : window.LOCALES[LANG];
  let out = (dict && dict[text]) || text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** Traduz textos fixos do HTML (nós de texto + placeholder/title/aria-label) dentro de `root`. */
function translateDom(root = document.body) {
  if (LANG === 'pt' || !root) return;
  const dict = window.LOCALES[LANG] || {};
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const raw = n.nodeValue;
    const key = raw.trim();
    if (key && dict[key]) n.nodeValue = raw.replace(key, dict[key]);
  }
  for (const el of root.querySelectorAll('[placeholder],[title],[aria-label]')) {
    for (const a of ['placeholder', 'title', 'aria-label']) {
      const v = el.getAttribute(a);
      if (v && dict[v]) el.setAttribute(a, dict[v]);
    }
  }
}
