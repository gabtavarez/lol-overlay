const fs = require('fs/promises');
const path = require('path');
const { parse } = require('node-html-parser');

/**
 * Notas de atualização oficiais (leagueoflegends.com, pt-BR) convertidas em dados:
 * seções (Campeões, Itens, Arena…), cada campeão/item com o contexto da Riot e as
 * mudanças "antes ⇒ depois", com um palpite de buff/nerf por linha.
 * A página é Next.js: o HTML das notas vem no __NEXT_DATA__ (blade patchNotesRichText).
 */

const SITE = 'https://www.leagueoflegends.com';
// locale do site da Riot: pt-br, en-us, es-mx (notas oficiais no idioma do app)
const listUrl = (loc = 'pt-br') => `${SITE}/${loc}/news/tags/patch-notes/`;
const noteUrl = (v, loc = 'pt-br') => `${SITE}/${loc}/news/game-updates/league-of-legends-patch-${v.replace('.', '-')}-notes/`;
// o endereço muda entre idiomas/patches: tenta o link da lista e os formatos conhecidos
const noteUrls = (v, loc, known) => [...new Set([known, noteUrl(v, loc), `${SITE}/${loc}/news/game-updates/patch-${v.replace('.', '-')}-notes/`].filter(Boolean))];

const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const textOf = (el) => clean(el ? el.structuredText || el.text : '');

/** URL da imagem sem o proxy da Riot (am-a.akamaihd.net/image?f=<url>). */
function imgUrl(src) {
  if (!src) return null;
  try {
    const u = new URL(src);
    if (u.hostname === 'am-a.akamaihd.net' && u.searchParams.get('f')) return imgUrl(u.searchParams.get('f'));
    if (u.protocol !== 'https:') return null;
    if (/(^|\.)ddragon\.leagueoflegends\.com$|(^|\.)cmsassets\.rgpub\.io$/.test(u.hostname)) return u.toString();
  } catch { /* url inválida */ }
  return null;
}

/** "1.000" -> 1000, "0,8" -> 0.8; média de todos os números do texto. */
function avgNumber(s) {
  const nums = String(s || '').match(/\d+(?:\.\d{3})*(?:,\d+)?|\d+(?:\.\d+)?/g);
  if (!nums) return null;
  const vals = nums.map((n) => Number(/,\d+$/.test(n) || /\.\d{3}(\D|$)/.test(n) ? n.replace(/\./g, '').replace(',', '.') : n));
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

const LOWER_BETTER = /recarga|custo|tempo de conjura|tempo de canaliza|cooldown|atraso|tempo de reapari|tempo para|cost|cast time|channel|delay|respawn|time to|enfriamiento|costo|coste|tiempo de lanzamiento|canaliza|retraso|reaparici|tiempo para/i;

/** Palpite de direção: 'buff' | 'nerf' | null (texto, NOVO/REMOVIDO ou números iguais). */
function direction(label, from, to) {
  // compara só os valores base; escalamentos "(+ 60% do PdH)" decidem quando o base empata
  const base = (s) => String(s).replace(/\([^)]*\)/g, ' ');
  const a = avgNumber(base(from));
  const b = avgNumber(base(to));
  if (a == null || b == null) return null;
  const lower = LOWER_BETTER.test(label);
  if (a === b) {
    const ra = (String(from).match(/\(\+/g) || []).length;
    const rb = (String(to).match(/\(\+/g) || []).length;
    if (ra === rb) {
      const sa = avgNumber((String(from).match(/\([^)]*\)/g) || []).join(' '));
      const sb = avgNumber((String(to).match(/\([^)]*\)/g) || []).join(' '));
      if (sa == null || sb == null || sa === sb) return null;
      return (sb > sa) !== lower ? 'buff' : 'nerf';
    }
    return (rb > ra) !== lower ? 'buff' : 'nerf';
  }
  return (b > a) !== lower ? 'buff' : 'nerf';
}

function parseChange(text) {
  const t = clean(text);
  const tag = /^(NOVO|NEW|NUEVO)\b/i.test(t) ? 'new' : /^(REMOVIDO|REMOVED|ELIMINADO)\b/i.test(t) ? 'removed' : null;
  const i = t.indexOf(':');
  const label = i > 0 && i < 90 ? t.slice(0, i).trim() : null;
  const rest = label ? t.slice(i + 1).trim() : t;
  const arrow = rest.split(/\s*⇒\s*/);
  if (arrow.length === 2) return { label, from: arrow[0], to: arrow[1], dir: direction(label || '', arrow[0], arrow[1]), tag };
  return { label, text: rest, dir: null, tag };
}

function verdict(entity) {
  const all = entity.groups.flatMap((g) => g.changes);
  const up = all.filter((c) => c.dir === 'buff').length;
  const down = all.filter((c) => c.dir === 'nerf').length;
  if (up && !down) return 'buff';
  if (down && !up) return 'nerf';
  return 'ajuste';
}

const sectionKind = (id, title) => (/champions/.test(id) || /^(Campe|Champion)/.test(title) ? 'champions'
  : /items/.test(id) || /^(Itens|Items|Objetos)/.test(title) ? 'items'
    : /bugfix|qol/.test(id) || /Correç|Correcci|Bug ?fix/i.test(title) ? 'bugfixes'
      : /skins|chromas/.test(id) || /skins|Cromas|Chromas|Aspectos/i.test(title) ? 'skins' : 'other');

/** HTML do patch-notes-container -> { intro, sections }. `resolve(name, kind)` -> { id, icon } | null. */
function parseNotesHtml(html, resolve = () => null) {
  const root = parse(html, { blockTextElements: { script: false, style: false } });
  const box = root.querySelector('#patch-notes-container') || root;
  const out = { intro: [], sections: [] };
  let sec = null;
  let ent = null;
  let group = null;
  let pendingImg = null;

  const newEntity = (name, icon) => {
    if (!sec) return null;
    const kind = sec.kind === 'items' ? 'item' : 'champion';
    const r = resolve(name, kind, icon) || (sec.kind === 'other' || sec.kind === 'bugfixes' ? resolve(name, 'champion', icon) : null);
    ent = { name, kind: r ? r.kind || kind : sec.kind === 'champions' ? 'champion' : sec.kind === 'items' ? 'item' : null, id: r ? r.id : null, icon: (r && r.icon) || icon || null, context: null, groups: [] };
    sec.entities.push(ent);
    group = null;
    return ent;
  };
  const ensureGroup = () => {
    if (!ent) newEntity(null, null);
    if (!group) { group = { title: null, icon: null, changes: [] }; ent.groups.push(group); }
    return group;
  };

  function visit(el) {
    for (const node of el.childNodes) {
      if (node.nodeType !== 1) continue;
      const tag = node.rawTagName ? node.rawTagName.toLowerCase() : '';
      const cls = node.getAttribute('class') || '';
      if (/context-designers/.test(cls)) continue;
      if (tag === 'header' || tag === 'h2') {
        const h2 = tag === 'h2' ? node : node.querySelector('h2');
        const title = textOf(h2 || node);
        const id = (h2 && h2.getAttribute('id')) || '';
        sec = { id: id.replace(/^patch-/, ''), title, kind: sectionKind(id, title), intro: [], images: [], entities: [], bullets: [] };
        out.sections.push(sec);
        ent = null; group = null; pendingImg = null;
      } else if (tag === 'h3') {
        newEntity(textOf(node), pendingImg);
        pendingImg = null;
      } else if (tag === 'h4') {
        if (!sec) continue;
        const title = textOf(node);
        if (!ent && !node.querySelector('img')) continue; // subtítulo solto (ex.: "Campeões" dentro do Arena)
        if (!ent) newEntity(null, null);
        const img = node.querySelector('img');
        group = { title, icon: img ? imgUrl(img.getAttribute('src')) : null, changes: [] };
        ent.groups.push(group);
      } else if (tag === 'blockquote') {
        const t = textOf(node);
        if (!t) continue;
        if (ent && !ent.context && !ent.groups.length) ent.context = t;
        else if (sec) sec.intro.push(t);
        else out.intro.push(t);
      } else if (tag === 'ul' || tag === 'ol') {
        const items = node.querySelectorAll('li').map((li) => textOf(li)).filter(Boolean);
        if (!sec) continue;
        if (!ent && !items.some((t) => t.includes('⇒'))) { sec.bullets.push(...items); continue; }
        const g = ensureGroup();
        g.changes.push(...items.map(parseChange));
      } else if (tag === 'p') {
        const img = node.querySelector('img');
        const t = textOf(node);
        if (img && !t) {
          const src = imgUrl(img.getAttribute('src'));
          const big = Number(img.getAttribute('width')) >= 600 || node.querySelector('.content-border');
          if (big && sec) sec.images.push(src);
          else pendingImg = src;
          continue;
        }
        const strong = node.querySelector('strong');
        if (strong && textOf(strong) === t && t.length < 40 && sec) { newEntity(t, null); continue; }
        if (t && sec) (ent && ent.groups.length ? ensureGroup().changes.push({ label: null, text: t, dir: null }) : sec.intro.push(t));
      } else if (tag === 'img') {
        const src = imgUrl(node.getAttribute('src'));
        if (src && sec) sec.images.push(src);
      } else if (tag === 'hr') {
        group = null;
      } else {
        visit(node);
      }
    }
  }
  visit(box);
  for (const s of out.sections) {
    s.entities = s.entities.filter((e) => e.name || e.groups.some((g) => g.changes.length));
    for (const e of s.entities) e.verdict = verdict(e);
    s.images = [...new Set(s.images.filter(Boolean))];
  }
  out.sections = out.sections.filter((s) => s.entities.length || s.bullets.length || s.intro.length || s.images.length);
  return out;
}

/** Página Next.js -> { title, date, body } (body = HTML das notas). */
function extractFromPage(pageHtml) {
  const m = String(pageHtml).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('formato da página mudou (sem __NEXT_DATA__)');
  const page = JSON.parse(m[1]).props.pageProps.page || {};
  const blades = page.blades || [];
  const rich = blades.find((b) => b.richText && /patch-notes-container/.test(b.richText.body || ''));
  if (!rich) throw new Error('formato da página mudou (sem as notas)');
  const head = blades.find((b) => b.type === 'articleMasthead') || {};
  const date = (JSON.stringify(head).match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/) || [null])[0];
  return { title: head.title || page.title || null, date, body: rich.richText.body };
}

/** Versões das notas mais recentes (ex.: ['26.21', '26.20', …]) a partir da página da tag. */
/** { '26.21': 'https://…/patch-26-21-notes/' } a partir dos links da página de lista. */
function extractUrls(listHtml) {
  const out = {};
  for (const m of String(listHtml).matchAll(/href="(\/[a-z]{2}-[a-z]{2}\/news\/game-updates\/[a-z0-9-]*?patch-(\d{2})-(\d{1,2})-notes\/?)"/g)) {
    const v = `${m[2]}.${m[3]}`;
    if (!out[v]) out[v] = `${SITE}${m[1]}`;
  }
  return out;
}

function extractVersions(listHtml) {
  const seen = new Set();
  for (const m of String(listHtml).matchAll(/patch-(\d{2})-(\d{1,2})-notes/g)) seen.add(`${m[1]}.${m[2]}`);
  return [...seen].sort((a, b) => {
    const [a1, a2] = a.split('.').map(Number);
    const [b1, b2] = b.split('.').map(Number);
    return b1 - a1 || b2 - a2;
  });
}

function createPatchNotes({ cacheDir: baseDir, fetchImpl = fetch, resolve = () => null, log = () => {}, locale = 'pt-br' }) {
  const mem = new Map();
  let urls = {};
  const cacheDir = locale === 'pt-br' ? baseDir : path.join(baseDir, locale);
  const file = (name) => path.join(cacheDir, name);
  async function readCache(name, ttl) {
    try {
      const st = await fs.stat(file(name));
      if (ttl && Date.now() - st.mtimeMs > ttl) return null;
      return JSON.parse(await fs.readFile(file(name), 'utf8'));
    } catch { return null; }
  }
  async function writeCache(name, data) {
    try {
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(file(name), JSON.stringify(data));
    } catch { /* só memória */ }
  }
  async function get(url) {
    const res = await fetchImpl(url, { headers: { 'accept-language': locale } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }
  return {
    async list(force = false) {
      const cached = !force && (await readCache('list.json', 6 * 3600 * 1000));
      if (cached) return cached;
      try {
        const html = await get(listUrl(locale));
        urls = extractUrls(html);
        await writeCache('urls.json', urls);
        const versions = extractVersions(html).slice(0, 8);
        if (!versions.length) throw new Error('nenhuma atualização encontrada');
        await writeCache('list.json', versions);
        return versions;
      } catch (err) {
        log(`patch notes: ${err.message}`);
        const old = await readCache('list.json', 0);
        if (old) return old;
        throw err;
      }
    },
    async note(version) {
      if (!/^\d{2}\.\d{1,2}$/.test(version)) throw new Error('versão inválida');
      if (mem.has(version)) return mem.get(version);
      const name = `note-${version}.json`;
      let data = await readCache(name, 24 * 3600 * 1000);
      if (!data) {
        try {
          if (!Object.keys(urls).length) urls = (await readCache('urls.json', 0)) || {};
          let url = null;
          let html = null;
          for (const u of noteUrls(version, locale, urls[version])) {
            try { html = await get(u); url = u; break; } catch { /* próximo formato */ }
          }
          if (!html) throw new Error('notas não encontradas');
          const page = extractFromPage(html);
          data = { version, url, title: page.title, date: page.date, ...parseNotesHtml(page.body, resolve) };
          await writeCache(name, data);
        } catch (err) {
          log(`patch notes ${version}: ${err.message}`);
          data = await readCache(name, 0);
          if (!data) throw err;
        }
      }
      mem.set(version, data);
      return data;
    },
  };
}

module.exports = { createPatchNotes, parseNotesHtml, extractFromPage, extractVersions, extractUrls, parseChange, direction, imgUrl, noteUrl };
