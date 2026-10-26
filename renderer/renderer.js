const WEIGHTS = ['mastery', 'meta', 'counter', 'comp', 'synergy'];
const STAT_SHARD = { 5001: 'Vida', 5002: 'Armadura', 5003: 'RM', 5005: 'Vel. ataque', 5007: 'Redução de recarga', 5008: 'Força adaptativa', 5010: 'Vel. movimento', 5011: 'Vida', 5013: 'Tenacidade' };

const $ = (id) => document.getElementById(id);
const els = {
  dot: $('dot'), clock: $('clock'), gear: $('gear'), status: $('status'),
  waiting: $('waiting'), waitingText: $('waiting-text'),
  select: $('select'), game: $('game'), settings: $('settings'),
  turn: $('turn'), selRole: $('selRole'), picks: $('picks'), pickNotes: $('pickNotes'),
  guideTitle: $('guide-title'), guideWhy: $('guide-why'), guideBody: $('guide-body'), impMsg: $('imp-msg'),
  team: $('team'), selEnemies: $('selEnemies'), opggAllies: $('opggAllies'), opggEnemies: $('opggEnemies'),
  setRole: $('set-role'), setPool: $('set-pool'), setBlacklist: $('set-blacklist'), setMsg: $('set-msg'),
};

let version = null;
let lastState = null;
let currentRole = '';
let settingsOpen = false;
let settings = null;
let chosenId = null; // clique do usuário no carrossel
let lastMine = null; // campeão que você está hoverando/travou: quando muda, o guia volta a segui-lo
let variant = 0; // build escolhida (0 = mais jogada, 1 = alternativa)
let shownId = null;
let guide = null;

function portrait(champId, alt) {
  return version && champId
    ? h('img', { class: 'portrait', src: champIcon(version, champId), alt: alt || '' })
    : h('div', { class: 'portrait' });
}

function playerLabel(p) {
  if (!p.gameName) return 'Nome oculto';
  return p.tagLine ? `${p.gameName}#${p.tagLine}` : p.gameName;
}

let page = 'auto'; // 'auto' = segue a fase (início/champ select/partida); 'tierlist' | 'history' = abas fixas
let lastView = 'waiting';
const VIEWS = ['waiting', 'select', 'game', 'profile', 'tierlist', 'history', 'patches', 'settings'];
function showView(name) {
  if (name) lastView = name;
  const v = settingsOpen ? 'settings' : page !== 'auto' ? page : lastView;
  for (const id of VIEWS) $(id).hidden = v !== id;
  const navOf = { waiting: 'nav-home', select: 'nav-select', game: 'nav-game', profile: 'nav-profile', tierlist: 'nav-tier', history: 'nav-history', patches: 'nav-patches', settings: 'gear' };
  for (const [view, id] of Object.entries(navOf)) $(id).classList.toggle('on', v === view);
  $('nav-select').querySelector('.live').hidden = lastView !== 'select';
  $('nav-game').querySelector('.live').hidden = lastView !== 'game';
}

/* ---------- champ select ---------- */

function slot(p) {
  const champName = p.champion ? p.champion.name : '';
  const known = p.position ? ROLE_LABEL[p.position] : '';
  const guess = !known && p.predicted ? `${ROLE_LABEL[p.predicted]}?` : '';
  const el = h('div', { class: `dp${p.isMe ? ' me' : ''}` },
    version && p.champion ? h('img', { src: champIcon(version, p.champion.id), alt: champName }) : h('span', { class: 'ph' }),
    h('span', { class: `dp-role${guess ? ' guess' : ''}` }, (p.position || p.predicted) ? roleImg(p.position || p.predicted, 'dp-ico') : '', document.createTextNode(guess ? '?' : '')));
  const flex = p.flex && p.flex.length ? ` · flex: ${p.flex.map((r) => ROLE_LABEL[r]).join('/')}` : '';
  el.title = [champName || 'Escolhendo…', p.isMe ? 'você' : playerLabel(p), guess ? `rota prevista (${p.confidence}%)${flex}` : known].filter(Boolean).join(' · ');
  return el;
}

function listRow({ rank, id, name, why, score, selected }) {
  return h('div', { class: `row-item${selected ? ' sel' : ''}` },
    h('span', { class: 'rk', text: rank }),
    version && id ? h('img', { class: 'ic', src: champIcon(version, id), alt: '' }) : h('span', { class: 'ic' }),
    h('div', { style: 'min-width:0' }, h('div', { class: 'nm', text: name }), h('div', { class: 'why', text: why })),
    h('span', { class: 'sc', text: score }));
}

/** Marca o campeão no cliente (sem travar). Não mexe se o seu pick já está travado. */
async function hoverInClient(id, name, kind) {
  const me = lastState && lastState.me;
  if (kind === 'pick' && me && me.locked) return;
  if (kind === 'ban' && lastState && lastState.action !== 'ban') return;
  const res = await window.overlay.hoverChampion(id, kind);
  els.impMsg.textContent = res.ok ? `${name} marcado no cliente${kind === 'ban' ? ' para banir' : ''} (falta travar).` : `Não consegui marcar ${name} no cliente: ${res.error}`;
}

function pickCard(c, selected, i = 0) {
  const card = listRow({ rank: String(i + 1), id: c.id, name: c.name, why: c.reasons.slice(0, 2).join(' · ') || 'Pelos seus dados', score: String(c.score), selected });
  card.title = `${c.blind ? `${c.blind.text}\n` : ''}${c.reasons.join(' · ')}\nClique para marcar no cliente`;
  if (c.blind && c.blind.level !== 'ok') {
    // selo de pick às cegas ao lado do nome
    const nm = card.querySelector('.nm');
    if (nm) nm.append(h('span', { class: `blind-tag ${c.blind.level}`, text: c.blind.level === 'safe' ? 'Seguro às cegas' : 'Arriscado às cegas' }));
  }
  card.addEventListener('click', () => {
    chosenId = c.id;
    if (lastState) renderSelect(lastState);
    hoverInClient(c.id, c.name, 'pick');
  });
  return card;
}

function renderGuide(state, picks) {
  const mine = state.me && state.me.champion;
  const mineId = mine ? mine.id : null;
  if (mineId !== lastMine) { lastMine = mineId; if (mineId) chosenId = null; }
  const pickId = chosenId || (mine && mine.id) || (picks.candidates[0] && picks.candidates[0].id) || null;
  const cand = picks.candidates.find((c) => c.id === pickId);

  if (!pickId) {
    $('guide-tabs').replaceChildren();
    els.guideTitle.textContent = 'Guia do campeão';
    els.guideWhy.textContent = 'Escolha um campeão para ver runas, feitiços e itens.';
    els.guideBody.replaceChildren();
    setImportEnabled(false);
    return;
  }
  const name = (cand && cand.name) || (mine && mine.id === pickId ? mine.name : pickId);
  els.guideTitle.textContent = name;
  els.guideWhy.textContent = cand ? cand.reasons.join(' · ') || 'seus dados de maestria' : '';
  $('guide-ico').replaceChildren(version ? h('img', { src: champIcon(version, pickId), alt: '' }) : '');

  if (pickId !== shownId) {
    shownId = pickId;
    guide = null;
    variant = 0;
    runePage = 0;
    imported.runes = false;
    imported.spells = false;
    els.impMsg.textContent = '';
    window.overlay.getGuide(pickId).then((g) => {
      if (shownId === pickId) { guide = g; drawGuide(); }
    });
  }
  // Inimigos novos (ou rota prevista mudou): recarrega o guia para o "Matchup contra" listar todos
  // e o modo automático achar o oponente de rota.
  const enemyKey = (state.enemies || []).filter((e) => e.champion).map((e) => `${e.champion.id}:${e.position || e.predicted || ''}`).join(',');
  if (enemyKey !== guideEnemyKey) {
    guideEnemyKey = enemyKey;
    if (guide) {
      const id = shownId;
      window.overlay.getGuide(id).then((g) => { if (shownId === id && g) { guide = g; drawGuide(); } });
    }
  }
  drawGuide();
}
let guideEnemyKey = '';

function setImportEnabled(on) {
  for (const id of ['imp-all', 'imp-items']) $(id).disabled = !on;
}

function iconRow(label, ids, names) {
  const row = h('div', { class: 'g-row' }, h('span', { class: 'g-label', text: label }));
  ids.forEach((id, i) => row.append(h('img', { class: 'g-item', src: itemIcon(version, id), title: names[i], alt: names[i] })));
  return row;
}

const ddImg = (path) => `${DD}/cdn/img/${path}`;
const ddVerImg = (path) => `${DD}/cdn/${version}/img/${path}`;
const imported = { runes: false, spells: false };
let runePage = 0;

/** Abas das páginas de runas, cada uma com pick % e win % do OP.GG. */
function runePageTabs(pages, current = runePage, onPick = (i) => { runePage = i; imported.runes = false; drawGuide(); }) {
  if (!pages || pages.length < 2) return null;
  return h('div', { class: 'rp-tabs' }, ...pages.map((p, i) => {
    const st = p.stats || {};
    const b = h('button', { class: `rp-tab${i === current ? ' on' : ''}`, type: 'button' },
      h('b', { text: p.view.perks[0] ? p.view.perks[0].name : p.label }),
      h('span', { text: [st.pickRate ? `${Math.round(st.pickRate * 100)}% pick` : null, st.winRate ? `${(st.winRate * 100).toFixed(1)}% WR` : null].filter(Boolean).join(' · ') || p.label }));
    b.title = `${p.view.primaryStyleName} + ${p.view.subStyleName}${st.games ? ` · ${st.games.toLocaleString('pt-BR')} partidas` : ''}${st.tier ? ` · ${st.tier}` : ''}`;
    b.addEventListener('click', () => onPick(i));
    return b;
  }));
}

/** <img> que vira texto se o ícone não existir. */
function icon(src, cls, title, fallback) {
  const img = h('img', { class: cls, src, title, alt: title });
  img.addEventListener('error', () => img.replaceWith(h('span', { class: `${cls} miss`, title, text: fallback || title.slice(0, 2) })));
  return img;
}

function badge(what) {
  const b = h('button', { class: `badge${imported[what] ? ' on' : ''}`, text: imported[what] ? '✓ Importado' : 'Importar' });
  b.addEventListener('click', () => doImport(what));
  return b;
}

function head(title, what) {
  return h('div', { class: 'lbl' }, h('span', { text: title }), what ? badge(what) : null);
}

function runeRow(row, cls) {
  return h('div', { class: 'r-row' }, ...row.map((r) => {
    const el = icon(ddImg(r.icon), `${cls}${r.selected ? ' sel' : ''}`, '');
    tipOn(el, r.name, r.desc);
    return el;
  }));
}

/* tooltip próprio (nome + descrição), como nos apps de build */
const tipBox = h('div', { class: 'tipbox', hidden: '' });
document.body.append(tipBox);
function tipOn(el, title, desc) {
  el.addEventListener('mouseenter', () => {
    tipBox.replaceChildren(h('b', { text: title }), desc ? h('div', { text: desc }) : null);
    tipBox.hidden = false;
    const r = el.getBoundingClientRect();
    const w = 260;
    tipBox.style.left = `${Math.min(window.innerWidth - w - 10, Math.max(10, r.left + r.width / 2 - w / 2))}px`;
    tipBox.style.top = `${r.bottom + 8}px`;
  });
  el.addEventListener('mouseleave', () => { tipBox.hidden = true; });
}

function drawRunes(t) {
  const left = h('div', { class: 'tree' },
    runeRow(t.primaryStyles, 'r-style'),
    ...t.primary.map((row, i) => runeRow(row, i === 0 ? 'r-key' : 'r-rune')));
  const right = h('div', { class: 'tree' },
    runeRow(t.secondaryStyles, 'r-style'),
    ...t.secondary.map((row) => runeRow(row, 'r-rune')),
    h('div', { class: 'shards' }, ...t.shards.map((row) => runeRow(row, 'r-shard'))));
  return h('div', { class: 'trees' }, left, right);
}

/** Completa a ordem de skills até o nível 18 (R no 16, depois maximiza na ordem de prioridade). */
function skillOrder18(order) {
  const seq = order.slice(0, 18);
  const count = (k) => seq.filter((x) => x === k).length;
  const prio = ['Q', 'W', 'E'].sort((a, b) => count(b) - count(a) || order.indexOf(a) - order.indexOf(b));
  while (seq.length < 18) {
    const lvl = seq.length + 1;
    if ([6, 11, 16].includes(lvl) && count('R') < 3) seq.push('R');
    else seq.push(prio.find((k) => count(k) < 5) || 'R');
  }
  return seq;
}

function drawSkills(g) {
  const seq = skillOrder18(g.skills);
  const icons = g.skillIcons ? g.skillIcons.spells : [];
  const grid = h('div', { class: 'sk-grid' }, h('span'));
  for (let i = 1; i <= 18; i++) grid.append(h('span', { class: 'sk-lvl', text: String(i) }));
  ['Q', 'W', 'E', 'R'].forEach((key, k) => {
    const sp = icons[k];
    grid.append(sp ? icon(ddVerImg(sp.icon), 'sk-icon', `${key} · ${sp.name}`, key) : h('span', { class: 'sk-icon miss', text: key }));
    seq.forEach((x) => grid.append(h('span', { class: `sk-cell${x === key ? ` on s-${key}` : ''}`, text: x === key ? key : '' })));
  });
  return grid;
}

function drawSpells(g) {
  const flashD = settings && settings.flashKey === 'D';
  let [d, f] = g.spells;
  const isFlash = (s) => s && s.id === 4;
  if (isFlash(d) && !flashD) [d, f] = [f, d];
  if (isFlash(f) && flashD) [d, f] = [f, d];
  const spell = (s, key) => h('div', { class: 'sp' },
    s && s.key ? icon(ddVerImg(`spell/${s.key}.png`), 'sp-icon', s.name) : h('span', { class: 'sp-icon miss', text: '?' }),
    h('span', { class: 'kbd', text: key }));
  const swap = h('button', { class: 'swap', title: 'Trocar a tecla do Flash (D/F)', text: '⇄' });
  swap.addEventListener('click', toggleFlashKey);
  return h('div', { class: 'spells' }, spell(d, 'D'), swap, spell(f, 'F'));
}

function drawBuild(g) {
  const starter = h('div', { class: 'items' }, ...g.starterCounts.map((it) => h('div', { class: 'it' },
    icon(ddVerImg(`item/${it.id}.png`), 'it-icon', it.name), it.count > 1 ? h('span', { class: 'cnt', text: `x${it.count}` }) : null)));
  const full = h('div', { class: 'items full' }, ...g.fullBuild.map((it, i) => h('div', { class: 'it' },
    h('span', { class: 'num', text: String(i + 1) }), icon(ddVerImg(`item/${it.id}.png`), 'it-icon', it.name))));
  // Situacionais com o selo "Bom contra" e os inimigos que motivaram (estilo LoLTheory)
  const sit = (g.situational || []).length ? h('div', {}, head('Situacionais'), h('div', { class: 'sit-list' }, ...g.situational.map((it) => {
    const el = h('div', { class: 'sit' }, icon(ddVerImg(`item/${it.id}.png`), 'it-icon', '', ''),
      h('div', { class: 'sit-body' }, h('div', { class: 'sit-name', text: it.name }),
        goodTag(it.good || { key: 'meta', label: 'Alternativa do meta' }, it.vs, version)));
    tipOn(el, it.name, it.why);
    return el;
  }))) : null;
  return h('div', { class: 'build' },
    h('div', {}, head('Início'), starter),
    h('div', {}, head('Build'), full),
    sit);
}

function drawGuide() {
  if (!guide) {
    $('guide-tabs').replaceChildren();
    els.guideBody.replaceChildren(h('p', { class: 'muted', text: 'Carregando dados do OP.GG…' }));
    setImportEnabled(false);
    return;
  }
  const root = guide;
  const g = (root.variants && root.variants[variant] && root.variants[variant].guide) || root;
  if (root.error) {
    $('guide-tabs').replaceChildren();
    els.guideBody.replaceChildren(h('p', { class: 'muted', text: root.error }));
    setImportEnabled(false);
    return;
  }
  // abas: build geral x matchup (ou itens alternativos)
  $('guide-tabs').replaceChildren(...((root.variants || []).length > 1 ? root.variants.map((v, i) => {
    const b = h('button', { class: i === variant ? 'on' : '', type: 'button', text: v.label });
    b.title = v.sub || '';
    b.addEventListener('click', () => { variant = i; imported.runes = false; imported.spells = false; drawGuide(); });
    return b;
  }) : []));

  const parts = [];
  const sub = [];
  if (root.variants && root.variants[variant] && root.variants[variant].sub) sub.push(h('span', { text: root.variants[variant].sub }));
  if (root.opponents && root.opponents.length) {
    const sel = h('select', {},
      h('option', { value: 'auto', text: root.opponent && root.matchupMode === 'auto' ? `Automático (${root.opponent})` : 'Automático' }),
      ...root.opponents.map((o) => h('option', { value: o.id, text: o.name })),
      h('option', { value: 'none', text: 'Nenhum' }));
    sel.value = root.matchupMode || 'auto';
    sel.addEventListener('change', async () => {
      await window.overlay.setMatchup(sel.value);
      variant = sel.value === 'none' ? 0 : 1;
      guide = await window.overlay.getGuide(shownId);
      drawGuide();
    });
    sub.push(h('span', { class: 'spacer' }), h('span', { text: 'Matchup contra' }), sel);
    if (root.pending) sub.push(h('span', { text: root.pending }));
  }
  if (sub.length) parts.push(h('div', { class: 'g-sub' }, ...sub));
  if (root.roleNote) parts.push(h('div', { class: 'g-tip', text: root.roleNote }));
  if (g.matchup && g.matchup.tip) parts.push(h('div', { class: 'g-tip' }, h('b', { text: `vs ${g.matchup.vs}` }), document.createTextNode(g.matchup.tip)));
  if ((g.changes || []).length) {
    const KIND = { items: 'Itens', spells: 'Feitiços', runes: 'Runas', shards: 'Fragmento', skills: 'Habilidades' };
    parts.push(h('div', { class: 'g-changes' },
      h('div', { class: 'lbl' }, h('span', { text: `O que muda — ${(root.variants[variant] || {}).label || 'matchup'}` })),
      ...g.changes.map((c) => h('div', { class: `g-ch k-${c.kind}` },
        h('span', { class: 'g-ch-k', text: KIND[c.kind] || c.kind }),
        h('span', { class: 'g-ch-t', text: c.text.replace(/^(Itens|Feitiços|Runa principal|2ª árvore|Habilidades): /, (m) => (c.kind === 'runes' && m.startsWith('Runa') ? m : '')) }),
        h('span', { class: `g-ch-s ${c.source === 'OP.GG' ? 'src-op' : 'src-rule'}`, text: c.source === 'OP.GG' ? 'OP.GG' : 'regra do app', title: c.source === 'OP.GG' ? 'Dados do OP.GG para este confronto' : 'Regra do app (composição inimiga / matchup difícil)' })))));
  }

  const left = h('div', { class: 'g-sec' });
  const pages = root.runePages || [];
  const page = pages[runePage] || pages[0] || null;
  if (g.runesForMatchup && g.runeTree) {
    // runas ajustadas para o matchup (OP.GG do confronto ou regra própria): mostra só essa página
    left.append(head(`Runas · ${g.runes.primaryStyleName} + ${g.runes.subStyleName}`, 'runes'),
      h('p', { class: 'muted small rp-one', text: `Ajustadas para ${(root.variants[variant] || {}).label || 'o matchup'}` }), drawRunes(g.runeTree));
  } else if (page && page.runeTree) {
    const st = page.stats || {};
    left.append(head(`Runas · ${page.view.primaryStyleName} + ${page.view.subStyleName}`, 'runes'), runePageTabs(pages) || '');
    if (pages.length < 2 && (st.pickRate || st.winRate)) left.append(h('p', { class: 'muted small rp-one', text: `${Math.round((st.pickRate || 0) * 100)}% pick · ${((st.winRate || 0) * 100).toFixed(1)}% WR` }));
    left.append(drawRunes(page.runeTree));
  } else if (g.runeTree) left.append(head(`Runas · ${g.runes.primaryStyleName} + ${g.runes.subStyleName}`, 'runes'), drawRunes(g.runeTree));
  else if (g.runes) left.append(head('Runas', 'runes'), h('p', { class: 'muted', text: `${g.runes.primaryStyleName} + ${g.runes.subStyleName}` }));
  const right = h('div', { class: 'g-sec' });
  if (g.spells.length) right.append(head('Feitiços', 'spells'), drawSpells(g), h('div', { style: 'height:22px' }));
  right.append(drawBuild(g));
  parts.push(h('div', { class: 'g-grid' }, left, right));
  if (g.skills.length) {
    // ordem em que cada habilidade chega ao nível máximo (5)
    const cnt = {};
    const order = [];
    for (const x of skillOrder18(g.skills)) if (x !== 'R' && (cnt[x] = (cnt[x] || 0) + 1) === 5) order.push(x);
    for (const x of ['Q', 'W', 'E']) if (!order.includes(x)) order.push(x);
    const skillMu = (g.changes || []).some((c) => c.kind === 'skills');
    parts.push(h('div', { class: 'g-full' }, head(`Ordem de habilidades · ${order.slice(0, 3).join(' › ')}${skillMu ? ` · ajustada ${((root.variants[variant] || {}).label || '').toLowerCase()}` : ''}`), drawSkills(g)));
  }
  if (root.oppKit) parts.push(abilityBlock(root.oppKit, 'g-full'));
  parts.push(otpBlock());
  els.guideBody.replaceChildren(...parts);
  setImportEnabled(Boolean(g.runes || g.spells.length));
}

/** Recarga das habilidades do oponente (Meraki / Data Dragon). */
function abilityBlock(kit, cls) {
  return h('div', { class: cls },
    head(`Habilidades de ${kit.champion} · recarga do nível 1 ao máximo`),
    h('div', { class: 'abil' }, ...kit.abilities.map((a) => h('div', { class: 'abil-i' }, h('b', { text: a.key }), h('span', { class: 'nm', text: a.name }), h('span', { class: 'muted small', text: a.cd })))),
    kit.ult && kit.ult.cd ? h('p', { class: 'small', style: 'margin-top:8px', text: `Ult no rank ${kit.ult.rank}: ${kit.ult.cd} s de recarga (sem aceleração)` }) : null,
    h('p', { class: 'muted small', style: 'margin-top:6px', text: `Fonte: ${kit.source}` }));
}

/* one-tricks */
let otp = { id: null, data: null };
function otpBlock() {
  const box = h('div', { class: 'g-full', id: 'otp-box' });
  if (otp.id !== shownId) {
    otp = { id: shownId, data: null };
    const id = shownId;
    window.overlay.getOtp(id).then((d) => { if (otp.id === id) { otp.data = d; fillOtp(); } });
  }
  setTimeout(fillOtp, 0);
  return box;
}
function fillOtp() {
  const box = $('otp-box');
  if (!box) return;
  const d = otp.data;
  const rows = d && d.list && d.list.length ? d.list.map((p, idx) => {
    const b = p.build;
    const wr = p.games ? `${Math.round((p.wins / p.games) * 100)}% em ${p.games}` : '';
    const tier = p.tier ? `${p.tier[0]}${p.tier.slice(1).toLowerCase()}${p.division ? ` ${p.division}` : ''} · ${p.lp} PDL` : '';
    return h('div', { class: 'otp' },
      h('div', { style: 'min-width:0' }, h('div', { class: 'nm', text: `#${p.rank} ${p.riotId}` }), h('div', { class: 'why', text: [tier, wr].filter(Boolean).join(' · ') })),
      b ? h('div', { class: 'otp-build' },
        (() => {
          const btn = h('button', { class: 'badge', type: 'button', text: 'Importar' });
          btn.addEventListener('click', async () => {
            btn.textContent = '…';
            const r = await window.overlay.importOtp(otp.id, idx);
            btn.textContent = r.ok ? '✓ Importado' : 'Importar';
            btn.classList.toggle('on', r.ok);
            els.impMsg.textContent = r.ok ? `Build de ${p.riotId.split('#')[0]}: ${r.done.join(', ')} importados.${r.notes && r.notes.length ? ` (${r.notes[0]})` : ''}` : `Não consegui importar: ${r.error}`;
          });
          return btn;
        })(),
        b.keystoneIcon ? icon(ddImg(b.keystoneIcon), 'otp-rune', b.keystoneName) : null,
        ...b.spellKeys.map((k) => icon(ddVerImg(`spell/${k}.png`), 'otp-sp', k)),
        ...b.items.slice(0, 6).map((id) => icon(ddVerImg(`item/${id}.png`), 'otp-it', String(id), ''))) : h('span', { class: 'muted small', text: 'sem partida recente com ele' }));
  }) : [h('p', { class: 'muted small', text: d ? (d.error ? `Sem dados: ${d.error}` : 'Buscando os melhores jogadores…') : 'Buscando os melhores jogadores…' })];
  box.replaceChildren(head(`One-tricks · melhores do ranking${d && d.region ? ` (${String(d.region).toUpperCase()})` : ''} · última build`), ...rows);
}
window.overlay.onOtpUpdated((p) => {
  if (otp.id && p.championId === otp.id) window.overlay.getOtp(otp.id).then((d) => { otp.data = d; fillOtp(); });
});

function renderSelect(state) {
  version = state.assets.version;
  currentRole = state.myPosition || '';
  els.dot.className = 'dot ok';
  els.clock.textContent = '';

  const picks = (state.advice && state.advice.picks) || { candidates: [], notes: [] };
  els.selRole.textContent = state.myPosition ? ROLE_LABEL[state.myPosition] : 'rota não definida';
  const turnText = state.action === 'ban' ? 'Sua vez: banir' : state.action === 'pick' ? 'Sua vez: escolher' : '';
  els.turn.textContent = turnText;
  els.turn.hidden = !turnText;

  const selectedId = chosenId || (state.me && state.me.champion && state.me.champion.id) || (picks.candidates[0] && picks.candidates[0].id);
  els.picks.replaceChildren(...picks.candidates.map((c, i) => pickCard(c, c.id === selectedId, i)));
  els.pickNotes.replaceChildren(...picks.notes.map((n) => h('p', { text: n })));

  els.team.replaceChildren(...[state.me, ...state.allies].filter(Boolean).map((p) => slot(p)));
  els.selEnemies.replaceChildren(...state.enemies.map((p) => slot(p)));
  const flexes = state.enemies.filter((p) => p.flex && p.flex.length && p.champion).map((p) => `${p.champion.name} (${p.flex.map((r) => ROLE_LABEL[r]).join('/')})`);
  const guessed = state.enemies.some((p) => p.predicted);
  $('enemy-roles').textContent = [guessed ? 'Rotas inimigas com "?" são previsões' : '', flexes.length ? `Flex: ${flexes.join(', ')}` : ''].filter(Boolean).join(' · ');
  const opgg = state.opgg || {};
  els.opggAllies.disabled = !opgg.allies;
  els.opggEnemies.hidden = !opgg.enemies;

  const bans = (state.advice && state.advice.bans) || [];
  // visível durante a fase de bans até você banir (destaque quando é a sua vez)
  $('bans').hidden = !bans.length || (state.myBanDone && state.action !== 'ban');
  $('bans').classList.toggle('my-turn', state.action === 'ban');
  $('ban-row').replaceChildren(...bans.map((b, i) => {
    const row = listRow({ rank: String(i + 1), id: b.id, name: b.name, why: b.reasons.join(' · '), score: String(b.score) });
    row.title = 'Clique para marcar o ban no cliente';
    row.addEventListener('click', () => hoverInClient(b.id, b.name, 'ban'));
    return row;
  }));

  renderGuide(state, picks);
  showView('select');
}

/* ---------- em partida ---------- */

const TIER_PT = { IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro', PLATINUM: 'Platina', EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante' };
const fmtK = (g) => (Math.abs(g) >= 1000 ? `${(g / 1000).toFixed(1)}k` : String(g));
const signedK = (d) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${fmtK(Math.abs(d))}`;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function renderGame(state) {
  version = state.assets.version;
  els.dot.className = 'dot ok';
  els.clock.textContent = mmss(state.gameTime);
  $('who').textContent = `${state.me.champion} · nível ${state.me.level}`;
  $('gold').textContent = `· ${state.me.gold} g`;
  const adv = state.advice || {};
  renderBuyList($('buys'), adv.buys, version);
  renderExtras({ recall: $('recall'), matchup: $('matchup'), alerts: $('alerts') }, adv);

  // ouro cara a cara
  const gold = adv.gold;
  if (gold) {
    $('g-team').textContent = `Time ${signedK(gold.team.diff)}`;
    $('g-team').className = `small ${gold.team.diff >= 0 ? 'up' : 'down'}`;
    const max = Math.max(1000, ...gold.lanes.map((l) => Math.abs(l.diff)));
    const side = (p, cls) => h('div', { class: `g-side ${cls}${p && p.me ? ' me' : ''}` },
      p && p.champId ? h('img', { class: 'g-champ', src: champIcon(version, p.champId), alt: '' }) : h('span', { class: 'g-champ' }),
      h('span', { class: 'g-val', text: p ? fmtK(p.gold) : '—' }));
    $('g-rows').replaceChildren(...gold.lanes.map((l) => {
      const pct = Math.round((Math.abs(l.diff) / max) * 50);
      return h('div', { class: 'g-row' }, side(l.ally, 'ally'),
        h('div', { class: 'g-mid' }, h('div', { class: `g-diff ${l.diff >= 0 ? 'up' : 'down'}`, text: signedK(l.diff) }),
          h('div', { class: 'g-bar' }, h('div', { class: `g-fill ${l.diff >= 0 ? 'up' : 'down'}`, style: l.diff >= 0 ? `left:50%;width:${pct}%` : `right:50%;width:${pct}%` }))),
        side(l.enemy, 'enemy'));
    }));
  }

  // objetivos
  $('obj-timers').replaceChildren(...(adv.timers || []).map((t) => h('div', { class: `timer${t.in === 0 ? ' live' : ''}` },
    h('b', { text: t.label }), h('span', { text: t.in === 0 ? 'Vivo' : mmss(t.in) }))));
  if (!(adv.timers || []).length) $('obj-timers').replaceChildren(h('p', { class: 'muted', text: 'Timers só em Summoner\'s Rift.' }));

  // fases do matchup
  const ph = adv.phases;
  $('phase-vs').textContent = state.laneOpponent ? `vs ${state.laneOpponent.champion} · estimativa` : '';
  $('phases').replaceChildren(...(ph ? ph.map((p) => h('div', { class: `phase ${p.verdict}` }, h('b', { text: p.label }), h('span', { text: p.text })))
    : [h('p', { class: 'muted pad', text: 'Aparece quando o oponente de rota for conhecido.' })]));

  // metas
  const gl = adv.goals;
  $('goals-card').hidden = !gl;
  if (gl) {
    $('goals-aim').textContent = `ritmo de ${TIER_PT[gl.aimTier] || gl.aimTier} (um elo acima do seu)`;
    const cell = (label, now, target, ok, extra) => h('div', { class: 'goal' }, h('b', { text: label }), h('span', { class: `goal-v ${ok ? 'up' : 'down'}`, text: String(now) }), h('span', { class: 'muted small', text: `meta ${target}${extra || ''}` }));
    $('goals-body').replaceChildren(...(gl.cs ? [cell('CS/min', gl.cs.now, gl.cs.target, gl.cs.ok, ` · ${gl.cs.diff >= 0 ? '+' : ''}${gl.cs.diff} CS`)] : []), cell('Visão/min', gl.vision.now, gl.vision.target, gl.vision.ok));
  }

  // habilidades do oponente
  $('kit-card').hidden = !adv.oppKit;
  if (adv.oppKit) $('kit-body').replaceChildren(abilityBlock(adv.oppKit, ''));

  // lane scouting
  const sc = adv.scout || [];
  $('scout').replaceChildren(...(sc.length ? sc.map((x) => {
    const p = x.profile;
    const rank = p && p.tier ? `${p.tier[0]}${p.tier.slice(1).toLowerCase()} ${p.division || ''} · ${p.lp} PDL` : p ? 'Sem elo solo' : x.error ? `Sem dados: ${x.error}` : 'Carregando…';
    const wr = p && p.wins + p.losses ? `${Math.round((p.wins / (p.wins + p.losses)) * 100)}% em ${p.wins + p.losses} jogos` : '';
    const mains = p ? p.champs.slice(0, 3).map((c) => c.name).join(', ') : '';
    const on = x.onChamp ? `${x.onChamp.games} jogos de ${x.champion} (${Math.round((x.onChamp.wins / x.onChamp.games) * 100)}%)` : p ? `primeira vez de ${x.champion} na temporada?` : '';
    return h('div', { class: 'scout' },
      x.championId ? h('img', { class: 'ic', src: champIcon(version, x.championId), alt: '' }) : h('span', { class: 'ic' }),
      h('div', { style: 'min-width:0' },
        h('div', { class: 'nm', text: `${x.who} · ${x.riotId}` }),
        h('div', { class: 'why', text: [rank, wr].filter(Boolean).join(' · ') }),
        h('div', { class: 'why', text: [on, mains && `mais joga: ${mains}`].filter(Boolean).join(' · ') })),
      h('div', { class: 'scout-r' }, p && p.tier ? rankImg(p.tier) : '', p && p.hot ? h('span', { class: 'hot', text: 'em sequência' }) : ''));
  }) : [h('p', { class: 'muted pad', text: 'Sem oponente de rota ou caçador identificado (ou Riot ID oculto).' })]));

  $('enemies').replaceChildren(...state.enemies.map((e) => {
    const r = listRow({ rank: String(e.level), id: e.championId, name: e.champion, why: `${e.scores.kills}/${e.scores.deaths}/${e.scores.assists} · ${e.scores.cs || 0} CS`, score: e.isDead ? `☠ ${Math.ceil(e.respawnTimer)}s` : '' });
    if (e.isDead) r.classList.add('dead');
    return r;
  }));
  showView('game');
}

/* ---------- roteamento ---------- */

let lastPhase = '';
function render(state) {
  if (state.phase !== lastPhase) {
    // começou champ select ou partida: sai da tier list para não perder nada
    if (state.phase === 'champselect' || state.phase === 'ingame') page = 'auto';
    lastPhase = state.phase;
  }
  lastState = state;
  if (state.phase === 'ingame') return renderGame(state);
  if (state.phase === 'champselect') return renderSelect(state);
  chosenId = null;
  shownId = null;
  els.clock.textContent = '';
  if (state.phase === 'error') {
    els.waitingText.textContent = `Erro ao processar a partida: ${state.reason}`;
    els.dot.className = 'dot bad';
  } else {
    els.waitingText.textContent = state.client === 'open' ? 'Pronto para a próxima partida' : 'Abra o cliente do LoL';
    els.dot.className = state.client === 'open' ? 'dot ok' : 'dot warn';
  }
  renderHome(state);
  return showView('waiting');
}

/* ---------- barra de título ---------- */

hydrateIcons();
$('win-min').addEventListener('click', () => window.overlay.winMinimize());
$('win-max').addEventListener('click', () => window.overlay.winToggleMax());
$('win-close').addEventListener('click', () => window.overlay.winClose());
$('bar').addEventListener('dblclick', (e) => { if (!e.target.closest('button')) window.overlay.winToggleMax(); });
window.overlay.onMaximized((max) => {
  $('win-max').replaceChildren(svgIcon(max ? 'restore' : 'max'));
  $('win-max').title = max ? 'Restaurar' : 'Maximizar';
});

/* ---------- tela inicial ---------- */

const fmtPts = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} mi` : n >= 1e3 ? `${Math.round(n / 1e3)} mil` : String(n));
let homeKey = '';

function renderHome(state) {
  const home = state.home || {};
  const v = home.version || version;
  if (v) version = version || v;
  const chips = [
    [state.client === 'open' ? 'Cliente conectado' : 'Cliente fechado', state.client === 'open' ? 'ok' : 'warn'],
    [v ? `Patch ${v.split('.').slice(0, 2).join('.')}` : 'Carregando dados…', ''],
    [`v${appVersion || '…'}`, ''],
  ];
  $('home-chips').replaceChildren(...chips.map(([t, c]) => h('span', { class: `chip ${c}`, text: t })));

  const key = JSON.stringify([state.client, home.summoner && home.summoner.puuid, (home.top || []).length, (home.fit || []).length, v, home.elo]);
  if (key === homeKey) return; // evita redesenhar a cada 1,5 s
  homeKey = key;
  loadPatchCard(state);

  const s = home.summoner;
  $('home-hello').textContent = s && s.gameName ? `Olá, ${s.gameName}` : 'Bem-vindo';
  $('side-name').textContent = s && s.gameName ? s.gameName : 'Invocador';
  const rk = s && s.rank;
  $('side-sub').textContent = s ? (rk ? `${rk.tier[0]}${rk.tier.slice(1).toLowerCase()} ${rk.division || ''} · ${rk.lp} PDL` : `#${s.tagLine || ''}${s.level ? ` · nível ${s.level}` : ''}`) : state.client === 'open' ? 'Carregando…' : 'Cliente fechado';
  const old = document.getElementById('side-rank');
  if (old) old.remove();
  if (rk) $('side-me').append(Object.assign(rankImg(rk.tier, 'rank-img side-rank'), { id: 'side-rank', title: `${rk.wins}V ${rk.losses}D` }));
  $('side-avatar').replaceWith(v && s && s.iconId
    ? Object.assign(h('img', { id: 'side-avatar', class: 'avatar', src: `${DD}/cdn/${v}/img/profileicon/${s.iconId}.png`, alt: '' }))
    : h('div', { id: 'side-avatar', class: 'avatar' }));

  const champs = home.top || [];
  $('home-champs').replaceChildren(...(champs.length
    ? champs.map((c) => h('div', { class: 'hc' },
      v ? h('img', { src: champIcon(v, c.id), alt: c.name }) : h('span', { class: 'ic' }),
      h('div', {}, h('div', { class: 'hc-name', text: c.name }), h('div', { class: 'muted small', text: `Maestria ${c.level} · ${fmtPts(c.points)} pts` }))))
    : [h('p', { class: 'muted pad', text: state.client === 'open' ? (home.loading ? 'Carregando sua maestria…' : 'Sem dados de maestria.') : 'Abra o cliente do LoL para ver sua maestria.' })]));

  const roles = home.roles || [];
  const max = Math.max(1, ...roles.map((r) => r.games));
  $('home-roles').replaceChildren(...(roles.length
    ? [...roles.map((r) => h('div', { class: 'role-row' },
      h('span', { class: 'role-name' }, roleImg(r.role), document.createTextNode(ROLE_LABEL[r.role] || r.role)),
      h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${Math.round((r.games / max) * 100)}%` })),
      h('span', { class: 'muted small', text: `${r.games} jogos · ${Math.round(r.winRate * 100)}%` }))),
      h('p', { class: 'muted small', text: `Últimas ${home.gamesAnalyzed || 0} partidas de Summoner's Rift.` })]
    : [h('p', { class: 'muted', text: 'Calculado do seu histórico recente quando o cliente estiver aberto.' })]));

  // elo e evolução
  const el = home.elo;
  const rk2 = s && s.rank;
  $('elo-card').hidden = !(rk2 || (el && (el.lp || el.week)));
  if (!$('elo-card').hidden) {
    const sign = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)} PDL`;
    const lp = el && el.lp;
    const wk = el && el.week;
    const cell = (label, value, cls = '') => h('div', { class: 'elo-c' }, h('b', { text: label }), h('span', { class: `elo-v ${cls}`, text: value }));
    const champLine = (list) => list.map((c) => `${c.champion} ${c.wins}/${c.games}`).join(' · ') || '—';
    $('elo-body').replaceChildren(
      h('div', { class: 'elo-c elo-main' }, rk2 ? rankImg(rk2.tier, 'rank-big') : '', h('div', {},
        h('div', { class: 'strong', text: rk2 ? `${TIER_PT[rk2.tier] || rk2.tier} ${rk2.division || ''} · ${rk2.lp} PDL` : 'Sem elo' }),
        h('div', { class: 'muted small', text: rk2 ? `${rk2.wins}V ${rk2.losses}D · ${Math.round((rk2.wins / Math.max(1, rk2.wins + rk2.losses)) * 100)}%` : '' }))),
      cell('Hoje', lp ? sign(lp.today) : '—', lp ? (lp.today > 0 ? 'up' : lp.today < 0 ? 'down' : '') : ''),
      cell('7 dias', lp ? sign(lp.week) : '—', lp ? (lp.week > 0 ? 'up' : lp.week < 0 ? 'down' : '') : ''),
      cell('Sequência', wk && wk.streak ? `${wk.streak.count} ${wk.streak.wins ? 'vitória' : 'derrota'}${wk.streak.count > 1 ? 's' : ''}` : '—', wk && wk.streak ? (wk.streak.wins ? 'up' : 'down') : ''),
      cell('Semana', wk ? `${wk.weekWins}V ${wk.weekGames - wk.weekWins}D` : '—'),
      h('div', { class: 'elo-c elo-wide' }, h('b', { text: 'Melhores da semana' }), h('span', { class: 'up', text: wk ? champLine(wk.best) : '—' })),
      h('div', { class: 'elo-c elo-wide' }, h('b', { text: 'Piores da semana' }), h('span', { class: 'down', text: wk ? champLine(wk.worst) : '—' })));
  }

  const fit = home.fit || [];
  const fitSub = document.querySelector('#home-fit').previousElementSibling.querySelector('.muted');
  if (fitSub && home.mainRole) fitSub.textContent = `fortes no ${ROLE_LABEL[home.mainRole] || home.mainRole} (sua rota principal) e parecidos com os que você joga lá`;
  $('home-fit').replaceChildren(...(fit.length ? fit.map((c) => h('div', { class: 'fit' },
    v ? h('img', { class: 'ic', src: champIcon(v, c.id), alt: '' }) : h('span', { class: 'ic' }),
    h('div', { style: 'min-width:0' }, h('div', { class: 'nm', text: c.name }),
      h('div', { class: 'why', text: `${c.reason} · ${['', 'S', 'A'][c.tier] || ''} ${(c.winRate * 100).toFixed(1)}% WR` }))))
    : [h('p', { class: 'muted pad', text: state.client === 'open' ? 'Calculando com sua maestria e a tier list…' : 'Aparece quando o cliente estiver aberto.' })]));
}

let appVersion = '';
window.overlay.getDiagnostics().then((d) => { appVersion = d.version; homeKey = ''; if (lastState) render(lastState); }).catch(() => {});
$('home-test').addEventListener('click', () => window.overlay.previewOverlay());
$('home-settings').addEventListener('click', () => els.gear.click());

/* ---------- importar ---------- */

window.overlay.onAutoImport((r) => {
  els.impMsg.textContent = r.ok ? `✓ ${r.name}: ${r.done.join(', ')} importados automaticamente.` : `Importação automática de ${r.name} falhou: ${r.error}`;
  if (r.ok && r.championId === shownId) {
    imported.runes = true;
    imported.spells = true;
    drawGuide();
  }
});

async function doImport(what) {
  if (!shownId) return;
  els.impMsg.textContent = 'Importando…';
  const res = await window.overlay.importBuild(shownId, what, variant, runePage);
  els.impMsg.textContent = res.ok ? `Importado: ${res.done.join(' e ')}.` : `Não consegui importar: ${res.error}`;
  if (res.ok) {
    if (res.done.includes('runas')) imported.runes = true;
    if (res.done.includes('feitiços')) imported.spells = true;
    drawGuide();
  }
}
$('imp-all').addEventListener('click', () => doImport('both'));
$('imp-items').addEventListener('click', () => doImport('items'));

/* ---------- configurações ---------- */

const splitList = (text) => text.split(',').map((s) => s.trim()).filter(Boolean);

function fillRoleFields() {
  els.setPool.value = (settings.picker.pool[els.setRole.value] || []).join(', ');
}

const OVERLAYS = [
  ['buys', 'Compras · IA', 'As 3 próximas compras com o motivo, o ouro que falta e o aviso de voltar à base.'],
  ['info', 'Rota', 'Quem é mais forte em cada fase, scouting do oponente e do caçador, dica do matchup e alertas de itens inimigos.'],
  ['gold', 'Ouro cara a cara', 'Diferença de ouro (valor dos itens) de cada rota e do time.'],
  ['timers', 'Timers', 'Dragão, arauto e barão; clique nos feitiços inimigos (ou Ctrl+Shift+1…5) para cronometrar o Flash.'],
  ['kit', 'Habilidades do oponente', 'Recarga de Q/W/E/R do oponente de rota e da ult no nível atual dele.'],
  ['goals', 'Metas da partida', 'CS/min e visão/min no ritmo do elo acima do seu, com quanto falta.'],
];
function fillOverlayList() {
  const en = (settings.overlay && settings.overlay.enabled) || {};
  $('ov-list').replaceChildren(...OVERLAYS.map(([key, name, desc]) => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = en[key] !== false;
    cb.addEventListener('change', async () => { settings = await window.overlay.setSettings({ overlay: { enabled: { [key]: cb.checked } } }); });
    const reset = h('button', { class: 'link', type: 'button', text: 'posição padrão' });
    reset.addEventListener('click', async () => { settings = await window.overlay.setSettings({ overlay: { panels: { [key]: null } } }); els.setMsg.textContent = `${name}: posição restaurada.`; });
    const prev = h('iframe', { class: 'ov-prev', src: `overlay.html?preview=${key}&v=${encodeURIComponent(version || '')}`, tabindex: '-1', title: name });
    return h('div', { class: 'ov-item' }, h('div', { class: 'ov-prev-wrap' }, prev),
      h('label', { class: 'ov-text' }, cb, h('div', {}, h('div', { class: 'strong', text: name }), h('div', { class: 'muted small', text: desc }))), reset);
  }));
}

function fillSettings() {
  fillOverlayList();
  for (const key of WEIGHTS) {
    const pct = Math.round(settings.picker.weights[key] * 100);
    $(`w-${key}`).value = pct;
    $(`o-${key}`).textContent = String(pct);
  }
  els.setRole.value = currentRole || els.setRole.value || 'middle';
  els.setBlacklist.value = settings.picker.blacklist.join(', ');
  $('set-remote').checked = settings.remoteData.enabled;
  $('set-accept').checked = settings.autoAccept === true;
  $('set-update').checked = settings.autoUpdate !== false;
  $('set-import').checked = settings.autoImport !== false;
  $('set-tier').value = settings.buildTier || 'EMERALD_PLUS';
  $('set-riotid').value = settings.myRiotId || '';
  $('set-flash').value = settings.flashKey || 'F';
  $('set-overlay-mode').value = (settings.overlay && settings.overlay.mode) || 'tab';
  $('set-discord').checked = settings.discordRpc === true;
  $('set-discord-id').value = settings.discordClientId || '';
  showDiscordStatus();
  fillRoleFields();
}

/** Status do Discord nas configurações (conectado / procurando o Discord / desligado). */
async function showDiscordStatus() {
  const d = await window.overlay.getDiagnostics().catch(() => ({}));
  const st = d.discord || 'off';
  $('discord-status').textContent = st === 'connected' ? '· conectado' : st === 'connecting' ? '· procurando o Discord aberto…' : '';
}

async function openSettings() {
  settings = await window.overlay.getSettings();
  settingsOpen = true;
  els.setMsg.textContent = '';
  fillSettings();
  showView(null);
}

function closeSettings() {
  settingsOpen = false;
  showView(null);
  if (lastState) render(lastState);
}

async function saveSettings() {
  const weights = Object.fromEntries(WEIGHTS.map((k) => [k, Number($(`w-${k}`).value) / 100]));
  settings = await window.overlay.setSettings({
    remoteData: { enabled: $('set-remote').checked },
    autoAccept: $('set-accept').checked,
    autoUpdate: $('set-update').checked,
    autoImport: $('set-import').checked,
    buildTier: $('set-tier').value,
    myRiotId: $('set-riotid').value.trim(),
    flashKey: $('set-flash').value,
    discordRpc: $('set-discord').checked,
    discordClientId: $('set-discord-id').value.trim(),
    overlay: { mode: $('set-overlay-mode').value },
    picker: {
      weights,
      pool: { [els.setRole.value]: splitList(els.setPool.value) },
      blacklist: splitList(els.setBlacklist.value),
    },
  });
  els.setMsg.textContent = settings.discordRpc && !settings.discordClientId ? 'Salvo. Falta o Application ID do Discord para ativar o status.' : 'Salvo.';
  showFlashKey();
  setTimeout(showDiscordStatus, 2500);
}

function showFlashKey() {
  if (guide) drawGuide();
  if (champView && champView.data) drawChamp();
}
async function toggleFlashKey() {
  settings = settings || (await window.overlay.getSettings());
  settings = await window.overlay.setSettings({ flashKey: settings.flashKey === 'D' ? 'F' : 'D' });
  imported.spells = false;
  showFlashKey();
  els.impMsg.textContent = `Flash agora no ${settings.flashKey}. Clique em Importar no Invocador para aplicar.`;
}
window.overlay.getSettings().then((s) => { settings = s; showFlashKey(); });

$('set-test').addEventListener('click', () => window.overlay.previewOverlay());
$('set-diag').addEventListener('click', async () => {
  const d = await window.overlay.getDiagnostics();
  const box = $('diag');
  const key = d.hook.loaded
    ? `ok${d.hook.lastKeyAgoMs === null ? ' (ainda não detectei nenhuma tecla: aperte uma)' : `, última tecla há ${Math.round(d.hook.lastKeyAgoMs / 1000)} s`} · TAB pressionado ${d.hook.tabPresses}×`
    : `FALHOU (${d.hook.error || 'não iniciado'}): overlay fica sempre visível`;
  box.replaceChildren(
    h('div', { text: `Versão ${d.version}` }),
    h('div', { text: `Monitoramento da tecla TAB (hook): ${key}` }),
    h('div', { text: `Leitor direto da tecla TAB: ${d.hook.poller} · TAB agora: ${d.tabDown ? 'pressionado' : 'solto'}` }),
    h('div', { text: `Live Client API do jogo: ${d.live.phase}${d.live.reason ? ` (${d.live.reason})` : ''}` }),
    h('div', { text: `Cliente do LoL: ${d.client}` }),
    h('div', { class: 'muted', text: `Log: ${d.logFile}` }),
    h('div', { text: `Overlay: ${d.overlay.visible ? 'visível' : 'oculto'} · modo ${d.overlay.mode}${d.overlay.bounds ? ` · tela ${d.overlay.bounds.width}×${d.overlay.bounds.height}` : ''}` }),
  );
  box.hidden = false;
});

/* ---------- atualização ---------- */

function showUpdate(u) {
  const btn = $('update-btn');
  btn.classList.toggle('primary', u.state === 'ready');
  btn.disabled = u.state === 'checking' || u.state === 'downloading';
  $('update-label').textContent = {
    checking: 'Procurando…',
    downloading: `Baixando ${u.version || ''} ${u.percent || 0}%`,
    ready: `Reiniciar e atualizar (${u.version})`,
    none: 'Atualizado ✓',
  }[u.state] || 'Procurar atualizações';
  btn.title = u.message || '';
  if (u.state === 'error' && u.message) els.status.textContent = u.message;
}
$('update-btn').addEventListener('click', async () => {
  const btn = $('update-btn');
  if ($('update-label').textContent.startsWith('Reiniciar')) return window.overlay.installUpdate();
  $('update-label').textContent = 'Procurando…';
  showUpdate(await window.overlay.checkUpdate());
});
$('set-update-now').addEventListener('click', async () => {
  els.setMsg.textContent = 'Verificando…';
  const u = await window.overlay.checkUpdate();
  els.setMsg.textContent = u.message || (u.state === 'downloading' ? `Baixando ${u.version}…` : u.state === 'ready' ? 'Atualização pronta.' : 'Verificação concluída.');
});
window.overlay.onUpdate(showUpdate);
window.overlay.getUpdate().then(showUpdate);

els.gear.addEventListener('click', () => (settingsOpen ? closeSettings() : openSettings()));
$('set-close').addEventListener('click', closeSettings);
$('set-save').addEventListener('click', saveSettings);
$('set-whatsnew').addEventListener('click', () => showWhatsNew(true));
$('set-move').addEventListener('click', () => window.overlay.toggleMoveMode());
$('set-folder').addEventListener('click', () => window.overlay.openDataFolder());
els.setRole.addEventListener('change', fillRoleFields);
for (const key of WEIGHTS) $(`w-${key}`).addEventListener('input', () => { $(`o-${key}`).textContent = $(`w-${key}`).value; });
els.opggAllies.addEventListener('click', () => window.overlay.openMultisearch('allies'));
els.opggEnemies.addEventListener('click', () => window.overlay.openMultisearch('enemies'));

window.overlay.onState(render);
window.overlay.onStatus((s) => { els.status.textContent = s.text; });
window.overlay.onGuideUpdated((p) => {
  if (shownId && (p.championId === shownId || p.championId === '*')) window.overlay.getGuide(shownId).then((g) => { guide = g; drawGuide(); });
});
window.overlay.ready();

/* ---------- tier list ---------- */

const TL_ROLES = [['all', 'Todas'], ['top', 'Topo'], ['jungle', 'Selva'], ['middle', 'Meio'], ['bottom', 'Atirador'], ['utility', 'Suporte']];
const TL_TIERS = [[1, 'S'], [2, 'A'], [3, 'B'], [4, 'C'], [5, 'D']];
let tl = null;
let tlRole = 'all';
let tlElo = 'EMERALD_PLUS';
const TL_ELO_PT = { ALL: 'Todos os elos', GOLD: 'Ouro', PLATINUM_PLUS: 'Platina+', EMERALD_PLUS: 'Esmeralda+', DIAMOND_PLUS: 'Diamante+', MASTER_PLUS: 'Mestre+', CHALLENGER: 'Desafiante' };
try { tlElo = localStorage.getItem('tlElo') || tlElo; } catch { /* sem storage */ }
const pc = (x) => `${(x * 100).toFixed(1)}%`;

function tlRoleButtons() {
  // Fora de Esmeralda+ a lista é montada campeão a campeão: uma rota por vez.
  if (tlElo !== 'EMERALD_PLUS' && tlRole === 'all') tlRole = (lastState && lastState.home && lastState.home.mainRole) || 'middle';
  $('tl-roles').replaceChildren(...TL_ROLES.filter(([k]) => k !== 'all' || tlElo === 'EMERALD_PLUS').map(([k, label]) => {
    const b = h('button', { class: `seg-btn${k === tlRole ? ' on' : ''}`, type: 'button', title: label });
    b.append(k === 'all' ? svgIcon('spark') : roleImg(k, 'seg-role'), h('span', { text: label }));
    b.addEventListener('click', () => { tlRole = k; tlRoleButtons(); if (tlElo === 'EMERALD_PLUS') drawTierList(); else { tl = null; drawTierList(); loadTierList(); } });
    return b;
  }));
}

function tlTile(r, showRole) {
  const v = (tl && tl.patch) || version;
  const delta = r.rankPrev ? r.rankPrev - r.rank : 0;
  const tile = h('div', { class: 'tl-tile' },
    h('div', { class: 'tl-ico' },
      v && r.id ? h('img', { src: champIcon(v, r.id), alt: r.name }) : h('span'),
      showRole ? roleImg(r.role, 'tl-role') : null),
    h('div', { class: 'tl-info' },
      h('div', { class: 'tl-name', text: r.name }),
      h('div', { class: 'tl-wr', text: pc(r.winRate) }),
      h('div', { class: 'tl-sub', text: `Pick ${pc(r.pickRate)} · Ban ${pc(r.banRate)}` })),
    delta ? h('span', { class: `tl-delta ${delta > 0 ? 'up' : 'down'}`, text: `${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}` }) : null);
  tile.title = `${r.name} · #${r.rank} na rota · ${r.games.toLocaleString('pt-BR')} partidas · KDA ${r.kda} · clique para ver build, counters e sinergias`;
  if (r.id) tile.addEventListener('click', () => openChamp(r.id, r.role));
  return tile;
}

function drawTierList() {
  const body = $('tl-body');
  if (!tl || !tl.data) {
    const msg = tl && tl.error ? `Não consegui carregar: ${tl.error}`
      : tl && tl.loading ? `Montando a tier list de ${TL_ELO_PT[tlElo]} (${tl.loading} campeões, ~30 s na primeira vez)…`
        : 'Carregando a tier list do OP.GG…';
    body.replaceChildren(h('section', { class: 'panel' }, h('p', { class: 'muted', text: msg })));
    return;
  }
  const meta = [`Patch ${String(tl.patch || '').split('.').slice(0, 2).join('.')}`, `${TL_ELO_PT[tl.tier] || 'Esmeralda+'} · Global`, 'OP.GG'];
  if (tl.loading) meta.push('atualizando…');
  if (tl.at) meta.push(`atualizada ${new Date(tl.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
  $('tl-meta').replaceChildren(...meta.map((t) => h('span', { class: 'chip', text: t })));

  const q = $('tl-search').value.trim().toLowerCase();
  const sort = $('tl-sort').value;
  let rows = [];
  for (const [role, list] of Object.entries(tl.data)) if (tlRole === 'all' || role === tlRole) rows.push(...list.map((r) => ({ ...r, role })));
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
  const order = (a, b) => (sort === 'tier' ? a.tier - b.tier || b.winRate - a.winRate : b[sort] - a[sort]);
  rows.sort(order);
  if (!rows.length) { body.replaceChildren(h('section', { class: 'panel' }, h('p', { class: 'muted', text: 'Nenhum campeão encontrado.' }))); return; }

  if (sort !== 'tier') {
    body.replaceChildren(h('section', { class: 'tl-group' }, h('div', { class: 'tl-grid' }, ...rows.map((r) => tlTile(r, tlRole === 'all')))));
    return;
  }
  body.replaceChildren(...TL_TIERS.map(([n, letter]) => {
    const list = rows.filter((r) => Math.min(5, Math.max(1, r.tier)) === n);
    if (!list.length) return null;
    return h('section', { class: `tl-group t${letter}` },
      h('div', { class: 'tl-rail' }, h('span', { class: 'tl-letter', text: letter })),
      h('div', { class: 'tl-grid' }, ...list.map((r) => tlTile(r, tlRole === 'all'))));
  }).filter(Boolean));
}

async function loadTierList(force = false) {
  const res = await window.overlay.getTierList(force, tlElo, tlRole);
  if (res.tier !== tlElo) return;
  tl = res;
  drawTierList();
}
window.overlay.onTierListUpdated(() => { if (page === 'tierlist') loadTierList(); });

/* ---------- página do campeão (aberta pela tier list) ---------- */

const ROLE_NAME = { top: 'Topo', jungle: 'Selva', middle: 'Meio', bottom: 'Atirador', utility: 'Suporte' };
let champView = null; // { id, role, data, runePage }

function openChamp(id, role) {
  champView = { id, role: role && role !== 'all' ? role : null, data: null, runePage: 0 };
  $('tl-main').hidden = true;
  $('tl-champ').hidden = false;
  $('content').scrollTop = 0;
  drawChamp();
  loadChamp();
}
function closeChamp() {
  champView = null;
  $('tl-champ').hidden = true;
  $('tl-main').hidden = false;
}
async function loadChamp() {
  const cv = champView;
  if (!cv) return;
  const d = await window.overlay.getChampDetail(cv.id, cv.role);
  if (champView !== cv) return;
  cv.data = d;
  if (d && d.role) cv.role = d.role;
  drawChamp();
}
window.overlay.onChampDetailUpdated((p) => { if (champView && p.id === champView.id) loadChamp(); });

/** Linha de campeão com WR (counters / sinergias); clicar abre a página dele. */
function champLine(c, role, good) {
  const v = version;
  const row = h('div', { class: `cd-line${c.id ? ' click' : ''}` },
    v && c.id ? h('img', { class: 'ic', src: champIcon(v, c.id), alt: '' }) : h('span', { class: 'ic' }),
    h('span', { class: 'nm', text: c.name }),
    h('span', { class: `cd-wr ${good ? 'good' : 'bad'}`, text: `${(c.winRate * 100).toFixed(1)}%` }),
    h('span', { class: 'muted small', text: `${(c.games || 0).toLocaleString('pt-BR')} jogos` }));
  if (c.small) row.title = 'Amostra pequena: menos de 100 partidas nesse confronto';
  if (c.id) row.addEventListener('click', () => openChamp(c.id, role));
  return row;
}

function drawChamp() {
  const box = $('tl-champ');
  const cv = champView;
  if (!cv) return;
  const d = cv.data;
  const back = h('button', { class: 'btn ghost', type: 'button', text: '← Tier list' });
  back.addEventListener('click', closeChamp);
  const name = d ? d.champion.name : '';
  const headL = h('div', { class: 'cd-head' },
    version ? h('img', { class: 'cd-ico', src: champIcon(version, cv.id), alt: '' }) : null,
    h('div', {}, h('div', { class: 'eyebrow', text: d && d.champion.title ? d.champion.title : 'Campeão' }), h('h1', { text: name || cv.id })));
  const chips = [];
  if (d && d.tier) chips.push(h('span', { class: 'chip', text: `Tier ${['', 'S', 'A', 'B', 'C', 'D'][d.tier] || d.tier}` }));
  if (d && d.winRate) chips.push(h('span', { class: 'chip', text: `${(d.winRate * (d.winRate <= 1 ? 100 : 1)).toFixed(1)}% WR` }));
  chips.push(h('span', { class: 'chip', text: 'OP.GG' }));
  const top = h('div', { class: 'page-head' }, h('div', { class: 'cd-top' }, back, headL), h('div', { class: 'chips' }, ...chips));

  const roles = (d && d.roles && d.roles.length ? d.roles : cv.role ? [cv.role] : []);
  const seg = roles.length > 1 ? h('div', { class: 'seg' }, ...roles.map((r) => {
    const b = h('button', { class: `seg-btn${r === cv.role ? ' on' : ''}`, type: 'button' }, roleImg(r, 'seg-role'), h('span', { text: ROLE_NAME[r] || r }));
    b.addEventListener('click', () => { if (r === cv.role) return; cv.role = r; cv.data = null; cv.runePage = 0; drawChamp(); loadChamp(); });
    return b;
  })) : null;

  if (!d || !d.guide) {
    const msg = d && d.error ? `Sem dados do OP.GG: ${d.error}` : 'Carregando a build do OP.GG…';
    box.replaceChildren(top, seg || '', h('section', { class: 'card' }, h('p', { class: 'muted pad', text: msg })));
    return;
  }
  const g = d.guide;
  const pages = d.runePages || [];
  const page = pages[cv.runePage] || pages[0] || null;

  // build: runas | feitiços + itens
  const left = h('div', { class: 'g-sec' });
  if (page && page.runeTree) {
    left.append(head(`Runas · ${page.view.primaryStyleName} + ${page.view.subStyleName}`),
      runePageTabs(pages, cv.runePage, (i) => { cv.runePage = i; drawChamp(); }) || '');
    const st = page.stats || {};
    if (pages.length < 2 && (st.pickRate || st.winRate)) left.append(h('p', { class: 'muted small rp-one', text: `${Math.round((st.pickRate || 0) * 100)}% pick · ${((st.winRate || 0) * 100).toFixed(1)}% WR` }));
    left.append(drawRunes(page.runeTree));
  }
  const right = h('div', { class: 'g-sec' });
  if (g.spells.length) right.append(head('Feitiços'), drawSpells(g), h('div', { style: 'height:22px' }));
  right.append(drawBuild(g));
  const msg = h('span', { class: 'muted small' });
  const imp = h('button', { class: 'btn primary', type: 'button', text: 'Importar runas e feitiços' });
  imp.addEventListener('click', async () => {
    msg.textContent = 'Importando…';
    const res = await window.overlay.importBuild(cv.id, 'both', 0, cv.runePage, cv.role);
    msg.textContent = res.ok ? `Importado: ${res.done.join(', ')}.` : `Não consegui importar: ${res.error}`;
  });
  const buildCard = h('section', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', { text: `Build · ${ROLE_NAME[cv.role] || ''}` }), h('span', { class: 'spacer' }), seg || ''),
    h('div', { class: 'g-grid' }, left, right),
    g.skills.length ? h('div', { class: 'g-full' }, head('Ordem de habilidades'), drawSkills(g)) : null,
    d.kit ? abilityBlock(d.kit, 'g-full') : null,
    h('div', { class: 'card-f' }, msg, imp));

  // counters e sinergias
  const list = (title, rows, good, empty) => h('section', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', { text: title })),
    rows && rows.length ? h('div', { class: 'cd-list' }, ...rows.map((c) => champLine(c, cv.role, good))) : h('p', { class: 'muted pad', text: empty }));
  const synTitle = `Melhores parceiros${d.partner ? ` · ${ROLE_NAME[d.partner]}` : ''}`;
  const synEmpty = d.synergyError ? `Não consegui carregar: ${d.synergyError}` : d.synergies ? 'Sem amostra suficiente.' : 'Carregando…';
  const side = h('div', { class: 'cd-side' },
    list('Perde para', d.losesTo, false, 'Sem dados de counters.'),
    list('Ganha de', d.beats, true, 'Sem dados de counters.'),
    list(synTitle, d.synergies, true, synEmpty));
  box.replaceChildren(top, h('div', { class: 'cd-grid' }, buildCard, side));
}

function goPage(p) {
  settingsOpen = false;
  page = p;
  showView(null);
  if (p === 'tierlist') { closeChamp(); tlRoleButtons(); loadTierList(); }
  if (p === 'history') loadHistory();
  if (p === 'patches') loadPatches();
  if (p === 'profile') loadProfile();
}
$('nav-tier').addEventListener('click', () => goPage('tierlist'));
$('nav-history').addEventListener('click', () => goPage('history'));
$('nav-patches').addEventListener('click', () => goPage('patches'));
$('nav-profile').addEventListener('click', () => goPage('profile'));
for (const id of ['nav-home', 'nav-select', 'nav-game']) $(id).addEventListener('click', () => goPage('auto'));

/* ---------- histórico / pós-partida ---------- */

let histSel = null;
let histItems = [];

/** Junta as partidas do OP.GG com as gravadas pelo app (que têm o gráfico de ouro minuto a minuto). */
function mergeHistory(opgg, local) {
  // Mesma partida gravada pelo app e no OP.GG: junta pelo campeão + KDA (o horário do OP.GG pode vir em outro fuso).
  const used = new Set();
  const kdaOf = (s) => `${s.kills}/${s.deaths}/${s.assists}`;
  const out = (opgg.list || []).filter((g) => g.me).map((g) => {
    const start = Date.parse(g.createdAt);
    const same = (l) => !used.has(l.id) && l.champion.name === g.me.champion;
    const loc = local.find((l) => same(l) && l.final && kdaOf(l.final) === kdaOf(g.me.stats) && Math.abs(l.at - start) < 16 * 3600 * 1000)
      || local.find((l) => same(l) && Math.abs((l.at - l.duration * 1000) - start) < 20 * 60 * 1000);
    if (loc) used.add(loc.id);
    return { key: `o:${g.id}`, kind: 'opgg', g, local: loc || null, at: loc ? loc.at - loc.duration * 1000 : start };
  });
  // partidas curtas sem resultado (remake) gravadas pelo app ficam de fora
  for (const l of local) if (!used.has(l.id) && !(l.duration < 330 && !l.result)) out.push({ key: `l:${l.id}`, kind: 'local', local: l, at: l.at });
  return out.sort((a, b) => b.at - a.at);
}

const TYPE_PT = { SOLORANKED: 'Ranqueada solo', FLEXRANKED: 'Flex', NORMAL: 'Normal', ARAM: 'ARAM' };

async function loadHistory(force = false) {
  const [opgg, local] = await Promise.all([window.overlay.opggMatches(force), window.overlay.listHistory()]);
  $('hist-who').textContent = opgg.riotId ? `${opgg.riotId} · OP.GG${opgg.error ? ` (${opgg.error})` : ''}` : opgg.error || '';
  histItems = mergeHistory(opgg, local);
  $('hist-list').replaceChildren(...(histItems.length ? histItems.map((it) => {
    const g = it.g;
    const me = g ? g.me : null;
    const win = g ? me.stats.result === 'WIN' : it.local.result === 'Win';
    const known = g ? Boolean(me.stats.result) : Boolean(it.local.result);
    const champ = g ? me.champion : it.local.champion.name;
    const id = g ? me.id : it.local.champion.id;
    const kda = g ? `${me.stats.kills}/${me.stats.deaths}/${me.stats.assists}` : `${it.local.final.kills}/${it.local.final.deaths}/${it.local.final.assists}`;
    const dur = g ? g.duration : it.local.duration;
    const sub = [kda, mmss(dur), g ? TYPE_PT[g.type] || g.type : 'gravada pelo app', new Date(it.at).toLocaleDateString('pt-BR')].join(' · ');
    const row = h('div', { class: `row-item${it.key === histSel ? ' sel' : ''}` },
      h('span', { class: `res ${known ? (win ? 'win' : 'lose') : ''}`, text: known ? (win ? 'V' : 'D') : '–' }),
      version && id ? h('img', { class: 'ic', src: champIcon(version, id), alt: '' }) : h('span', { class: 'ic' }),
      h('div', { style: 'min-width:0' }, h('div', { class: 'nm', text: champ }), h('div', { class: 'why', text: sub })),
      h('span', { class: 'why', text: g && me.stats.opScore ? `${me.stats.opScore}` : '' }));
    row.addEventListener('click', () => { histSel = it.key; drawHistList(); showHistoryItem(it); });
    return row;
  }) : [h('p', { class: 'muted pad', text: opgg.error || 'Nenhuma partida encontrada.' })]));
  if (!histSel && histItems[0]) { histSel = histItems[0].key; showHistoryItem(histItems[0]); }
  drawHistList();
}
function drawHistList() {
  [...$('hist-list').children].forEach((el, i) => el.classList && histItems[i] && el.classList.toggle('sel', histItems[i].key === histSel));
}
$('hist-refresh').addEventListener('click', () => loadHistory(true));
window.overlay.onMatchesUpdated(() => { if (page === 'history') loadHistory(); });

/** Linha "metas da partida" no pós-partida: bateu ou não o ritmo do elo acima. */
function goalsLine(g) {
  if (!g) return null;
  const part = (label, x) => (x ? h('span', { class: x.now >= x.target ? 'up' : 'down', text: `${label} ${x.now} (meta ${x.target}) ${x.now >= x.target ? '✓' : '✗'}` }) : null);
  return h('div', { class: 'g-sub' }, h('span', { text: `Metas no ritmo de ${TIER_PT[g.aimTier] || g.aimTier}:` }), part('CS/min', g.cs), part('Visão/min', g.vision));
}

function scoreChart(timeline) {
  if (!timeline || timeline.length < 2) return h('p', { class: 'muted', text: 'Sem linha do tempo para esta partida.' });
  const W = 600; const H = 120; const pad = 6;
  const maxT = timeline[timeline.length - 1][0] || 1;
  const vals = timeline.map((p) => p[1]);
  const lo = Math.min(...vals) - 0.3; const hi = Math.max(...vals) + 0.3;
  const x = (t) => pad + (t / maxT) * (W - pad * 2);
  const y = (v) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad * 2);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', timeline.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' '));
  p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#f0587c'); p.setAttribute('stroke-width', '2'); p.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(p);
  return h('div', {}, svg, h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:#f0587c' }), document.createTextNode('OP Score ao longo da partida')),
    h('span', { text: `de ${vals[0]} a ${vals[vals.length - 1]}` })));
}

const GRADE_CLS = (g) => (String(g).startsWith('S') ? 's' : String(g)[0].toLowerCase());

/** Nota geral + nota por área + "foco para a próxima" (a pior área, com dica). */
function gradeBlock(gr) {
  if (!gr) return null;
  return h('div', { class: 'gr' },
    h('div', { class: `gr-big g-${GRADE_CLS(gr.grade)}` }, h('b', { text: gr.grade }), h('span', { text: `nota ${gr.overall}` })),
    h('div', { class: 'gr-areas' }, ...gr.areas.map((a) => h('div', { class: 'gr-a' },
      h('div', { class: 'gr-ah' }, h('span', { text: a.label }), h('b', { class: `g-${GRADE_CLS(a.grade)}`, text: a.grade })),
      h('div', { class: 'gr-bar' }, h('div', { class: `g-${GRADE_CLS(a.grade)}`, style: `width:${a.score}%` })),
      h('div', { class: 'muted small', text: a.text })))),
    gr.focus ? h('div', { class: 'gr-focus' }, h('b', { text: `Foco para a próxima: ${gr.focus.label}` }), h('span', { text: gr.focus.tip })) : null,
    h('div', { class: 'muted small gr-note', text: `Comparado com o ritmo de ${TIER_PT[gr.aimTier] || gr.aimTier} (um elo acima do seu).` }));
}

/** Placar dos 10 jogadores, com barra de dano e itens. */
function scoreboard(detail) {
  const all = detail.teams.flatMap((t) => t.players);
  const maxDmg = Math.max(1, ...all.map((p) => p.stats.damage || 0));
  const team = (t) => h('div', { class: `sb-team ${t.win ? 'win' : 'lose'}` },
    h('div', { class: 'sb-th' }, h('b', { text: t.win ? 'Vitória' : 'Derrota' }), h('span', { class: 'muted small', text: `${t.kills} abates · ${fmtK(t.gold)} de ouro` })),
    ...t.players.map((p) => h('div', { class: `sb-row${p.target ? ' me' : ''}` },
      version && p.id ? h('img', { class: 'ic', src: champIcon(version, p.id), alt: '' }) : h('span', { class: 'ic' }),
      h('div', { class: 'sb-name' }, h('b', { text: p.champion }), h('span', { class: 'muted small', text: (p.name || '').split('#')[0] })),
      h('span', { class: 'sb-kda', text: `${p.stats.kills}/${p.stats.deaths}/${p.stats.assists}` }),
      h('span', { class: 'muted small', text: `${p.stats.cs} CS` }),
      h('div', { class: 'sb-dmg', title: `${(p.stats.damage || 0).toLocaleString('pt-BR')} de dano` }, h('div', { style: `width:${Math.round(((p.stats.damage || 0) / maxDmg) * 100)}%` }), h('span', { text: fmtK(p.stats.damage || 0) })),
      h('div', { class: 'sb-items' }, ...p.items.slice(0, 7).map((id) => icon(`${DD}/cdn/${version}/img/item/${id}.png`, 'sb-it', String(id), ''))))));
  return h('div', { class: 'sb' }, ...detail.teams.map(team));
}

async function showHistoryItem(it) {
  if (it.kind === 'local') return showHistory(it.local.id);
  const box = $('hist-detail');
  box.replaceChildren(h('p', { class: 'muted pad', text: 'Carregando a partida no OP.GG…' }));
  const res = await window.overlay.opggReview(it.g.id, it.g.createdAt);
  if (histSel !== it.key) return;
  if (!res.ok) { box.replaceChildren(h('p', { class: 'muted pad', text: `Não consegui abrir a partida: ${res.error}` })); return; }
  const r = res.review;
  if (!r) { box.replaceChildren(h('p', { class: 'muted pad', text: 'Você não foi encontrado nesta partida.' })); return; }
  const me = r.me; const o = r.opp; const s = me.stats;
  const min = Math.max(1, res.detail.duration / 60);
  const win = s.result === 'WIN';
  const cmp = (label, a, b, fmt = (v) => fmtK(v), higherIsBetter = true) => {
    const better = a === b ? '' : (a > b) === higherIsBetter ? 'up' : 'down';
    return h('div', { class: 'cmp-row' }, h('span', { class: 'muted', text: label }), h('b', { class: better, text: fmt(a) }), h('span', { text: o ? fmt(b) : '—' }));
  };
  const items = (list) => h('div', { class: 'items' }, ...list.filter(Boolean).map((id) => icon(`${DD}/cdn/${version}/img/item/${id}.png`, 'it-icon', String(id), '')));
  const t = r.teams;
  const point = (p) => h('div', { class: 'h-point' }, h('b', { text: p.title }), h('span', { text: p.text }));
  box.replaceChildren(
    h('div', { class: 'card-h' },
      h('h2', { text: `${me.champion}${o ? ` vs ${o.champion}` : ''}` }),
      h('span', { class: `res ${win ? 'win' : 'lose'}`, text: win ? 'Vitória' : 'Derrota' }),
      h('span', { class: 'muted small', text: `${TYPE_PT[res.detail.type] || res.detail.type} · ${mmss(res.detail.duration)} · OP Score ${s.opScore} (${s.opRank}º)` })),
    h('div', { class: 'h-stats' },
      h('div', { class: 'h-stat' }, h('b', { text: `${s.kills}/${s.deaths}/${s.assists}` }), h('span', { class: 'muted small', text: 'KDA' })),
      h('div', { class: 'h-stat' }, h('b', { text: (s.cs / min).toFixed(1) }), h('span', { class: 'muted small', text: `CS/min (${s.cs})` })),
      h('div', { class: 'h-stat' }, h('b', { text: fmtK(s.damage) }), h('span', { class: 'muted small', text: 'dano em campeões' })),
      h('div', { class: 'h-stat' }, h('b', { text: t.mine && t.mine.kills ? `${Math.round(((s.kills + s.assists) / t.mine.kills) * 100)}%` : '–' }), h('span', { class: 'muted small', text: 'participação' }))),
    goalsLine(r.goals),
    gradeBlock(r.grades),
    h('div', { class: 'h-cols' },
      h('div', { class: 'h-col' }, h('div', { class: 'lbl' }, h('span', { text: o ? `Você x ${o.champion}` : 'Você' })),
        h('div', { class: 'cmp-row head' }, h('span'), h('span', { class: 'muted small', text: 'você' }), h('span', { class: 'muted small', text: o ? o.champion : '' })),
        cmp('Dano', s.damage, o ? o.stats.damage : 0),
        cmp('Ouro', s.gold, o ? o.stats.gold : 0),
        cmp('CS', s.cs, o ? o.stats.cs : 0, String),
        cmp('Sentinelas', s.wards, o ? o.stats.wards : 0, String),
        cmp('Controle', s.controlWards, o ? o.stats.controlWards : 0, String),
        cmp('Mortes', s.deaths, o ? o.stats.deaths : 0, String, false),
        cmp('Dano recebido', s.taken, o ? o.stats.taken : 0, (v) => fmtK(v), false)),
      h('div', { class: 'h-col' }, h('div', { class: 'lbl' }, h('span', { text: 'Objetivos · seu time x inimigo' })),
        ...(t.mine && t.enemy ? [['Abates', 'kills'], ['Dragões', 'dragons'], ['Barões', 'barons'], ['Torres', 'towers'], ['Vastilarvas', 'grubs'], ['Arautos', 'heralds']]
          .map(([label, key]) => cmp(label, t.mine[key], t.enemy[key], String)) : []),
        h('div', { class: 'lbl', style: 'margin-top:14px' }, h('span', { text: 'Seus itens' })), items(me.items),
        o ? h('div', { class: 'lbl', style: 'margin-top:12px' }, h('span', { text: `Itens de ${o.champion}` })) : null, o ? items(o.items) : null)),
    h('div', { class: 'h-sb' }, h('div', { class: 'lbl' }, h('span', { text: 'Placar da partida' })), scoreboard(res.detail)),
    h('div', { class: 'h-chart' }, it.local ? goldChart(it.local.samples || []) : scoreChart(it.g.me.stats.timeline)),
    h('div', { class: 'h-cols' },
      h('div', { class: 'h-col' }, h('div', { class: 'lbl' }, h('span', { class: 'up', text: 'O que ajudou' })),
        ...(r.good.length ? r.good.map(point) : [h('p', { class: 'muted small', text: 'Nada que se destacou.' })])),
      h('div', { class: 'h-col' }, h('div', { class: 'lbl' }, h('span', { class: 'down', text: 'O que prejudicou' })),
        ...(r.bad.length ? r.bad.map(point) : [h('p', { class: 'muted small', text: 'Nenhum problema claro.' })]))));
}

function goldChart(samples) {
  const W = 600; const H = 150; const pad = 6;
  const pts = samples.filter((s) => typeof s.team === 'number');
  if (pts.length < 2) return h('p', { class: 'muted', text: 'Poucos dados de ouro nesta partida.' });
  const maxT = pts[pts.length - 1].t || 1;
  const maxV = Math.max(1000, ...pts.map((s) => Math.abs(s.team)), ...pts.map((s) => Math.abs(s.lane || 0)));
  const x = (t) => pad + (t / maxT) * (W - pad * 2);
  const y = (v) => H / 2 - (v / maxV) * (H / 2 - pad);
  const path = (key) => pts.filter((s) => s[key] !== null && s[key] !== undefined).map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s[key]).toFixed(1)}`).join(' ');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const line = (d, color, w = 2, dash = '') => { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', color); p.setAttribute('stroke-width', w); if (dash) p.setAttribute('stroke-dasharray', dash); p.setAttribute('vector-effect', 'non-scaling-stroke'); svg.append(p); };
  line(`M0,${H / 2} L${W},${H / 2}`, '#2e3038', 1, '4 4');
  line(path('team'), '#f0587c', 2);
  line(path('lane'), '#8b8d98', 1.5);
  return h('div', {}, svg, h('div', { class: 'legend' },
    h('span', {}, h('i', { style: 'background:#f0587c' }), document.createTextNode('Ouro do time (itens)')),
    h('span', {}, h('i', { style: 'background:#8b8d98' }), document.createTextNode('Sua rota')),
    h('span', { text: `escala ±${fmtK(maxV)}` })));
}

async function showHistory(id) {
  const r = await window.overlay.getHistory(id);
  const box = $('hist-detail');
  if (!r) { box.replaceChildren(h('p', { class: 'muted pad', text: 'Partida não encontrada.' })); return; }
  const f = r.final;
  const min = Math.max(1, r.duration / 60);
  const point = (p) => h('div', { class: 'h-point' }, h('b', { text: p.title }), h('span', { text: p.text }));
  box.replaceChildren(
    h('div', { class: 'card-h' }, h('h2', { text: `${r.champion.name}${r.opponent ? ` vs ${r.opponent}` : ''}` }),
      h('span', { class: `res ${r.result === 'Win' ? 'win' : r.result === 'Lose' ? 'lose' : ''}`, text: r.result === 'Win' ? 'Vitória' : r.result === 'Lose' ? 'Derrota' : 'Resultado desconhecido' }),
      h('span', { class: 'muted small', text: `${mmss(r.duration)} · ${new Date(r.at).toLocaleString('pt-BR')}` })),
    h('div', { class: 'h-stats' },
      h('div', { class: 'h-stat' }, h('b', { text: `${f.kills}/${f.deaths}/${f.assists}` }), h('span', { class: 'muted small', text: 'KDA' })),
      h('div', { class: 'h-stat' }, h('b', { text: (f.cs / min).toFixed(1) }), h('span', { class: 'muted small', text: `CS/min (${f.cs})` })),
      h('div', { class: 'h-stat' }, h('b', { text: r.teamKills ? `${Math.round(((f.kills + f.assists) / r.teamKills) * 100)}%` : '–' }), h('span', { class: 'muted small', text: 'participação' })),
      h('div', { class: 'h-stat' }, h('b', { text: String(Math.round(f.wards || 0)) }), h('span', { class: 'muted small', text: 'placar de visão' }))),
    goalsLine(r.goals),
    gradeBlock(r.grades),
    h('div', { class: 'h-chart' }, goldChart(r.samples || [])),
    h('div', { class: 'h-cols' },
      h('div', { class: 'h-col' }, h('div', { class: 'lbl' }, h('span', { class: 'up', text: 'O que ajudou' })),
        ...(r.analysis.good.length ? r.analysis.good.map(point) : [h('p', { class: 'muted small', text: 'Nada que se destacou.' })])),
      h('div', { class: 'h-col' }, h('div', { class: 'lbl' }, h('span', { class: 'down', text: 'O que prejudicou' })),
        ...(r.analysis.bad.length ? r.analysis.bad.map(point) : [h('p', { class: 'muted small', text: 'Nenhum problema claro.' })]))));
}

window.overlay.onPostgame((rec) => {
  histSel = `l:${rec.id}`;
  goPage('history');
  showHistory(rec.id);
  setTimeout(() => loadHistory(true), 90 * 1000); // o OP.GG leva ~1 min para registrar a partida
});
$('tl-elo').value = tlElo;
$('tl-elo').addEventListener('change', () => {
  tlElo = $('tl-elo').value;
  try { localStorage.setItem('tlElo', tlElo); } catch { /* sem storage */ }
  tl = null; tlRoleButtons(); drawTierList(); loadTierList();
});
$('tl-search').addEventListener('input', drawTierList);
$('tl-sort').addEventListener('change', drawTierList);
$('tl-refresh').addEventListener('click', () => { tl = null; drawTierList(); loadTierList(true); });


/* ---------- novidades da versão ---------- */

async function showWhatsNew(force = false) {
  const wn = await window.overlay.getWhatsNew().catch(() => null);
  if (!wn || (!force && !wn.unseen) || (!wn.current && !force)) return;
  const cur = wn.current || wn.history[0];
  if (!cur) return;
  $('wn-ver').textContent = `Novidades · v${cur.version}`;
  $('wn-title').textContent = cur.title;
  $('wn-items').replaceChildren(...cur.items.map((t) => h('li', { text: t })));
  const old = wn.history.filter((e) => e.version !== cur.version);
  $('wn-old').hidden = !old.length;
  $('wn-hist').replaceChildren(...old.map((e) => h('div', { class: 'wn-old' }, h('b', { text: `v${e.version} · ${e.title}` }), h('ul', {}, ...e.items.map((t) => h('li', { text: t }))))));
  $('whatsnew').hidden = false;
}
$('wn-ok').addEventListener('click', () => { $('whatsnew').hidden = true; window.overlay.seenWhatsNew(); });
$('whatsnew').addEventListener('click', (e) => { if (e.target.id === 'whatsnew') $('wn-ok').click(); });
setTimeout(() => showWhatsNew(false), 1200);

/* ---------- patch nos seus campeões ---------- */

let patchLoadedFor = '';
async function loadPatchCard(state) {
  const top = (state && state.home && state.home.top) || [];
  const key = top.map((c) => c.id).join(',');
  if (!key || key === patchLoadedFor) return;
  patchLoadedFor = key;
  const res = await window.overlay.getPatchMine().catch(() => null);
  if (!res || !res.champs || !res.champs.length) { $('patch-card').hidden = true; return; }
  const short = (v) => String(v || '').split('.').slice(0, 2).join('.');
  $('patch-title').textContent = `Patch ${short(res.patch)} nos seus campeões`;
  const changed = res.champs.filter((c) => c.changes.length || c.touched);
  const quiet = res.champs.filter((c) => !c.changes.length && !c.touched);
  const VERD = { buff: 'Buff', nerf: 'Nerf', ajuste: 'Ajuste' };
  const rows = changed.map((c) => h('div', { class: 'patch-row' },
    version ? h('img', { class: 'ic', src: champIcon(version, c.id), alt: '' }) : h('span', { class: 'ic' }),
    h('div', { style: 'min-width:0' },
      h('div', { class: 'nm' }, document.createTextNode(c.name),
        h('span', { class: `pv ${c.verdict || 'ajuste'}`, text: c.verdict ? VERD[c.verdict] : 'Alterado' })),
      c.changes.length
        ? h('ul', { class: 'patch-ch' }, ...c.changes.slice(0, 5).map((x) => h('li', { class: x.buff === true ? 'up' : x.buff === false ? 'down' : '' },
          document.createTextNode(`${x.what}: `), h('s', { text: x.from }), document.createTextNode(' → '), h('b', { text: x.to }))))
        : h('div', { class: 'muted small', text: 'Mexido neste patch (Meraki), mas sem mudança nos números do Data Dragon: provavelmente dano.' }))));
  if (quiet.length) rows.push(h('p', { class: 'muted small pad', text: `Sem mudanças: ${quiet.map((c) => c.name).join(', ')}.` }));
  $('patch-body').replaceChildren(...rows);
  $('patch-card').hidden = false;
}


/* ---------- notas de atualização ---------- */

const pn = { versions: [], version: null, note: null, mine: [], filter: 'all', error: null, loading: false };
const PN_FILTERS = [['all', 'Tudo'], ['mine', 'Seus campeões'], ['champions', 'Campeões'], ['items', 'Itens'], ['other', 'Modos e outros']];
const PN_VERD = { buff: ['Buff', 'up'], nerf: ['Nerf', 'down'], ajuste: ['Ajuste', null] };
const PN_SEC_ICON = { champions: 'user', items: 'sword', bugfixes: 'check', skins: 'spark', other: 'list' };

async function loadPatches(force = false) {
  if (!pn.versions.length || force) {
    const r = await window.overlay.listPatches(force);
    pn.versions = r.versions || [];
    pn.error = r.error || null;
  }
  if (!pn.version && pn.versions.length) pn.version = pn.versions[0];
  drawPatchToolbar();
  if (pn.version && (!pn.note || pn.note.version !== pn.version)) await loadPatchNote(pn.version);
  else drawPatches();
}

async function loadPatchNote(v) {
  pn.version = v;
  pn.loading = true;
  drawPatchToolbar();
  drawPatches();
  const r = await window.overlay.getPatchNote(v);
  if (pn.version !== v) return;
  pn.loading = false;
  pn.note = r.note || null;
  pn.mine = r.mine || [];
  pn.error = r.error || null;
  drawPatches();
}

function drawPatchToolbar() {
  $('pn-versions').replaceChildren(...pn.versions.slice(0, 6).map((v) => {
    const b = h('button', { class: `seg-btn${v === pn.version ? ' on' : ''}`, type: 'button', text: v });
    b.addEventListener('click', () => { if (v !== pn.version) loadPatchNote(v); });
    return b;
  }));
  $('pn-filter').replaceChildren(...PN_FILTERS.map(([k, label]) => {
    const b = h('button', { class: `seg-btn${k === pn.filter ? ' on' : ''}`, type: 'button', text: label });
    b.addEventListener('click', () => { pn.filter = k; drawPatchToolbar(); drawPatches(); });
    return b;
  }));
}

const pnImg = (src, cls, alt = '') => {
  const img = h('img', { class: cls, src, alt, loading: 'lazy' });
  img.addEventListener('error', () => (/pn-shot|pn-gico/.test(cls) ? img.remove() : img.replaceWith(h('span', { class: `${cls} miss`, text: (alt || '?').slice(0, 2) }))));
  return img;
};

/** Uma linha de mudança: rótulo, antes riscado → depois colorido (buff verde, nerf vermelho). */
function pnChange(c) {
  if (c.from == null) {
    return h('li', { class: 'pn-ch text' }, c.label ? h('b', { text: `${c.label}: ` }) : null, document.createTextNode(c.text || ''));
  }
  const arrow = c.dir === 'buff' ? '▲' : c.dir === 'nerf' ? '▼' : '→';
  return h('li', { class: `pn-ch ${c.dir || 'neutral'}` },
    c.label ? h('div', { class: 'pn-lbl', text: c.label }) : null,
    h('div', { class: 'pn-vals' },
      h('span', { class: 'pn-from', text: c.from }),
      h('span', { class: 'pn-arrow', text: arrow }),
      h('span', { class: 'pn-to', text: c.to })));
}

function pnEntity(e, mine) {
  const [vLabel, vIco] = PN_VERD[e.verdict] || PN_VERD.ajuste;
  const head = h('div', { class: 'pn-eh' },
    e.icon ? pnImg(e.icon, `pn-eico ${e.kind || ''}`, e.name || '') : h('span', { class: 'pn-eico miss', text: (e.name || '?').slice(0, 2) }),
    h('div', { class: 'pn-en' },
      h('div', { class: 'pn-name' }, document.createTextNode(e.name || 'Geral'), mine ? h('span', { class: 'pn-mine', text: 'Você joga' }) : null),
      e.context ? h('div', { class: 'pn-ctx', text: e.context }) : null),
    h('span', { class: `pn-verd ${e.verdict}` }, vIco ? svgIcon(vIco) : h('span', { text: '◆' }), h('span', { text: vLabel })));
  const ctx = head.querySelector('.pn-ctx');
  if (ctx) ctx.addEventListener('click', () => ctx.classList.toggle('open'));
  const groups = e.groups.filter((g) => g.changes.length).map((g) => h('div', { class: 'pn-g' },
    g.title ? h('div', { class: 'pn-gh' }, g.icon ? pnImg(g.icon, 'pn-gico', g.title) : null, h('span', { text: g.title })) : null,
    h('ul', { class: 'pn-chs' }, ...g.changes.map(pnChange))));
  const card = h('article', { class: `pn-card${mine ? ' mine' : ''}`, id: e.id ? `pn-e-${e.id}` : '' }, head, ...groups);
  return card;
}

function drawPatches() {
  const body = $('pn-body');
  const n = pn.note;
  $('pn-title').textContent = pn.version ? `Patch ${pn.version}` : 'Patch notes';
  $('pn-date').textContent = n && n.date ? new Date(n.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
  $('pn-date').hidden = !$('pn-date').textContent;
  if (!n) {
    $('pn-summary').replaceChildren();
    $('pn-toc').replaceChildren();
    body.replaceChildren(h('section', { class: 'card' }, h('p', { class: 'muted pad', text: pn.loading ? 'Carregando as notas do site da Riot…' : pn.error ? `Não consegui carregar: ${pn.error}` : 'Carregando…' })));
    return;
  }
  const mine = new Set(pn.mine);
  const q = $('pn-search').value.trim().toLowerCase();
  const match = (e) => !q || [e.name, e.context, ...e.groups.flatMap((g) => [g.title, ...g.changes.map((c) => `${c.label} ${c.text || ''}`)])].join(' ').toLowerCase().includes(q);
  const showSec = (s) => pn.filter === 'all' || pn.filter === 'mine' || (pn.filter === 'other' ? !['champions', 'items'].includes(s.kind) : s.kind === pn.filter);

  // resumo: buffs/nerfs e seus campeões afetados
  const champs = n.sections.filter((s) => s.kind === 'champions').flatMap((s) => s.entities);
  const items = n.sections.filter((s) => s.kind === 'items').flatMap((s) => s.entities);
  const count = (list, v) => list.filter((e) => e.verdict === v).length;
  const myHits = champs.filter((e) => e.id && mine.has(e.id));
  const stat = (num, label, cls = '') => h('div', { class: `pn-stat ${cls}` }, h('b', { text: String(num) }), h('span', { text: label }));
  $('pn-summary').replaceChildren(h('section', { class: 'card pn-sum' },
    h('div', { class: 'pn-stats' },
      stat(champs.length, 'campeões'), stat(count(champs, 'buff'), 'buffs', 'up'), stat(count(champs, 'nerf'), 'nerfs', 'down'), stat(count(champs, 'ajuste'), 'ajustes', 'mid'), stat(items.length, 'itens')),
    h('div', { class: 'pn-myhits' },
      h('span', { class: 'muted small', text: myHits.length ? 'Seus campeões neste patch' : 'Nenhum dos seus campeões mudou neste patch' }),
      ...myHits.map((e) => {
        const b = h('button', { class: `pn-hit ${e.verdict}`, type: 'button', title: `${e.name}: ${PN_VERD[e.verdict][0]}` }, pnImg(e.icon, 'pn-hico', e.name), h('span', { text: e.name }));
        b.addEventListener('click', () => { const el = $(`pn-e-${e.id}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
        return b;
      })),
    n.intro && n.intro[0] ? h('p', { class: 'pn-intro', text: n.intro[0] }) : null));

  const secs = [];
  const toc = [];
  for (const s of n.sections) {
    if (!showSec(s)) continue;
    let ents = s.entities.filter(match);
    if (pn.filter === 'mine') ents = ents.filter((e) => e.id && mine.has(e.id));
    const bullets = pn.filter === 'mine' ? [] : s.bullets.filter((t) => !q || t.toLowerCase().includes(q));
    const intro = pn.filter === 'mine' || q ? [] : s.intro;
    const images = pn.filter === 'mine' || q ? [] : s.images;
    if (!ents.length && !bullets.length && !intro.length && !images.length) continue;
    // seus campeões primeiro
    ents.sort((a, b) => (mine.has(b.id) ? 1 : 0) - (mine.has(a.id) ? 1 : 0));
    const id = `pn-s-${s.id}`;
    toc.push([id, s.title, ents.length || bullets.length || null, s.kind]);
    secs.push(h('section', { class: 'pn-sec', id },
      h('div', { class: 'pn-sh' }, svgIcon(PN_SEC_ICON[s.kind] || 'list'), h('h2', { text: s.title }), ents.length ? h('span', { class: 'chip', text: String(ents.length) }) : null),
      ...intro.slice(0, 3).map((t) => h('p', { class: 'pn-p', text: t })),
      images.length ? h('div', { class: 'pn-gallery' }, ...images.slice(0, 12).map((src) => pnImg(src, 'pn-shot'))) : null,
      ents.length ? h('div', { class: 'pn-grid' }, ...ents.map((e) => pnEntity(e, e.id && mine.has(e.id)))) : null,
      bullets.length ? h('ul', { class: 'pn-bullets' }, ...bullets.map((t) => h('li', {}, svgIcon('check'), h('span', { text: t })))) : null));
  }
  $('pn-toc').replaceChildren(...toc.map(([id, title, cnt, kind]) => {
    const b = h('button', { type: 'button', class: 'pn-tl' }, svgIcon(PN_SEC_ICON[kind] || 'list'), h('span', { text: title }), cnt ? h('em', { text: String(cnt) }) : null);
    b.addEventListener('click', () => { const el = $(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    return b;
  }));
  body.replaceChildren(...(secs.length ? secs : [h('section', { class: 'card' }, h('p', { class: 'muted pad', text: pn.filter === 'mine' ? 'Nenhum dos seus campeões mudou neste patch.' : 'Nada encontrado.' }))]));
}
$('pn-search').addEventListener('input', () => drawPatches());
$('pn-open').addEventListener('click', () => { if (pn.version) window.overlay.openPatch(pn.version); });

/* ---------- perfil (maestria, estilo, coleção) ---------- */

const pf = { tab: 'mastery', data: null, sel: null, cls: 'all', q: '', loading: false };
const PF_TABS = [['mastery', 'Maestria'], ['style', 'Estilo de jogo'], ['collection', 'Coleção']];
const PF_CLASSES = [['all', 'Todas'], ['Fighter', 'Lutadores'], ['Mage', 'Magos'], ['Assassin', 'Assassinos'], ['Marksman', 'Atiradores'], ['Tank', 'Tanques'], ['Support', 'Suportes']];
const RARITY_CLS = { Suprema: 'ult', Mítica: 'myth', Exaltada: 'myth', Transcendente: 'myth', Lendária: 'leg', Épica: 'epic', Comum: 'com' };

function ago(ts) {
  if (!ts) return 'nunca';
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return 'hoje';
  if (d === 1) return 'ontem';
  if (d === 2) return 'anteontem';
  if (d < 30) return `há ${d} dias`;
  const m = Math.floor(d / 30);
  if (m < 12) return `há ${m} ${m === 1 ? 'mês' : 'meses'}`;
  const y = Math.floor(d / 365);
  return `há ${y} ${y === 1 ? 'ano' : 'anos'}`;
}
const splashUrl = (champ, num) => `${DD}/cdn/img/champion/splash/${champ}_${num}.jpg`;
const loadingUrl = (champ, num) => `${DD}/cdn/img/champion/loading/${champ}_${num}.jpg`;

async function loadProfile(force = false) {
  drawPfTabs();
  if (pf.data && !force) { drawProfile(); return; }
  pf.loading = true;
  drawProfile();
  pf.data = await window.overlay.getProfile().catch((e) => ({ error: e.message }));
  pf.loading = false;
  if (pf.data && pf.data.mastery && !pf.sel && pf.data.mastery.rows[0]) pf.sel = pf.data.mastery.rows[0].id;
  drawProfile();
}

function drawPfTabs() {
  $('pf-tabs').replaceChildren(...PF_TABS.map(([k, label]) => {
    const b = h('button', { class: `seg-btn${k === pf.tab ? ' on' : ''}`, type: 'button', text: label });
    b.addEventListener('click', () => { pf.tab = k; drawPfTabs(); drawProfile(); });
    return b;
  }));
}

const pfStat = (big, label, sub) => h('div', { class: 'pf-stat' }, h('b', { text: big }), h('span', { text: label }), sub ? h('em', { text: sub }) : null);
const pfCard = (title, ...kids) => h('section', { class: 'card pf-card' }, title ? h('div', { class: 'pf-ch', text: title }) : null, ...kids);

function drawProfile() {
  const body = $('pf-body');
  const d = pf.data;
  const s = d && d.summoner;
  $('pf-who').textContent = s ? `${s.gameName}${s.tagLine ? `#${s.tagLine}` : ''}` : 'Seu perfil';
  $('pf-title').textContent = { mastery: 'Sua maestria', style: 'Seu estilo de jogo', collection: 'Sua coleção' }[pf.tab];
  if (!d || pf.loading) { body.replaceChildren(pfCard(null, h('p', { class: 'muted pad', text: 'Lendo maestria, histórico e coleção no cliente…' }))); return; }
  if (!d.mastery) { body.replaceChildren(pfCard(null, h('p', { class: 'muted pad', text: d.error || 'Abra o cliente do LoL para ver o perfil.' }))); return; }
  // anima só quando troca de aba ou chegam dados novos (clicar numa bolha não repete a animação)
  const animKey = `${pf.tab}:${pf.cls}:${d.version}:${d.mastery.total}`;
  body.classList.toggle('pf-anim', animKey !== pf.animKey);
  pf.animKey = animKey;
  if (pf.tab === 'mastery') body.replaceChildren(...drawMasteryTab(d));
  else if (pf.tab === 'style') body.replaceChildren(...drawStyleTab(d));
  else body.replaceChildren(...drawCollectionTab(d));
}

/** Bolhas: raio pela maestria, posição por espiral (a maior no centro, sem sobrepor). */
function packBubbles(rows, W, H) {
  const max = Math.max(1, ...rows.map((r) => r.points));
  const placed = [];
  for (const r of rows) {
    const rad = Math.max(12, Math.round(62 * Math.sqrt(r.points / max)));
    let pos = null;
    for (let i = 0; i < 4000 && !pos; i++) {
      const a = i * 0.38;
      const dist = i === 0 ? 0 : 2.2 * Math.sqrt(i) * 4;
      const x = W / 2 + Math.cos(a) * dist * 1.25;
      const y = H / 2 + Math.sin(a) * dist * 0.85;
      if (x - rad < 2 || x + rad > W - 2 || y - rad < 2 || y + rad > H - 2) continue;
      if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + rad + 3)) pos = { x, y };
    }
    if (pos) placed.push({ ...pos, r: rad, row: r });
  }
  return placed;
}

function drawMasteryTab(d) {
  const m = d.mastery;
  const stats = h('div', { class: 'pf-stats' },
    pfStat(String(m.score), 'Pontuação de maestria'),
    pfStat(fmtPts(m.total).replace(" mi", " M"), "Pontos totais"),
    pfStat(`${m.played}`, `Campeões jogados`, `de ${m.champions}`),
    m.main ? h('div', { class: 'pf-stat main' }, h('img', { class: 'ic', src: champIcon(d.version, m.main.id), alt: '' }),
      h('div', {}, h('b', { text: m.main.name }), h('span', { text: 'Seu main' }), h('em', { text: `${Math.round(m.main.share * 100)}% dos seus pontos` }))) : null);

  // filtros por classe
  const filters = h('div', { class: 'seg' }, ...PF_CLASSES.map(([k, label]) => {
    const b = h('button', { class: `seg-btn${k === pf.cls ? ' on' : ''}`, type: 'button', text: label });
    b.addEventListener('click', () => { pf.cls = k; drawProfile(); });
    return b;
  }));
  const rows = m.rows.filter((r) => r.points > 0 && (pf.cls === 'all' || r.tags.includes(pf.cls)));
  const W = 720; const H = 460;
  const area = h('div', { class: 'pf-bubbles' });
  area.style.cssText = `height:${H}px`;
  for (const b of packBubbles(rows.slice(0, 70), W, H)) {
    const el = h('button', { class: `pf-bub${b.row.id === pf.sel ? ' sel' : ''}`, type: 'button', title: `${b.row.name} · nível ${b.row.level} · ${b.row.points.toLocaleString('pt-BR')} pts` });
    el.style.cssText = `left:${((b.x - b.r) / W) * 100}%;top:${b.y - b.r}px;width:${b.r * 2}px;height:${b.r * 2}px;background-image:url("${champIcon(d.version, b.row.id)}")`;
    if (b.r >= 22) el.append(h('span', { class: 'pf-lv', text: String(b.row.level) }));
    el.addEventListener('click', () => { pf.sel = b.row.id; drawProfile(); });
    area.append(el);
  }
  const left = pfCard(null, h('div', { class: 'pf-toolbar' }, filters), area,
    h('p', { class: 'muted small pf-hint', text: `Clique numa bolha para ver os detalhes · ${Math.max(0, rows.length - 70)} campeões a mais na lista abaixo` }));

  // painel do campeão selecionado
  const c = m.rows.find((r) => r.id === pf.sel) || m.rows[0];
  const detail = c ? pfCard(null,
    h('div', { class: 'pf-dh' }, h('img', { class: 'pf-dico', src: champIcon(d.version, c.id), alt: '' }),
      h('div', {}, h('h2', { text: c.name }), h('div', { class: 'muted small', text: `Maestria nível ${c.level}` })),
      c.grades.length ? h('span', { class: 'pf-grade', text: c.grades[c.grades.length - 1] }) : null),
    h('div', { class: 'pf-kv' },
      h('div', {}, h('span', { text: 'Pontos' }), h('b', { text: c.points.toLocaleString('pt-BR') })),
      h('div', {}, h('span', { text: 'Última partida' }), h('b', { text: ago(c.lastPlayTime) }))),
    h('div', { class: 'pf-prog' },
      h('div', { class: 'pf-prog-h' }, h('span', { text: `Rumo ao nível ${c.level + 1}` }), h('b', { text: c.untilNext > 0 ? `faltam ${c.untilNext.toLocaleString('pt-BR')}` : 'pronto' })),
      h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${Math.round(c.progress * 100)}%` })),
      c.daysToNext ? h('div', { class: 'pf-pace', text: `No seu ritmo atual, nível ${c.level + 1} em ~${c.daysToNext} dia${c.daysToNext === 1 ? '' : 's'}` }) : null),
    c.marksNeeded ? h('div', { class: 'pf-row' }, h('span', { class: 'muted small', text: 'Marcas para subir' }),
      h('span', { class: 'pf-marks' }, ...Array.from({ length: c.marksNeeded }, (_, i) => h('i', { class: i < c.marks ? 'on' : '' })))) : null,
    c.grades.length ? h('div', { class: 'pf-row col' }, h('span', { class: 'muted small', text: 'Notas desta temporada' }),
      h('div', { class: 'pf-grades' }, ...c.grades.map((g) => h('span', { class: 'pf-grade sm', text: g })))) : null,
    c.milestone ? h('div', { class: 'muted small', text: `Próximo marco: ${c.milestone}` }) : null,
    h('div', { class: 'pf-sep' }),
    h('div', { class: 'pf-ch', text: 'Campeões por nível' }),
    ...m.buckets.map((b) => h('div', { class: 'pf-brow' }, h('span', { text: b.label }), h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${Math.round((b.count / Math.max(1, ...m.buckets.map((x) => x.count))) * 100)}%` })), h('b', { text: String(b.count) }))),
    m.forgotten.length ? h('div', { class: 'pf-sep' }) : null,
    m.forgotten.length ? h('div', { class: 'pf-ch', text: 'Mains esquecidos' }) : null,
    ...m.forgotten.map((f) => {
      const row = h('button', { class: 'pf-fg', type: 'button' }, h('img', { class: 'ic', src: champIcon(d.version, f.id), alt: '' }), h('span', { text: f.name }), h('em', { text: ago(f.since) }));
      row.addEventListener('click', () => { pf.sel = f.id; drawProfile(); });
      return row;
    })) : null;

  // tabela completa
  const q = pf.q.toLowerCase();
  const search = h('input', { type: 'text', placeholder: 'Procurar campeão', value: pf.q, maxlength: '30' });
  search.addEventListener('input', () => { pf.q = search.value; const pos = search.selectionStart; drawProfile(); const el = document.querySelector('#pf-body input'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } });
  const table = pfCard(null, h('div', { class: 'pf-toolbar' }, h('div', { class: 'pf-ch', text: 'Todos os seus campeões' }), h('span', { class: 'spacer' }), search),
    h('div', { class: 'pf-table' }, ...m.rows.filter((r) => r.points > 0 && (!q || r.name.toLowerCase().includes(q))).slice(0, 80).map((r, i) => {
      const row = h('button', { class: `pf-tr${r.id === pf.sel ? ' sel' : ''}`, type: 'button' },
        h('span', { class: 'rk', text: String(i + 1) }), h('img', { class: 'ic', src: champIcon(d.version, r.id), alt: '' }),
        h('span', { class: 'nm', text: r.name }), h('span', { class: 'pf-lvl', text: `Nv. ${r.level}` }),
        h('span', { class: 'muted small', text: `${r.points.toLocaleString('pt-BR')} pts` }), h('span', { class: 'muted small', text: ago(r.lastPlayTime) }));
      row.addEventListener('click', () => { pf.sel = r.id; drawProfile(); $('content').scrollTop = 0; });
      return row;
    })));
  return [stats, h('div', { class: 'pf-grid' }, left, detail), table];
}

function drawStyleTab(d) {
  const st = d.style;
  const stats = h('div', { class: 'pf-stats' },
    pfStat(String(st.unique), 'Campeões diferentes', `nas suas últimas ${st.recent} partidas`),
    st.mainIndex ? pfStat(`${Math.round(st.mainIndex.share * 100)}%`, 'Índice de main', st.mainIndex.name) : null,
    pfStat(String(st.srGames), "Partidas no Summoner's Rift", `de ${st.analyzed} lidas`),
    st.winRate != null ? pfStat(`${Math.round(st.winRate * 100)}%`, 'Vitórias', 'últimas partidas') : null);
  // mini mapa com as rotas
  const POS = { top: [22, 22], jungle: [36, 50], middle: [50, 50], bottom: [78, 78], utility: [64, 84] };
  const map = h('div', { class: 'pf-map' }, h('div', { class: 'pf-lane l1' }), h('div', { class: 'pf-lane l2' }), h('div', { class: 'pf-lane l3' }),
    ...st.roles.map((r) => {
      const [x, y] = POS[r.role];
      const big = st.mainRole && st.mainRole.role === r.role;
      const n = h('div', { class: `pf-node${big ? ' big' : ''}` }, roleImg(r.role, 'pf-nimg'), h('span', { text: `${r.label} ${Math.round(r.share * 100)}%` }));
      n.style.cssText = `left:${x}%;top:${y}%`;
      return n;
    }));
  const info = h('div', { class: 'pf-style-info' },
    h('div', { class: 'eyebrow', text: "Seu lugar no Summoner's Rift" }),
    h('h2', { class: 'pf-big', text: st.mainRole ? st.mainRole.label : '—' }),
    h('p', { class: 'muted', text: st.mainRole ? `${Math.round(st.mainRole.share * 100)}% das suas partidas no Summoner's Rift são de ${st.mainRole.label}. ${Math.round(st.soloShare * 100)}% de tudo o que você joga é Ranqueada Solo/Duo.` : 'Sem partidas suficientes.' }),
    h('div', { class: 'pf-ch', text: 'Classes que você domina' }),
    st.profile ? h('p', { class: 'small', text: `Seu perfil: ${st.profile}` }) : null,
    ...st.classes.map((c) => h('div', { class: 'pf-brow' }, h('span', { text: c.label }), h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${Math.round(c.share * 100)}%` })), h('b', { text: `${Math.round(c.share * 100)}%` }))),
    h('div', { class: 'pf-ch', text: 'Modos que mais joga' }),
    h('div', { class: 'chips' }, ...st.modes.slice(0, 5).map((m) => h('span', { class: 'chip', text: `${m.label} · ${m.games}` }))));
  const pool = pfCard(`Seu leque de campeões (últimas ${st.recent})`, h('div', { class: 'pf-pool' }, ...st.pool.map((p) => h('div', { class: 'pf-pc', title: `${p.name}: ${p.games} partidas` },
    h('img', { src: champIcon(d.version, p.id), alt: '' }), h('span', { text: String(p.games) })))));
  return [stats, pfCard(null, h('div', { class: 'pf-style' }, map, info)), pool,
    h('p', { class: 'muted small', text: 'O cliente do LoL só guarda as últimas partidas; o app lê as mais recentes a cada abertura.' })];
}

function drawCollectionTab(d) {
  const c = d.collection;
  if (!c) return [pfCard(null, h('p', { class: 'muted pad', text: d.collectionError || 'Coleção indisponível.' }))];
  const pc = (a, b) => `${Math.round((a / Math.max(1, b)) * 100)}%`;
  const stats = h('div', { class: 'pf-stats' },
    pfStat(`${c.champions.owned}`, 'Campeões', `de ${c.champions.total} · ${pc(c.champions.owned, c.champions.total)}`),
    pfStat(`${c.skins.owned}`, 'Skins', `de ${c.skins.total} · ${pc(c.skins.owned, c.skins.total)}`),
    pfStat(String(c.chromas), 'Cromas'),
    pfStat(String(c.legacy), 'Skins legado'));
  const jewels = c.jewels.length ? pfCard('Suas joias', h('div', { class: 'pf-jewels' }, ...c.jewels.map((j) => h('div', { class: 'pf-jewel' },
    h('img', { src: splashUrl(j.champion, j.num), alt: '', loading: 'lazy' }),
    h('div', { class: 'pf-jt' }, h('b', { text: j.name }), h('span', { class: `rar ${RARITY_CLS[j.rarity] || ''}`, text: j.rarity })))))) : null;
  const maxR = Math.max(1, ...c.byRarity.map((r) => r.count));
  const rarity = pfCard('Por raridade', ...c.byRarity.map((r) => h('div', { class: 'pf-brow' }, h('span', { class: `rar ${RARITY_CLS[r.label] || ''}`, text: r.label }), h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${Math.round((r.count / maxR) * 100)}%` })), h('b', { text: String(r.count) }))));
  const most = pfCard('Campeões com mais skins', ...c.most.map((m) => h('div', { class: 'pf-mrow' },
    h('img', { class: 'ic', src: champIcon(d.version, m.id), alt: '' }), h('span', { class: 'nm', text: m.name }),
    h('div', { class: 'pf-segs' }, ...Array.from({ length: Math.min(m.total, 24) }, (_, i) => h('i', { class: i < m.owned ? 'on' : '' }))),
    h('b', { text: `${m.owned} / ${m.total}` }))));
  const sug = d.suggestions || [];
  const tops = pfCard('Skins que valem o investimento',
    h('p', { class: 'muted small pf-sub', text: 'Só as melhores (Suprema, Lendária ou Mítica), à venda, dos campeões que você mais joga e que você ainda não tem.' }),
    sug.length ? h('div', { class: 'pf-sugs' }, ...sug.map((x) => h('div', { class: 'pf-sug' },
      h('img', { src: loadingUrl(x.champion, x.num), alt: '', loading: 'lazy' }),
      h('div', { class: 'pf-st' },
        h('span', { class: `rar ${RARITY_CLS[x.rarity] || ''}`, text: x.rarity }),
        h('b', { text: x.name }),
        h('span', { class: 'muted small', text: x.why }),
        h('span', { class: 'pf-price', text: x.price }))))) : h('p', { class: 'muted pad', text: 'Você já tem as melhores skins dos campeões que mais joga.' }));
  return [stats, tops, jewels, h('div', { class: 'pf-two' }, rarity, most)];
}

$('pf-refresh').addEventListener('click', () => loadProfile(true));
