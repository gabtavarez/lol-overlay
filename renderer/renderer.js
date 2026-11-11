translateDom(document.body); // textos fixos do HTML no idioma escolhido
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
const VIEWS = ['waiting', 'select', 'game', 'profile', 'skins', 'items', 'tierlist', 'history', 'patches', 'pro', 'settings'];
function showView(name) {
  if (name && name !== lastView && page === 'home') page = 'auto'; // mudou de fase (ex.: champ select -> partida): volta a seguir a fase
  if (name) lastView = name;
  const v = settingsOpen ? 'settings' : page === 'home' ? 'waiting' : page !== 'auto' ? page : lastView;
  for (const id of VIEWS) $(id).hidden = v !== id;
  const navOf = { waiting: 'nav-home', select: 'nav-select', game: 'nav-game', profile: 'nav-profile', skins: 'nav-skins', items: 'nav-items', tierlist: 'nav-tier', history: 'nav-history', patches: 'nav-patches', pro: 'nav-pro', settings: 'gear' };
  for (const [view, id] of Object.entries(navOf)) $(id).classList.toggle('on', v === view);
  $('nav-select').querySelector('.live').hidden = lastView !== 'select';
  $('nav-game').querySelector('.live').hidden = lastView !== 'game';
}

/* ---------- champ select ---------- */

/** Abre a página do campeão (build, counters, sinergias) a partir de qualquer tela. */
function goChamp(id, role) {
  if (!id) return;
  goPage('tierlist');
  openChamp(String(id), ['top', 'jungle', 'middle', 'bottom', 'utility'].includes(role) ? role : null);
}

function slot(p) {
  const champName = p.champion ? p.champion.name : '';
  const known = p.position ? t(ROLE_LABEL[p.position]) : '';
  const guess = !known && p.predicted ? `${t(ROLE_LABEL[p.predicted])}?` : '';
  const el = h('div', { class: `dp${p.isMe ? ' me' : ''}` },
    version && p.champion ? h('img', { src: champIcon(version, p.champion.id), alt: champName }) : h('span', { class: 'ph' }),
    h('span', { class: `dp-role${guess ? ' guess' : ''}` }, (p.position || p.predicted) ? roleImg(p.position || p.predicted, 'dp-ico') : '', document.createTextNode(guess ? '?' : '')));
  const flex = p.flex && p.flex.length ? ` · flex: ${p.flex.map((r) => t(ROLE_LABEL[r])).join('/')}` : '';
  if (p.champion) { el.classList.add('dp-link'); el.addEventListener('click', () => goChamp(p.champion.id, p.position || p.predicted)); }
  el.title = [champName || t('Escolhendo…'), p.isMe ? t('você') : playerLabel(p), guess ? `${tr('rota prevista ({p}%)', { p: p.confidence })}${flex}` : known].filter(Boolean).join(' · ');
  return el;
}

function listRow({ rank, id, name, why, score, selected, onIcon }) {
  const ic = version && id ? h('img', { class: `ic${onIcon ? ' ic-link' : ''}`, src: champIcon(version, id), alt: '' }) : h('span', { class: 'ic' });
  if (onIcon && version && id) {
    ic.title = t('Ver build, counters e sinergias');
    ic.addEventListener('click', (e) => { e.stopPropagation(); onIcon(); }); // o clique na linha continua marcando no cliente
  }
  return h('div', { class: `row-item${selected ? ' sel' : ''}` },
    h('span', { class: 'rk', text: rank }),
    ic,
    h('div', { style: 'min-width:0' }, h('div', { class: 'nm', text: name }), h('div', { class: 'why', text: why })),
    h('span', { class: 'sc', text: score }));
}

/** Marca o campeão no cliente (sem travar). Não mexe se o seu pick já está travado. */
async function hoverInClient(id, name, kind) {
  const me = lastState && lastState.me;
  if (kind === 'pick' && me && me.locked) return;
  if (kind === 'ban' && lastState && lastState.action !== 'ban') return;
  const res = await window.overlay.hoverChampion(id, kind);
  els.impMsg.textContent = res.ok ? (kind === 'ban' ? tr('{name} marcado no cliente para banir (falta travar).', { name }) : tr('{name} marcado no cliente (falta travar).', { name })) : tr('Não consegui marcar {name} no cliente: {err}', { name, err: res.error });
}

function pickCard(c, selected, i = 0) {
  const card = listRow({ rank: String(i + 1), id: c.id, name: c.name, why: c.reasons.slice(0, 2).join(' · ') || 'Pelos seus dados', score: String(c.score), selected, onIcon: () => goChamp(c.id, lastState && lastState.myPosition) });
  card.title = `${c.blind ? `${c.blind.text}\n` : ''}${c.reasons.join(' · ')}\n${tr('Clique para marcar no cliente')}`;
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
    els.guideTitle.textContent = t('Guia do campeão');
    els.guideWhy.textContent = t('Escolha um campeão para ver runas, feitiços e itens.');
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
let guideRuneKey = '';
let lastBans = { session: null, list: [] };

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
    tipBox.replaceChildren(...[h('b', { text: title }), desc ? h('div', { text: desc }) : null].filter(Boolean));
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

/** Troca a rota em que você caiu: muda a build do guia, do laboratório, do Importar e do overlay. */
function rolePicker(root, onChange = null) {
  const auto = (lastState && (lastState.assignedPosition != null ? lastState.assignedPosition : lastState.myPosition)) || '';
  const cur = (root && root.roleOverride) || '';
  const sel = h('select', { class: 'role-pick', title: 'Rota usada para a build' },
    h('option', { value: '', text: auto ? `${t('Automática')} (${t(ROLE_NAME[auto] || auto)})` : t('Automática') }),
    ...Object.entries(ROLE_NAME).map(([k, v]) => h('option', { value: k, text: v })));
  sel.value = cur;
  if (!can('roleSwitch')) {
    sel.title = t('Trocar a rota é do Pro');
    sel.addEventListener('mousedown', (e) => { e.preventDefault(); proWhy = 'roleSwitch'; goPage('pro'); });
    return h('label', { class: 'role-pick-wrap locked' }, h('span', { text: 'Rota' }), sel, h('i', { class: 'pro-tag', text: 'PRO' }));
  }
  sel.addEventListener('change', async () => {
    sel.disabled = true;
    await window.overlay.setRole(sel.value || null);
    if (onChange) return onChange();
    guide = await window.overlay.getGuide(shownId);
    imported.runes = false; imported.spells = false; variant = 0;
    drawGuide();
  });
  return h('label', { class: 'role-pick-wrap' }, h('span', { text: 'Rota' }), sel);
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
      h('option', { value: 'auto', text: root.opponent && root.matchupMode === 'auto' ? `${tr('Automático')} (${root.opponent})` : 'Automático' }),
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
  if (lastState && lastState.phase === 'champselect' && !lastState.mode) sub.unshift(rolePicker(root));
  if (sub.length) parts.push(h('div', { class: 'g-sub' }, ...sub));
  if (root.chosen) parts.push(h('div', { class: 'g-tip chosen-tip', text: tr('Usando a sua build do laboratório ({label}). Para voltar à do OP.GG, use "Voltar ao padrão" no bloco Builds.', { label: root.chosen.label || 'OP.GG' }) }));
  if (root.roleNote) parts.push(h('div', { class: 'g-tip', text: root.roleNote }));

  if (g.matchup && g.matchup.tip) parts.push(h('div', { class: 'g-tip' }, h('b', { text: `vs ${g.matchup.vs}` }), document.createTextNode(g.matchup.tip)));
  if ((g.changes || []).length) {
    const KIND = { items: 'Itens', spells: 'Feitiços', runes: 'Runas', shards: 'Fragmento', skills: 'Habilidades' };
    parts.push(h('div', { class: 'g-changes' },
      h('div', { class: 'lbl' }, h('span', { text: tr('O que muda — {v}', { v: (root.variants[variant] || {}).label || 'matchup' }) })),
      ...g.changes.map((c) => h('div', { class: `g-ch k-${c.kind}` },
        h('span', { class: 'g-ch-k', text: KIND[c.kind] || c.kind }),
        h('span', { class: 'g-ch-t', text: c.text.replace(new RegExp(`^(${['Itens', 'Feitiços', '2ª árvore', 'Habilidades'].map((w) => tr(w)).join('|')}): `), '') }),
        h('span', { class: `g-ch-s ${c.source === 'OP.GG' ? 'src-op' : 'src-rule'}`, text: c.source === 'OP.GG' ? 'OP.GG' : tr('regra do app'), title: c.source === 'OP.GG' ? 'Dados do OP.GG para este confronto' : 'Regra do app (composição inimiga / matchup difícil)' })))));
  }

  const left = h('div', { class: 'g-sec' });
  const pages = root.runePages || [];
  const page = pages[runePage] || pages[0] || null;
  guideRuneKey = `g:${shownId}:${variant}:${g.runesForMatchup ? 'mu' : runePage}`;
  const drawRunes = (tree) => editableRunes(tree, guideRuneKey, () => { imported.runes = false; drawGuide(); });
  if (g.runesForMatchup && g.runeTree) {
    // runas ajustadas para o matchup (OP.GG do confronto ou regra própria): mostra só essa página
    left.append(head(`${tr('Runas')} · ${g.runes.primaryStyleName} + ${g.runes.subStyleName}`, 'runes'),
      h('p', { class: 'muted small rp-one', text: tr('Ajustadas para {v}', { v: (root.variants[variant] || {}).label || tr('o matchup') }) }), drawRunes(g.runeTree));
  } else if (page && page.runeTree) {
    const st = page.stats || {};
    left.append(head(`${tr('Runas')} · ${page.view.primaryStyleName} + ${page.view.subStyleName}`, 'runes'), runePageTabs(pages) || '');
    if (pages.length < 2 && (st.pickRate || st.winRate)) left.append(h('p', { class: 'muted small rp-one', text: `${Math.round((st.pickRate || 0) * 100)}% pick${st.winRate ? ` · ${(st.winRate * 100).toFixed(1)}% WR` : ''}` }));
    left.append(drawRunes(page.runeTree));
  } else if (g.runeTree) left.append(head(`${tr('Runas')} · ${g.runes.primaryStyleName} + ${g.runes.subStyleName}`, 'runes'), drawRunes(g.runeTree));
  else if (g.runes) left.append(head('Runas', 'runes'), h('p', { class: 'muted', text: `${g.runes.primaryStyleName} + ${g.runes.subStyleName}` }));
  const right = h('div', { class: 'g-sec' });
  if (g.spells.length) right.append(head('Feitiços', 'spells'), drawSpells(g), h('div', { style: 'height:22px' }));
  right.append(drawBuildPath(g));
  parts.push(h('div', { class: 'g-grid' }, left, right));
  const myRole = (lastState && (lastState.myRole || lastState.myPosition)) || (g.role && !['aram', 'arena'].includes(g.role) ? g.role : 'middle');
  if (myRole && !['aram', 'arena'].includes(myRole) && !(lastState && lastState.mode)) {
    const foes = ((lastState && lastState.enemies) || []).filter((e) => e.champion);
    const lane = foes.find((e) => e.position === myRole) || foes.find((e) => !e.position && e.predicted === myRole && e.confidence >= 50);
    parts.push(buildLab({
      id: shownId, role: myRole, defaultVs: lane ? lane.champion.id : null, skillIcons: g.skillIcons, runeKey: guideRuneKey,
      vsOptions: foes.map((e) => ({ id: e.champion.id, name: e.champion.name })),
      onRunes: (pg) => { runeEdits.set(guideRuneKey, pg); imported.runes = false; drawGuide(); },
    }));
  }
  if (g.skills.length) {
    // ordem em que cada habilidade chega ao nível máximo (5)
    const cnt = {};
    const order = [];
    for (const x of skillOrder18(g.skills)) if (x !== 'R' && (cnt[x] = (cnt[x] || 0) + 1) === 5) order.push(x);
    for (const x of ['Q', 'W', 'E']) if (!order.includes(x)) order.push(x);
    const skillMu = (g.changes || []).some((c) => c.kind === 'skills');
    parts.push(h('div', { class: 'g-full' }, head(`${tr('Ordem de habilidades')} · ${order.slice(0, 3).join(' › ')}${skillMu ? ` · ${tr('ajustada {v}', { v: ((root.variants[variant] || {}).label || '').toLowerCase() })}` : ''}`), drawSkills(g)));
  }
  if (root.oppKit) parts.push(abilityBlock(root.oppKit, 'g-full'));
  parts.push(otpBlock());
  els.guideBody.replaceChildren(...parts);
  setImportEnabled(Boolean(g.runes || g.spells.length));
}

/** Recarga das habilidades do oponente (Meraki / Data Dragon). */
function abilityBlock(kit, cls) {
  return h('div', { class: cls },
    head(tr('Habilidades de {champ} · recarga do nível 1 ao máximo', { champ: kit.champion })),
    h('div', { class: 'abil' }, ...kit.abilities.map((a) => h('div', { class: 'abil-i' }, h('b', { text: a.key }), h('span', { class: 'nm', text: a.name }), h('span', { class: 'muted small', text: a.cd })))),
    kit.ult && kit.ult.cd ? h('p', { class: 'small', style: 'margin-top:8px', text: tr('Ult no rank {r}: {cd} s de recarga (sem aceleração)', { r: kit.ult.rank, cd: kit.ult.cd }) }) : null,
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
    const tier = p.tier ? `${tierName(p.tier)}${p.division ? ` ${p.division}` : ''} · ${p.lp} ${t('PDL')}` : '';
    return h('div', { class: 'otp' },
      h('div', { style: 'min-width:0' }, h('div', { class: 'nm', text: `#${p.rank} ${p.riotId}` }), h('div', { class: 'why', text: [tier, wr].filter(Boolean).join(' · ') })),
      b ? h('div', { class: 'otp-build' },
        (() => {
          const btn = h('button', { class: 'badge', type: 'button', text: 'Importar' });
          btn.addEventListener('click', async () => {
            btn.textContent = '…';
            const r = await window.overlay.importOtp(otp.id, idx);
            btn.textContent = r.ok ? t('✓ Importado') : t('Importar');
            btn.classList.toggle('on', r.ok);
            els.impMsg.textContent = r.ok ? `${tr('Build de {who}: {what} importados.', { who: p.riotId.split('#')[0], what: r.done.join(', ') })}${r.notes && r.notes.length ? ` (${r.notes[0]})` : ''}` : tr('Não consegui importar: {err}', { err: r.error });
          });
          return btn;
        })(),
        b.keystoneIcon ? icon(ddImg(b.keystoneIcon), 'otp-rune', b.keystoneName) : null,
        ...b.spellKeys.map((k) => icon(ddVerImg(`spell/${k}.png`), 'otp-sp', k)),
        ...b.items.slice(0, 6).map((id) => icon(ddVerImg(`item/${id}.png`), 'otp-it', String(id), ''))) : h('span', { class: 'muted small', text: 'sem partida recente com ele' }));
  }) : [h('p', { class: 'muted small', text: d ? (d.error ? `Sem dados: ${d.error}` : 'Buscando os melhores jogadores…') : 'Buscando os melhores jogadores…' })];
  box.replaceChildren(head(`${tr('One-tricks · melhores do ranking')}${d && d.region ? ` (${String(d.region).toUpperCase()})` : ''} · ${tr('última build')}`), ...rows);
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
  renderSelTilt(state.tilt, state.assets && state.assets.version);
  els.selRole.textContent = state.mode ? t(ROLE_LABEL[state.mode]) : state.myPosition ? t(ROLE_LABEL[state.myPosition]) : t('rota não definida');
  const turnText = state.action === 'ban' ? 'Sua vez: banir' : state.action === 'pick' ? 'Sua vez: escolher' : '';
  els.turn.textContent = turnText;
  els.turn.hidden = !turnText;

  const selectedId = chosenId || (state.me && state.me.champion && state.me.champion.id) || (picks.candidates[0] && picks.candidates[0].id);
  els.picks.replaceChildren(...(picks.locked ? [proLock('picks')] : picks.candidates.map((c, i) => pickCard(c, c.id === selectedId, i))));
  els.pickNotes.replaceChildren(...picks.notes.map((n) => h('p', { text: n })));

  els.team.replaceChildren(...[state.me, ...state.allies].filter(Boolean).map((p) => slot(p)));
  els.selEnemies.replaceChildren(...state.enemies.map((p) => slot(p)));
  const flexes = state.enemies.filter((p) => p.flex && p.flex.length && p.champion).map((p) => `${p.champion.name} (${p.flex.map((r) => t(ROLE_LABEL[r])).join('/')})`);
  const guessed = state.enemies.some((p) => p.predicted);
  $('enemy-roles').textContent = [guessed ? t('Rotas inimigas com "?" são previsões') : '', flexes.length ? `Flex: ${flexes.join(', ')}` : ''].filter(Boolean).join(' · ');
  const opgg = state.opgg || {};
  els.opggAllies.disabled = !opgg.allies;
  els.opggEnemies.hidden = !opgg.enemies;

  let bans = (state.advice && state.advice.bans) || [];
  // Nunca some no meio da fase de bans: se o cálculo voltar vazio por um instante (alguém acabou de banir),
  // mantém a última lista, tirando os campeões que já foram banidos.
  const banned = new Set(state.bannedKeys || []);
  if (!bans.length && state.hasBanPhase && !state.myBanDone && lastBans.session === state.sessionId) bans = lastBans.list.filter((b) => !banned.has(b.key));
  else if (bans.length) lastBans = { session: state.sessionId, list: bans };
  // visível durante a fase de bans até você banir (destaque quando é a sua vez)
  $('bans').hidden = !bans.length || (state.myBanDone && state.action !== 'ban');
  $('bans').classList.toggle('my-turn', state.action === 'ban');
  $('ban-row').replaceChildren(...bans.map((b, i) => {
    const row = listRow({ rank: String(i + 1), id: b.id, name: b.name, why: b.reasons.join(' · '), score: String(b.score), onIcon: () => goChamp(b.id, state.myPosition) });
    row.title = 'Clique para marcar o ban no cliente';
    row.addEventListener('click', () => hoverInClient(b.id, b.name, 'ban'));
    return row;
  }));

  renderDmgComp(state.damageComp);
  // campeão travado: sai a sugestão de picks e o guia (runas etc.) ocupa a tela; os bans continuam se a fase deles estiver aberta
  const locked = Boolean(state.me && state.me.locked);
  $('picks-card').hidden = locked;
  const leftEmpty = locked && $('bans').hidden;
  $('select-left').hidden = leftEmpty;
  $('select-grid').classList.toggle('solo', leftEmpty);
  renderGuide(state, picks);
  showView('select');
}

/* ---------- composição de dano dos dois times ---------- */
function renderDmgComp(dc) {
  $('dmg-comp').hidden = !dc;
  if (!dc) return;
  const row = (label, c) => {
    if (!c) return h('div', { class: 'dmg-row' }, h('b', { text: label }), h('div', { class: 'dmg-bar' }), h('span', { class: 'muted small', text: tr('Aguardando picks…') }));
    return h('div', { class: 'dmg-row' },
      h('b', { text: label }),
      h('div', { class: 'dmg-bar', title: tr('Campeões escolhidos: {n}', { n: c.n }) },
        h('span', { class: 'dmg-ad', style: `width:${c.ad}%` }), h('span', { class: 'dmg-ap', style: `width:${c.ap}%` }), h('span', { class: 'dmg-tr', style: `width:${c.true}%` })),
      h('div', { class: 'dmg-vals' },
        h('span', { class: 'dmg-key ad', text: `AD ${c.ad}%` }), h('span', { class: 'dmg-key ap', text: `AP ${c.ap}%` }), h('span', { class: 'dmg-key tr', text: `${tr('Verdadeiro')} ${c.true}%` })));
  };
  $('dmg-body').replaceChildren(row(t('Seu time'), dc.allies), row(t('Inimigos'), dc.enemies),
    ...(dc.notes || []).map((n) => h('div', { class: 'dmg-note', text: n })));
}

/* ---------- em partida ---------- */

const tierName = (tier) => t(TIER_PT[String(tier || '').toUpperCase()] || tier || '');
const TIER_PT = { IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro', PLATINUM: 'Platina', EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante' };
const fmtK = (g) => (Math.abs(g) >= 1000 ? `${(g / 1000).toFixed(1)}k` : String(g));
const signedK = (d) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${fmtK(Math.abs(d))}`;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ---------- build completa na janela durante a partida ---------- */
let gb = null; // { key, id, role, data, page, owned }
function gameBuild(state) {
  const id = state.me && state.me.championId;
  if (!id) { $('gbuild-card').hidden = true; return; }
  const role = state.myRole || '';
  const key = `${id}:${role}`;
  const owned = new Set((state.me.items || []).map((it) => it.id));
  const ownedSig = [...owned].sort().join(',');
  if (!gb || gb.key !== key) {
    gb = { key, id, role, data: null, page: 0, owned, ownedSig };
    loadGameBuild();
  } else if (gb.ownedSig !== ownedSig) {
    gb.owned = owned; gb.ownedSig = ownedSig; drawGameBuild();
  }
  $('gbuild-card').hidden = false;
}
async function loadGameBuild() {
  const cur = gb;
  if (!cur) return;
  const d = await window.overlay.getChampDetail(cur.id, cur.role || null);
  if (gb !== cur) return;
  cur.data = d;
  drawGameBuild();
}
window.overlay.onChampDetailUpdated((p) => { if (gb && p.id === gb.id) loadGameBuild(); });
function drawGameBuild() {
  const box = $('gbuild');
  const d = gb && gb.data;
  $('gbuild-title').textContent = d && d.champion ? `${t('Build completa')} · ${d.champion.name}${d.role && ROLE_NAME[d.role] ? ` · ${t(ROLE_NAME[d.role])}` : ''}` : t('Build completa');
  $('gbuild-src').textContent = d && d.chosen ? tr('Sua build · {label}', { label: d.chosen.label }) : d && d.winRate ? `${(d.winRate * (d.winRate <= 1 ? 100 : 1)).toFixed(1)}% WR · OP.GG` : 'OP.GG';
  const rp = $('gbuild-role');
  if (rp && !['aram', 'arena'].includes(gb && gb.role)) {
    rp.hidden = false;
    rp.replaceChildren(rolePicker({ roleOverride: lastState && lastState.roleOverride }, () => {})); // o próximo estado do jogo já vem com a rota nova
  } else if (rp) rp.hidden = true;
  if (!d || !d.guide) {
    box.replaceChildren(h('p', { class: 'muted pad', text: d && d.error ? tr('Sem dados do OP.GG: {err}', { err: d.error }) : tr('Carregando a build do OP.GG…') }));
    return;
  }
  const g = d.guide;
  const pages = d.runePages || [];
  const page = pages[gb.page] || pages[0] || null;
  const left = h('div', { class: 'g-sec' });
  if (page && page.runeTree) {
    left.append(head(`${tr('Runas')} · ${page.view.primaryStyleName} + ${page.view.subStyleName}`),
      runePageTabs(pages, gb.page, (i) => { gb.page = i; drawGameBuild(); }) || '', drawRunes(page.runeTree));
  }
  const right = h('div', { class: 'g-sec' });
  if (g.spells.length) right.append(head('Feitiços'), drawSpells(g), h('div', { style: 'height:18px' }));
  right.append(drawBuildPath(g, gb.owned));
  const st = lastState || {};
  const foes = (st.enemies || []).filter((e) => e.championId);
  const lane = st.laneOpponent && st.laneOpponent.championId;
  const lab = gb.role && !['aram', 'arena'].includes(gb.role) ? buildLab({ id: gb.id, role: gb.role, defaultVs: lane || null, owned: gb.owned, skillIcons: g.skillIcons, importNow: false,
    vsOptions: foes.map((e) => ({ id: e.championId, name: e.champion })) }) : '';
  box.replaceChildren(h('div', { class: 'g-grid' }, left, right), lab,
    g.skills.length ? h('div', { class: 'g-full' }, head('Ordem de habilidades'), skillSummary(g.skills), drawSkills(g)) : '');
}

function renderGame(state) {
  version = state.assets.version;
  els.dot.className = 'dot ok';
  els.clock.textContent = mmss(state.gameTime);
  $('who').textContent = `${state.me.champion} · nível ${state.me.level}`;
  $('gold').textContent = `· ${state.me.gold} g`;
  const adv = state.advice || {};
  renderBuyList($('buys'), adv.buys, version);
  gameBuild(state);
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
    $('goals-aim').textContent = tr('ritmo de {tier} (um elo acima do seu)', { tier: tr(TIER_PT[gl.aimTier] || gl.aimTier) });
    const cell = (label, now, target, ok, extra) => h('div', { class: 'goal' }, h('b', { text: label }), h('span', { class: `goal-v ${ok ? 'up' : 'down'}`, text: String(now) }), h('span', { class: 'muted small', text: `meta ${target}${extra || ''}` }));
    $('goals-body').replaceChildren(...(gl.cs ? [cell(t('CS/min'), gl.cs.now, gl.cs.target, gl.cs.ok, ` · ${gl.cs.diff >= 0 ? '+' : ''}${gl.cs.diff} CS`)] : []), cell(t('Visão/min'), gl.vision.now, gl.vision.target, gl.vision.ok));
  }

  // habilidades do oponente
  $('kit-card').hidden = !adv.oppKit;
  if (adv.oppKit) $('kit-body').replaceChildren(abilityBlock(adv.oppKit, ''));

  // lane scouting
  const sc = adv.scout || [];
  $('scout').replaceChildren(...(sc.length ? sc.map((x) => {
    const p = x.profile;
    const rank = p && p.tier ? `${tierName(p.tier)} ${p.division || ''} · ${p.lp} ${t('PDL')}` : p ? tr('Sem elo solo') : x.error ? tr('Sem dados: {err}', { err: x.error }) : tr('Carregando…');
    const wr = p && p.wins + p.losses ? `${Math.round((p.wins / (p.wins + p.losses)) * 100)}% em ${p.wins + p.losses} jogos` : '';
    const mains = p ? p.champs.slice(0, 3).map((c) => c.name).join(', ') : '';
    const on = x.onChamp ? `${tr('{n} jogos de {champ}', { n: x.onChamp.games, champ: x.champion })} (${Math.round((x.onChamp.wins / x.onChamp.games) * 100)}%)` : p ? tr('primeira vez de {champ} na temporada?', { champ: x.champion }) : '';
    return h('div', { class: 'scout' },
      x.championId ? h('img', { class: 'ic', src: champIcon(version, x.championId), alt: '' }) : h('span', { class: 'ic' }),
      h('div', { style: 'min-width:0' },
        h('div', { class: 'nm', text: `${x.who} · ${x.riotId}` }),
        h('div', { class: 'why', text: [rank, wr].filter(Boolean).join(' · ') }),
        h('div', { class: 'why', text: [on, mains && tr('mais joga: {list}', { list: mains })].filter(Boolean).join(' · ') })),
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
  gb = null;
  els.clock.textContent = '';
  if (state.phase === 'error') {
    els.waitingText.textContent = tr('Erro ao processar a partida: {err}', { err: state.reason });
    els.dot.className = 'dot bad';
  } else {
    els.waitingText.textContent = state.client === 'open' ? t('Pronto para a próxima partida') : t('Abra o cliente do LoL');
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
  $('win-max').title = max ? t('Restaurar') : t('Maximizar');
});

/* ---------- tela inicial ---------- */

const fmtPts = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}${LANG === 'en' ? 'M' : ' mi'}` : n >= 1e3 ? `${Math.round(n / 1e3)}${LANG === 'en' ? 'k' : ' mil'}` : String(n));
let homeKey = '';

/* ---------- sequência e tilt ---------- */
const TILT_TONE = { stop: 'bad', pause: 'warn', tired: 'warn', hot: 'ok', ok: '', none: '' };
function renderTilt(t, v) {
  $('tilt-card').hidden = !t || t.status === 'none';
  if (!t || t.status === 'none') return;
  const dots = h('div', { class: 'tilt-dots', title: 'Mais recente à esquerda' }, ...t.recent.map((g) => h('span', { class: `tilt-dot ${g.win ? 'w' : 'l'}`, title: `${g.name || ''} · ${tr(g.win ? 'vitória' : 'derrota')}` },
    v && g.id ? h('img', { src: champIcon(v, g.id), alt: '' }) : null)));
  const sess = t.session && t.session.games ? h('span', { class: 'muted small', text: tr('Sessão de hoje: {w}V {l}D', { w: t.session.wins, l: t.session.losses }) }) : null;
  const comfort = t.comfort && (t.status === 'stop' || t.status === 'pause' || t.status === 'tired')
    ? h('div', { class: 'tilt-comfort' }, v ? h('img', { src: champIcon(v, t.comfort.id), alt: '' }) : null,
      h('span', { text: t.comfort.why === 'recent' ? tr('Conforto: {champ} ({p}% em {n} jogos recentes)', { champ: t.comfort.name, p: Math.round(t.comfort.winRate * 100), n: t.comfort.games }) : tr('Conforto: {champ} (sua maior maestria)', { champ: t.comfort.name }) }))
    : null;
  const hours = h('div', { class: 'tilt-hours' }, ...t.hours.map((x) => h('div', { class: `th${t.best && t.best.key === x.key ? ' best' : ''}${t.worst && t.worst.key === x.key ? ' worst' : ''}` },
    h('div', { class: 'th-bar' }, h('div', { class: 'th-fill', style: `height:${x.winRate == null ? 0 : Math.round(8 + 92 * Math.min(1, Math.max(0, (x.winRate - 0.3) / 0.4)))}%` })),
    h('b', { text: x.winRate == null ? '—' : `${Math.round(x.winRate * 100)}%` }),
    h('span', { class: 'muted small', text: tr(x.games === 1 ? '{when} · 1 jogo' : '{when} · {n} jogos', { when: tr(x.label), n: x.games }) }))));
  const hourNote = t.best ? h('p', { class: 'muted small', text: `${tr('Melhor horário: {when} ({p}%)', { when: tr(t.best.label).toLowerCase(), p: Math.round(t.best.winRate * 100) })}${t.worst ? ` · ${tr('pior: {when} ({p}%)', { when: tr(t.worst.label).toLowerCase(), p: Math.round(t.worst.winRate * 100) })}` : ''}.` })
    : h('p', { class: 'muted small', text: tr('Com {n} partidas ou mais em cada horário, o app mostra o seu melhor e pior horário.', { n: MIN_HOURS }) });
  $('tilt-body').replaceChildren(
    h('div', { class: `tilt-status ${TILT_TONE[t.status] || ''}` }, h('b', { text: t.title }), h('span', { text: t.text })),
    h('div', { class: 'tilt-row' }, dots, sess), ...(comfort ? [comfort] : []), hours, hourNote);
}
const MIN_HOURS = 5;
function renderSelTilt(t, v) {
  const show = t && ['stop', 'pause', 'tired'].includes(t.status);
  $('sel-tilt').hidden = !show;
  if (!show) return;
  $('sel-tilt').className = `tilt-banner ${TILT_TONE[t.status]}`;
  $('sel-tilt').replaceChildren(h('b', { text: t.title }), h('span', { text: ` ${t.text}` }),
    ...(t.comfort ? [h('span', { class: 'tilt-comfort' }, v ? h('img', { src: champIcon(v, t.comfort.id), alt: '' }) : null, h('span', { text: `Conforto: ${t.comfort.name}` }))] : []));
}

function renderHome(state) {
  const home = state.home || {};
  const v = home.version || version;
  if (v) version = version || v;
  const chips = [
    [state.client === 'open' ? t('Cliente conectado') : t('Cliente fechado'), state.client === 'open' ? 'ok' : 'warn'],
    [v ? `Patch ${v.split('.').slice(0, 2).join('.')}` : 'Carregando dados…', ''],
    [`v${appVersion || '…'}`, ''],
  ];
  $('home-chips').replaceChildren(...chips.map(([t, c]) => h('span', { class: `chip ${c}`, text: t })));
  howState(state);

  const tk = home.tilt ? `${home.tilt.status}:${home.tilt.recent.map((r) => (r.win ? 1 : 0)).join('')}` : '';
  const key = JSON.stringify([state.client, home.summoner && home.summoner.puuid, (home.top || []).length, (home.fit || []).length, v, home.elo, tk]);
  if (key === homeKey) return; // evita redesenhar a cada 1,5 s
  homeKey = key;
  loadPatchCard(state);

  const s = home.summoner;
  $('home-hello').textContent = s && s.gameName ? t('Olá, {name}', { name: s.gameName }) : t('Bem-vindo');
  $('side-name').textContent = s && s.gameName ? s.gameName : t('Invocador');
  const rk = s && s.rank;
  $('side-sub').textContent = s ? (rk ? `${tierName(rk.tier)} ${rk.division || ''} · ${rk.lp} ${t('PDL')}` : `#${s.tagLine || ''}${s.level ? ` · ${tr('nível {n}', { n: s.level })}` : ''}`) : state.client === 'open' ? t('Carregando…') : t('Cliente fechado');
  const old = document.getElementById('side-rank');
  if (old) old.remove();
  if (rk) $('side-me').append(Object.assign(rankImg(rk.tier, 'rank-img side-rank'), { id: 'side-rank', title: `${rk.wins}V ${rk.losses}D` }));
  $('side-avatar').replaceWith(v && s && s.iconId
    ? Object.assign(h('img', { id: 'side-avatar', class: 'avatar', src: `${DD}/cdn/${v}/img/profileicon/${s.iconId}.png`, alt: '' }))
    : h('div', { id: 'side-avatar', class: 'avatar' }));

  renderTilt(home.tilt, v);

  const champs = home.top || [];
  $('home-champs').replaceChildren(...(champs.length
    ? champs.map((c) => h('div', { class: 'hc' },
      v ? h('img', { src: champIcon(v, c.id), alt: c.name }) : h('span', { class: 'ic' }),
      h('div', {}, h('div', { class: 'hc-name', text: c.name }), h('div', { class: 'muted small', text: t('Maestria {lvl} · {pts} pts', { lvl: c.level, pts: fmtPts(c.points) }) }))))
    : [h('p', { class: 'muted pad', text: state.client === 'open' ? (home.loading ? 'Carregando sua maestria…' : 'Sem dados de maestria.') : 'Abra o cliente do LoL para ver sua maestria.' })]));

  const roles = home.roles || [];
  const max = Math.max(1, ...roles.map((r) => r.games));
  $('home-roles').replaceChildren(...(roles.length
    ? [...roles.map((r) => h('div', { class: 'role-row' },
      h('span', { class: 'role-name' }, roleImg(r.role), document.createTextNode(t(ROLE_LABEL[r.role]) || r.role)),
      h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${Math.round((r.games / max) * 100)}%` })),
      h('span', { class: 'muted small', text: t('{n} jogos · {wr}%', { n: r.games, wr: Math.round(r.winRate * 100) }) }))),
      h('p', { class: 'muted small', text: t('Últimas {n} partidas de Summoner\'s Rift.', { n: home.gamesAnalyzed || 0 }) })]
    : [h('p', { class: 'muted', text: 'Calculado do seu histórico recente quando o cliente estiver aberto.' })]));

  // elo e evolução
  const el = home.elo;
  const rk2 = s && s.rank;
  $('elo-card').hidden = !(rk2 || (el && (el.lp || el.week)));
  if (!$('elo-card').hidden) {
    const sign = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)} ${t('PDL')}`;
    const lp = el && el.lp;
    const wk = el && el.week;
    const cell = (label, value, cls = '') => h('div', { class: 'elo-c' }, h('b', { text: label }), h('span', { class: `elo-v ${cls}`, text: value }));
    const champLine = (list) => list.map((c) => `${c.champion} ${c.wins}/${c.games}`).join(' · ') || '—';
    $('elo-body').replaceChildren(
      h('div', { class: 'elo-c elo-main' }, rk2 ? rankImg(rk2.tier, 'rank-big') : '', h('div', {},
        h('div', { class: 'strong', text: rk2 ? `${tierName(rk2.tier)} ${rk2.division || ''} · ${rk2.lp} ${t('PDL')}` : 'Sem elo' }),
        h('div', { class: 'muted small', text: rk2 ? `${rk2.wins}V ${rk2.losses}D · ${Math.round((rk2.wins / Math.max(1, rk2.wins + rk2.losses)) * 100)}%` : '' }))),
      cell('Hoje', lp ? sign(lp.today) : '—', lp ? (lp.today > 0 ? 'up' : lp.today < 0 ? 'down' : '') : ''),
      cell('7 dias', lp ? sign(lp.week) : '—', lp ? (lp.week > 0 ? 'up' : lp.week < 0 ? 'down' : '') : ''),
      cell('Sequência', wk && wk.streak ? tr(wk.streak.wins ? (wk.streak.count === 1 ? '1 vitória' : '{n} vitórias') : (wk.streak.count === 1 ? '1 derrota' : '{n} derrotas'), { n: wk.streak.count }) : '—', wk && wk.streak ? (wk.streak.wins ? 'up' : 'down') : ''),
      cell('Semana', wk ? `${wk.weekWins}V ${wk.weekGames - wk.weekWins}D` : '—'),
      h('div', { class: 'elo-c elo-wide' }, h('b', { text: 'Melhores da semana' }), h('span', { class: 'up', text: wk ? champLine(wk.best) : '—' })),
      h('div', { class: 'elo-c elo-wide' }, h('b', { text: 'Piores da semana' }), h('span', { class: 'down', text: wk ? champLine(wk.worst) : '—' })));
  }

  const fit = home.fit || [];
  const fitSub = document.querySelector('#home-fit').previousElementSibling.querySelector('.muted');
  if (fitSub && home.mainRole) fitSub.textContent = tr('fortes no {role} (sua rota principal) e parecidos com os que você joga lá', { role: t(ROLE_LABEL[home.mainRole]) || home.mainRole });
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
  els.impMsg.textContent = r.ok ? `✓ ${tr('{champ}: {what} importados automaticamente.', { champ: r.name, what: r.done.join(', ') })}` : tr('Importação automática de {champ} falhou: {err}', { champ: r.name, err: r.error });
  if (r.ok && r.championId === shownId) {
    imported.runes = true;
    imported.spells = true;
    drawGuide();
  }
});

async function doImport(what) {
  if (!shownId) return;
  els.impMsg.textContent = t('Importando…');
  const edited = what !== 'items' && runeEdits.get(guideRuneKey);
  const res = edited ? await importWithEditedRunes(shownId, edited, what, (w) => window.overlay.importBuild(shownId, w, variant, runePage))
    : await window.overlay.importBuild(shownId, what, variant, runePage);
  els.impMsg.textContent = res.ok ? tr('Importado: {what}.', { what: res.done.join(', ') }) : tr('Não consegui importar: {err}', { err: res.error });
  if (res.ok) {
    if (res.done.includes('runas')) imported.runes = true;
    if (res.done.includes(t('feitiços'))) imported.spells = true;
    drawGuide();
  }
}
/** Runas editadas pelo usuário + o resto (feitiços/itens) do OP.GG. */
async function importWithEditedRunes(champId, page, what, importRest) {
  const r = await window.overlay.importRunes(champId, page);
  if (!r.ok || what === 'runes') return r;
  const done = [...r.done];
  for (const w of ['spells', 'items']) {
    const x = await importRest(w);
    if (!x.ok) return { ok: false, error: x.error, done };
    done.push(...x.done);
  }
  return { ok: true, done };
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
  // ['coach', …] fica fora enquanto o coach de rota estiver desligado (COACH_ON em src/main.js)
  // ['coach', 'Coach de rota', 'O que fazer agora na rota (trocar, all-in, recuar, rotacionar) por nível, itens, vida, caçador, objetivos e o Flash marcado. Ctrl+Shift+C liga/desliga.'],
];
let prevObs = null;
function previewObserver() {
  if (!prevObs) {
    prevObs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.src = e.target.dataset.src;
        prevObs.unobserve(e.target);
      }
    }, { rootMargin: '200px' });
  }
  return prevObs;
}
function fillOverlayList() {
  const en = (settings.overlay && settings.overlay.enabled) || {};
  $('ov-list').replaceChildren(...OVERLAYS.map(([key, name, desc]) => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = en[key] !== false;
    cb.addEventListener('change', async () => { settings = await window.overlay.setSettings({ overlay: { enabled: { [key]: cb.checked } } }); });
    const reset = h('button', { class: 'link', type: 'button', text: 'posição padrão' });
    reset.addEventListener('click', async () => { settings = await window.overlay.setSettings({ overlay: { panels: { [key]: null } } }); els.setMsg.textContent = tr('{name}: posição restaurada.', { name: t(name) }); });
    // prévia só carrega quando aparece na tela (antes eram 7 páginas carregadas ao abrir o app)
    const prev = h('iframe', { class: 'ov-prev', tabindex: '-1', title: name });
    prev.dataset.src = `overlay.html?preview=${key}&v=${encodeURIComponent(version || '')}`;
    previewObserver().observe(prev);
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
  $('set-lang').value = settings.language || 'pt';
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
  $('discord-status').textContent = st === 'connected' ? t('· conectado') : st === 'connecting' ? t('· procurando o Discord aberto…') : '';
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
  els.setMsg.textContent = settings.discordRpc && !settings.discordClientId ? t('Salvo. Falta o Application ID do Discord para ativar o status.') : t('Salvo.');
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
  els.impMsg.textContent = tr('Flash agora no {k}. Clique em Importar no Invocador para aplicar.', { k: settings.flashKey });
}
window.overlay.getSettings().then((s) => { settings = s; showFlashKey(); });

$('set-test').addEventListener('click', () => window.overlay.previewOverlay());

/* ---------- idioma na barra do topo (bandeiras desenhadas em SVG: o Windows não mostra emoji de bandeira) ---------- */
function flagSvg(lang) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 30 20');
  svg.setAttribute('class', 'flag');
  const add = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); svg.append(el); return el; };
  if (lang === 'pt') { // Brasil
    add('rect', { width: 30, height: 20, fill: '#009c3b' });
    add('polygon', { points: '15,2.5 27.5,10 15,17.5 2.5,10', fill: '#ffdf00' });
    add('circle', { cx: 15, cy: 10, r: 4.6, fill: '#002776' });
    add('path', { d: 'M10.6 9.2 Q15 7.6 19.4 10.4', stroke: '#fff', 'stroke-width': 0.9, fill: 'none' });
  } else if (lang === 'en') { // Estados Unidos
    add('rect', { width: 30, height: 20, fill: '#b22234' });
    for (let i = 0; i < 6; i++) add('rect', { y: (2 * i + 1) * 20 / 13, width: 30, height: 20 / 13, fill: '#fff' });
    add('rect', { width: 13, height: 20 * 7 / 13, fill: '#3c3b6e' });
  } else { // Espanha
    add('rect', { width: 30, height: 20, fill: '#aa151b' });
    add('rect', { y: 5, width: 30, height: 10, fill: '#f1bf00' });
  }
  return svg;
}
function drawLangButton() {
  $('lang-btn').replaceChildren(flagSvg(LANG), h('b', { text: LANG.toUpperCase() }));
  $('lang-btn').title = t('Idioma');
}
function closeLangMenu() { const m = document.querySelector('.lang-menu'); if (m) m.remove(); }
$('lang-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (document.querySelector('.lang-menu')) { closeLangMenu(); return; }
  const r = $('lang-btn').getBoundingClientRect();
  const menu = h('div', { class: 'lang-menu' }, ...Object.entries(LANGS).map(([code, name]) => {
    const b = h('button', { type: 'button', class: code === LANG ? 'on' : '' }, flagSvg(code), h('span', { text: name }));
    b.addEventListener('click', async () => {
      closeLangMenu();
      if (code === LANG) return;
      els.status.textContent = t('Reiniciando no idioma escolhido…');
      await window.overlay.setSettings({ language: code }); // o app reinicia sozinho no idioma novo
    });
    return b;
  }));
  menu.style.top = `${Math.round(r.bottom + 6)}px`;
  menu.style.left = `${Math.round(Math.max(8, r.right - 160))}px`;
  document.body.append(menu);
});
document.addEventListener('click', closeLangMenu);
drawLangButton();
// Idioma: salva na hora e o app reinicia já no idioma novo (telas e dados da Riot)
$('set-lang').addEventListener('change', async () => {
  els.setMsg.textContent = t('Reiniciando no idioma escolhido…');
  settings = await window.overlay.setSettings({ language: $('set-lang').value });
});
$('set-diag').addEventListener('click', async () => {
  const d = await window.overlay.getDiagnostics();
  const box = $('diag');
  const key = d.hook.loaded
    ? `ok${d.hook.lastKeyAgoMs === null ? ' (ainda não detectei nenhuma tecla: aperte uma)' : `, última tecla há ${Math.round(d.hook.lastKeyAgoMs / 1000)} s`} · TAB pressionado ${d.hook.tabPresses}×`
    : d.hook.poller === 'ok' ? 'desligado (o leitor direto já funciona; o hook só entra como reserva)' : `FALHOU (${d.hook.error || 'não iniciado'}): overlay fica sempre visível`;
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
    checking: t('Procurando…'),
    downloading: t('Baixando {v} {p}%', { v: u.version || '', p: u.percent || 0 }),
    ready: t('Reiniciar e atualizar ({v})', { v: u.version }),
    none: t('Atualizado ✓'),
  }[u.state] || t('Procurar atualizações');
  btn.title = u.message || '';
  if (u.state === 'error' && u.message) els.status.textContent = u.message;
}
$('update-btn').addEventListener('click', async () => {
  const btn = $('update-btn');
  if ($('update-label').textContent.startsWith('Reiniciar')) return window.overlay.installUpdate();
  $('update-label').textContent = t('Procurando…');
  showUpdate(await window.overlay.checkUpdate());
});
$('set-update-now').addEventListener('click', async () => {
  els.setMsg.textContent = t('Verificando…');
  const u = await window.overlay.checkUpdate();
  els.setMsg.textContent = u.message || (u.state === 'downloading' ? tr('Baixando {v}…', { v: u.version }) : u.state === 'ready' ? t('Atualização pronta.') : t('Verificação concluída.'));
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
window.overlay.onStatus((s) => { els.status.textContent = t(s.text); });
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
  tile.title = tr('{champ} · #{rank} na rota · {n} partidas · KDA {kda} · clique para ver build, counters e sinergias', { champ: r.name, rank: r.rank, n: r.games.toLocaleString(), kda: r.kda });
  if (r.id) tile.addEventListener('click', () => openChamp(r.id, r.role));
  return tile;
}

function drawTierList() {
  const body = $('tl-body');
  if (!tl || !tl.data) {
    const msg = tl && tl.error ? tr('Não consegui carregar: {err}', { err: tl.error })
      : tl && tl.loading ? tr('Montando a tier list de {elo} ({n} campeões, ~30 s na primeira vez)…', { elo: t(TL_ELO_PT[tlElo]), n: tl.loading })
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

  // Seu pool (estrela na página do campeão) aparece fixo no topo
  const mine = rows.filter((r) => r.id && inPool(r.id, r.name, r.role));
  const pinned = mine.length && !q ? h('section', { class: 'tl-group tPool' },
    h('div', { class: 'tl-rail' }, h('span', { class: 'tl-letter', text: '★' })),
    h('div', { class: 'tl-grid' }, ...mine.map((r) => tlTile(r, tlRole === 'all')))) : null;
  if (sort !== 'tier') {
    body.replaceChildren(...[pinned, h('section', { class: 'tl-group' }, h('div', { class: 'tl-grid' }, ...rows.map((r) => tlTile(r, tlRole === 'all'))))].filter(Boolean));
    return;
  }
  body.replaceChildren(pinned || '', ...TL_TIERS.map(([n, letter]) => {
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

const normName = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function inPool(id, name, role) {
  const list = (settings && settings.picker && settings.picker.pool[role]) || [];
  return list.some((n) => normName(n) === normName(id) || normName(n) === normName(name));
}
/** Estrela: põe/tira o campeão do pool da rota (o mesmo pool das configurações, que dá bônus na sugestão de picks). */
async function togglePool(id, name, role) {
  const list = (settings.picker.pool[role] || []).slice();
  const next = inPool(id, name, role) ? list.filter((n) => normName(n) !== normName(id) && normName(n) !== normName(name)) : [...list, name || id];
  settings = await window.overlay.setSettings({ picker: { pool: { [role]: next } } });
  drawChamp();
}

const VERDICT = { buff: ['Buffado neste patch', 'ok'], nerf: ['Nerfado neste patch', 'bad'], ajuste: ['Ajustado neste patch', 'warn'] };
function patchLines(p) {
  return p.changes.map((c) => `${c.what}: ${c.text || `${c.from} → ${c.to}`}`).join('\n');
}
function patchChip(p) {
  const [label, cls] = VERDICT[p.verdict] || VERDICT.ajuste;
  const el = h('span', { class: `chip ${cls}`, text: `${t(label)} · ${p.patch}` });
  tipOn(el, t(label), patchLines(p));
  return el;
}
function patchCard(p) {
  const [label, cls] = VERDICT[p.verdict] || VERDICT.ajuste;
  return h('section', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', { text: `${t('Patch')} ${p.patch}` }), h('span', { class: 'spacer' }), h('span', { class: `chip ${cls}`, text: label })),
    h('div', { class: 'cd-patch' }, ...p.changes.map((c) => h('div', { class: 'cd-pc' },
      h('div', { class: 'small strong', text: c.what }),
      c.text ? h('div', { class: 'muted small', text: c.text })
        : h('div', { class: 'small' }, h('span', { class: 'muted', text: `${c.from} → ` }), h('span', { class: c.buff === true ? 'up' : c.buff === false ? 'down' : '', text: String(c.to) })))),
    p.more ? h('div', { class: 'muted small cd-pc', text: tr('+{n} mudanças nas notas do patch', { n: p.more }) } ) : null));
}

/** Ordem de prioridade das habilidades: "Q › W › E" e o que pegar nos níveis 1–3. */
function skillPrio(skills) {
  const seq = skillOrder18(skills);
  const count = (k, n) => seq.slice(0, n).filter((x) => x === k).length;
  // a que fecha primeiro (5 pontos) vem antes
  const done = (k) => { let n = 0; for (let i = 0; i < seq.length; i++) if (seq[i] === k && ++n === 5) return i; return 99; };
  return { prio: ['Q', 'W', 'E'].sort((a, b) => done(a) - done(b) || count(b, 18) - count(a, 18)), start: seq.slice(0, 3) };
}
function skillSummary(skills) {
  const { prio, start } = skillPrio(skills);
  const out = h('div', { class: 'sk-sum' });
  prio.forEach((k, i) => { if (i) out.append(h('span', { class: 'sk-arr', text: '›' })); out.append(h('span', { class: `sk-key s-${k}`, text: k })); });
  out.append(h('span', { class: 'muted small', text: tr('níveis 1–3: {seq}', { seq: start.join(' · ') }) }));
  return out;
}

/** Caminho de compras em linha do tempo: início → itens com custo, e os picos de força (1º e 2º lendário). */
function drawBuildPath(g, owned = null) {
  const items = g.fullBuild;
  const isBoot = (it) => g.boots.some((b) => b.id === it.id);
  let legend = 0;
  const steps = [h('div', { class: 'bp-step' },
    h('div', { class: 'bp-icons' }, ...g.starterCounts.map((it) => h('div', { class: 'it' },
      icon(ddVerImg(`item/${it.id}.png`), 'it-icon', it.name), it.count > 1 ? h('span', { class: 'cnt', text: `x${it.count}` }) : null))),
    h('span', { class: 'bp-cap', text: 'Início' }))];
  items.forEach((it) => {
    const boot = isBoot(it);
    const spike = !boot && it.gold >= 2200 && ++legend <= 2;
    const have = owned && owned.has(it.id);
    const el = h('div', { class: `bp-step${spike ? ' spike' : ''}${have ? ' own' : ''}` },
      h('div', { class: 'bp-icons' }, icon(ddVerImg(`item/${it.id}.png`), 'it-icon', it.name)),
      h('span', { class: 'bp-cap', text: it.gold ? `${it.gold.toLocaleString('pt-BR')} g` : '' }),
      have ? h('span', { class: 'bp-own', text: '✓' }) : null,
      spike ? h('span', { class: 'bp-spike', text: legend === 1 ? '1º pico' : '2º pico' }) : null);
    tipOn(el, it.name, spike ? tr('{n}º item lendário: pico de força — bom momento para lutar.', { n: legend }) : boot ? t('Botas') : '');
    steps.push(h('span', { class: 'bp-arr', text: '›' }), el);
  });
  const sit = (g.situational || []).length ? drawBuild({ ...g, starterCounts: [], fullBuild: [] }).lastChild : null;
  return h('div', { class: 'build' }, h('div', {}, head('Caminho de compras'), h('div', { class: 'bp' }, ...steps)), sit);
}

/** Build em texto para colar no Discord. */
function buildText(d, page, role) {
  const g = d.guide;
  const lines = [`${d.champion.name} · ${t(ROLE_NAME[role] || role || '')}${d.winRate ? ` · ${(d.winRate * (d.winRate <= 1 ? 100 : 1)).toFixed(1)}% WR` : ''}`];
  const r = g.runes;
  if (page && page.view) lines.push(`${t('Runas')}: ${page.view.primaryStyleName} + ${page.view.subStyleName}${page.view.perks && page.view.perks.length ? ` (${page.view.perks.slice(0, 6).map((x) => x.name).join(', ')})` : ''}`);
  else if (r) lines.push(`${t('Runas')}: ${r.primaryStyleName} + ${r.subStyleName} (${r.perks.slice(0, 6).map((x) => x.name).join(', ')})`);
  if (g.spells.length) lines.push(`${t('Feitiços')}: ${g.spells.map((x) => x.name).join(' + ')}`);
  if (g.starterCounts.length) lines.push(`${t('Início')}: ${g.starterCounts.map((x) => (x.count > 1 ? `${x.name} x${x.count}` : x.name)).join(', ')}`);
  lines.push(`${t('Itens')}: ${g.fullBuild.map((x) => x.name).join(' > ')}`);
  if (g.skills.length) lines.push(`${t('Habilidades')}: ${skillPrio(g.skills).prio.join(' > ')}`);
  lines.push(`— Nexo · OP.GG`);
  return lines.join('\n');
}

function drawChamp() {
  const box = $('tl-champ');
  const cv = champView;
  if (!cv) return;
  const d = cv.data;
  const back = h('button', { class: 'btn ghost', type: 'button', text: '← Tier list' });
  back.addEventListener('click', closeChamp);
  const name = d ? d.champion.name : '';
  const fav = cv.role && inPool(cv.id, name, cv.role);
  const star = h('button', { class: `cd-star${fav ? ' on' : ''}`, type: 'button', text: fav ? '★' : '☆',
    title: fav ? 'Tirar do seu pool desta rota' : 'Adicionar ao seu pool desta rota (sobe na sugestão de picks)' });
  star.addEventListener('click', () => togglePool(cv.id, name, cv.role));
  if (!cv.role) star.hidden = true;
  const headL = h('div', { class: 'cd-head' },
    version ? h('img', { class: 'cd-ico', src: champIcon(version, cv.id), alt: '' }) : null,
    h('div', {}, h('div', { class: 'eyebrow', text: d && d.champion.title ? d.champion.title : 'Campeão' }),
      h('div', { class: 'cd-name' }, h('h1', { text: name || cv.id }), star)));
  const chips = [];
  const pct = (x) => `${(x * (x <= 1 ? 100 : 1)).toFixed(1)}%`;
  if (d && d.tier) chips.push(h('span', { class: `chip tier-${d.tier}`, text: `Tier ${['', 'S', 'A', 'B', 'C', 'D'][d.tier] || d.tier}` }));
  if (d && d.winRate) chips.push(h('span', { class: 'chip', text: `${pct(d.winRate)} WR` }));
  if (d && d.pickRate) chips.push(h('span', { class: 'chip', text: `${pct(d.pickRate)} pick` }));
  if (d && d.banRate) chips.push(h('span', { class: 'chip', text: `${pct(d.banRate)} ban` }));
  if (d && d.rank && d.rankPrev && d.rank !== d.rankPrev) {
    const up = d.rank < d.rankPrev;
    chips.push(h('span', { class: `chip ${up ? 'ok' : 'bad'}`, title: tr('Posição na tier list: {now}º (era {prev}º)', { now: d.rank, prev: d.rankPrev }), text: `${up ? '▲' : '▼'} ${Math.abs(d.rank - d.rankPrev)}` }));
  }
  if (d && d.patch && d.patch.verdict) chips.push(patchChip(d.patch));
  chips.push(h('span', { class: 'chip', text: 'OP.GG' }));
  const splash = h('img', { class: 'cd-splash', src: `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${cv.id}_0.jpg`, alt: '' });
  splash.addEventListener('error', () => splash.remove());
  const top = h('div', { class: 'cd-hero' }, splash, h('div', { class: 'cd-hero-in' },
    h('div', { class: 'cd-top' }, back, headL), h('div', { class: 'chips' }, ...chips)));

  const roles = (d && d.roles && d.roles.length ? d.roles : cv.role ? [cv.role] : []);
  const seg = roles.length > 1 ? h('div', { class: 'seg' }, ...roles.map((r) => {
    const b = h('button', { class: `seg-btn${r === cv.role ? ' on' : ''}`, type: 'button' }, roleImg(r, 'seg-role'), h('span', { text: ROLE_NAME[r] || r }));
    b.addEventListener('click', () => { if (r === cv.role) return; cv.role = r; cv.data = null; cv.runePage = 0; drawChamp(); loadChamp(); });
    return b;
  })) : null;

  if (!d || !d.guide) {
    const msg = d && d.error ? tr('Sem dados do OP.GG: {err}', { err: d.error }) : tr('Carregando a build do OP.GG…');
    box.replaceChildren(top, seg || '', h('section', { class: 'card' }, h('p', { class: 'muted pad', text: msg })));
    return;
  }
  const g = d.guide;
  const pages = d.runePages || [];
  const page = pages[cv.runePage] || pages[0] || null;

  // build: runas | feitiços + itens
  const left = h('div', { class: 'g-sec' });
  if (page && page.runeTree) {
    left.append(head(`${tr('Runas')} · ${page.view.primaryStyleName} + ${page.view.subStyleName}`),
      runePageTabs(pages, cv.runePage, (i) => { cv.runePage = i; drawChamp(); }) || '');
    const st = page.stats || {};
    if (pages.length < 2 && (st.pickRate || st.winRate)) left.append(h('p', { class: 'muted small rp-one', text: `${Math.round((st.pickRate || 0) * 100)}% pick${st.winRate ? ` · ${(st.winRate * 100).toFixed(1)}% WR` : ''}` }));
    left.append(editableRunes(page.runeTree, `c:${cv.id}:${cv.role}:${cv.runePage}`, drawChamp));
  }
  const right = h('div', { class: 'g-sec' });
  if (g.spells.length) right.append(head('Feitiços'), drawSpells(g), h('div', { style: 'height:22px' }));
  right.append(drawBuildPath(g));
  const msg = h('span', { class: 'muted small' });
  const imp = h('button', { class: 'btn primary', type: 'button', text: 'Importar runas e feitiços' });
  imp.addEventListener('click', async () => {
    msg.textContent = t('Importando…');
    const edited = runeEdits.get(`c:${cv.id}:${cv.role}:${cv.runePage}`);
    const res = edited ? await importWithEditedRunes(cv.id, edited, 'both', (w) => window.overlay.importBuild(cv.id, w, 0, cv.runePage, cv.role))
      : await window.overlay.importBuild(cv.id, 'both', 0, cv.runePage, cv.role);
    msg.textContent = res.ok ? tr('Importado: {what}.', { what: res.done.join(', ') }) : tr('Não consegui importar: {err}', { err: res.error });
  });
  const copyMsg = h('span', { class: 'muted small' });
  const copy = h('button', { class: 'btn ghost', type: 'button', text: 'Copiar como texto' });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(buildText(d, page, cv.role)); copyMsg.textContent = t('Copiado.'); } catch { copyMsg.textContent = t('Não consegui copiar.'); }
    setTimeout(() => { copyMsg.textContent = ''; }, 2500);
  });
  const buildCard = h('section', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', { text: `Build · ${t(ROLE_NAME[cv.role] || '')}` }), h('span', { class: 'spacer' }), seg || ''),
    h('div', { class: 'g-grid' }, left, right),
    cv.role ? buildLab({ id: cv.id, role: cv.role, skillIcons: g.skillIcons, vsOptions: [...(d.losesTo || []), ...(d.beats || [])].filter((c) => c.id).slice(0, 8).map((c) => ({ id: c.id, name: c.name })),
      runeKey: `c:${cv.id}:${cv.role}:${cv.runePage}`, onRunes: (pg) => { runeEdits.set(`c:${cv.id}:${cv.role}:${cv.runePage}`, pg); drawChamp(); } }) : null,
    g.skills.length ? h('div', { class: 'g-full' }, head('Ordem de habilidades'), skillSummary(g.skills), drawSkills(g)) : null,
    d.kit ? abilityBlock(d.kit, 'g-full') : null,
    h('div', { class: 'card-f' }, msg, copyMsg, copy, imp));

  // counters e sinergias
  const list = (title, rows, good, empty) => h('section', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', { text: title })),
    rows && rows.length ? h('div', { class: 'cd-list' }, ...rows.map((c) => champLine(c, cv.role, good))) : h('p', { class: 'muted pad', text: empty }));
  const synTitle = `${tr('Melhores parceiros')}${d.partner ? ` · ${t(ROLE_NAME[d.partner])}` : ''}`;
  const synEmpty = d.synergyError ? tr('Não consegui carregar: {err}', { err: d.synergyError }) : d.synergies ? 'Sem amostra suficiente.' : 'Carregando…';
  const side = h('div', { class: 'cd-side' },
    d.patch && d.patch.verdict ? patchCard(d.patch) : null,
    list('Perde para', d.losesTo, false, 'Sem dados de counters.'),
    list('Ganha de', d.beats, true, 'Sem dados de counters.'),
    list(synTitle, d.synergies, true, synEmpty));
  box.replaceChildren(top, h('div', { class: 'cd-grid' }, buildCard, side));
}

function goPage(p) {
  settingsOpen = false;
  if ((p === 'skins' || p === 'items') && !can(p)) { proWhy = p; p = 'pro'; } // abas do Pro: mostra os planos
  page = p;
  if (p === 'pro') drawPro();
  showView(null);
  if (p === 'tierlist') { closeChamp(); tlRoleButtons(); loadTierList(); }
  if (p === 'history') loadHistory();
  if (p === 'patches') loadPatches();
  if (p === 'profile' || p === 'skins') loadProfile();
  if (p === 'items') loadItems();
}
$('nav-tier').addEventListener('click', () => goPage('tierlist'));
$('nav-history').addEventListener('click', () => goPage('history'));
$('nav-patches').addEventListener('click', () => goPage('patches'));
$('nav-profile').addEventListener('click', () => goPage('profile'));
$('nav-skins').addEventListener('click', () => goPage('skins'));
$('nav-pro').addEventListener('click', () => { proWhy = ''; goPage('pro'); });
$('nav-items').addEventListener('click', () => goPage('items'));
// Início também abre durante o champ select/partida (a aba AO VIVO continua a um clique)
$('nav-home').addEventListener('click', () => goPage(lastView === 'waiting' ? 'auto' : 'home'));
for (const id of ['nav-select', 'nav-game']) $(id).addEventListener('click', () => goPage('auto'));

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
  return h('div', { class: 'g-sub' }, h('span', { text: tr('Metas no ritmo de {tier}:', { tier: t(TIER_PT[g.aimTier] || g.aimTier) }) }), part('CS/min', g.cs), part('Visão/min', g.vision));
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
    gr.focus ? h('div', { class: 'gr-focus' }, h('b', { text: tr('Foco para a próxima: {area}', { area: t(gr.focus.label) }) }), h('span', { text: gr.focus.tip })) : null,
    h('div', { class: 'muted small gr-note', text: tr('Comparado com o ritmo de {tier} (um elo acima do seu).', { tier: t(TIER_PT[gr.aimTier] || gr.aimTier) }) }));
}

/** Placar dos 10 jogadores, com barra de dano e itens. */
function scoreboard(detail) {
  const all = detail.teams.flatMap((t) => t.players);
  const maxDmg = Math.max(1, ...all.map((p) => p.stats.damage || 0));
  const team = (t) => h('div', { class: `sb-team ${t.win ? 'win' : 'lose'}` },
    h('div', { class: 'sb-th' }, h('b', { text: t.win ? 'Vitória' : 'Derrota' }), h('span', { class: 'muted small', text: tr('{k} abates · {g} de ouro', { k: t.kills, g: fmtK(t.gold) }) })),
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
  if (!res.ok) { box.replaceChildren(h('p', { class: 'muted pad', text: tr('Não consegui abrir a partida: {err}', { err: res.error }) })); return; }
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
      h('div', { class: 'h-col' }, h('div', { class: 'lbl' }, h('span', { text: o ? tr('Você x {champ}', { champ: o.champion }) : 'Você' })),
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
        o ? h('div', { class: 'lbl', style: 'margin-top:12px' }, h('span', { text: tr('Itens de {champ}', { champ: o.champion }) })) : null, o ? items(o.items) : null)),
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
    h('span', { text: tr('escala ±{v}', { v: fmtK(maxV) }) })));
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
  $('wn-ver').textContent = `${tr('Novidades')} · v${cur.version}`;
  $('wn-title').textContent = cur.title;
  $('wn-items').replaceChildren(...cur.items.map((t) => h('li', { text: t })));
  const old = wn.history.filter((e) => e.version !== cur.version);
  $('wn-old').hidden = !old.length;
  $('wn-hist').replaceChildren(...old.slice(0, 4).map((e) => h('div', { class: 'wn-old' }, h('b', { text: `v${e.version} · ${e.title}` })))); // versões anteriores: só o título
  $('whatsnew').hidden = false;
}
$('wn-ok').addEventListener('click', () => { $('whatsnew').hidden = true; window.overlay.seenWhatsNew(); });
$('whatsnew').addEventListener('click', (e) => { if (e.target.id === 'whatsnew') $('wn-ok').click(); });
setTimeout(() => showWhatsNew(false), 1200);

/* ---------- patch nos seus campeões ---------- */

let patchLoadedFor = '';
async function loadPatchCard(state) {
  const top = (state && state.home && state.home.top) || [];
  const key = top.map((c) => c.id).join(',') || (state && state.client) || '';
  if (key === patchLoadedFor) return;
  patchLoadedFor = key;
  const res = await window.overlay.getPatchMine().catch(() => null);
  if (!res || !res.champs || !res.champs.length) { $('patch-card').hidden = true; return; }
  const short = (v) => String(v || '').split('.').slice(0, 2).join('.');
  $('patch-title').textContent = tr('Patch {v} nos seus campeões', { v: short(res.patch) });
  $('patch-src').textContent = res.source === 'notes'
    ? 'Notas oficiais da Riot: todas as mudanças, inclusive de dano'
    : 'Data Dragon: recarga, custo, alcance e atributos (mudança só de dano não aparece)';
  const changed = res.champs.filter((c) => c.changes.length || c.touched);
  const quiet = res.champs.filter((c) => !c.changes.length && !c.touched);
  const VERD = { buff: 'Buff', nerf: 'Nerf', ajuste: 'Ajuste' };
  const line = (x) => (x.from != null && x.to != null
    ? h('li', { class: x.buff === true ? 'up' : x.buff === false ? 'down' : '' }, document.createTextNode(`${x.what}: `), h('s', { text: x.from }), document.createTextNode(' → '), h('b', { text: x.to }))
    : h('li', {}, document.createTextNode(`${x.what ? `${x.what}: ` : ''}${x.text || ''}`)));
  const rows = changed.map((c) => {
    const more = c.changes.length - 4;
    const row = h('div', { class: `patch-row v-${c.verdict || 'ajuste'}` },
      version ? h('img', { class: 'ic', src: champIcon(version, c.id), alt: '' }) : h('span', { class: 'ic' }),
      h('div', { style: 'min-width:0' },
        h('div', { class: 'nm' }, document.createTextNode(c.name),
          h('span', { class: `pv ${c.verdict || 'ajuste'}`, text: c.verdict ? VERD[c.verdict] : 'Alterado' })),
        c.changes.length
          ? h('ul', { class: 'patch-ch' }, ...c.changes.slice(0, 4).map(line), more > 0 ? h('li', { class: 'more', text: tr(more === 1 ? '+1 mudança nas notas' : '+{n} mudanças nas notas', { n: more }) }) : null)
          : h('div', { class: 'muted small', text: 'Mexido neste patch, sem números no Data Dragon: provavelmente dano.' })));
    row.addEventListener('click', () => goPage('patches'));
    row.title = 'Abrir as notas do patch';
    return row;
  });
  if (!changed.length) rows.push(h('p', { class: 'muted small pad', text: 'Nenhum dos seus campeões mudou neste patch.' }));
  if (quiet.length) rows.push(h('p', { class: 'muted small pad', text: `${tr('Sem mudanças: {list}', { list: quiet.map((c) => c.name).join(', ') })}${res.mineCount > quiet.length + changed.length ? tr(' e outros') : ''}.` }));
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
  $('pn-title').textContent = pn.version ? `Patch ${pn.version}` : t('Patch notes');
  $('pn-date').textContent = n && n.date ? new Date(n.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
  $('pn-date').hidden = !$('pn-date').textContent;
  if (!n) {
    $('pn-summary').replaceChildren();
    $('pn-toc').replaceChildren();
    body.replaceChildren(h('section', { class: 'card' }, h('p', { class: 'muted pad', text: pn.loading ? 'Carregando as notas do site da Riot…' : pn.error ? tr('Não consegui carregar: {err}', { err: pn.error }) : 'Carregando…' })));
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

const pf = { tab: 'mastery', data: null, sel: null, cls: 'all', q: '', loading: false, sugMode: 'mine', cur: new Set(), sk: { q: '', own: 'all', rar: 'all', legacy: true, sort: 'rarity', limit: 60 } };
const PF_TABS = [['mastery', 'Maestria'], ['style', 'Estilo de jogo']]; // coleção/skins ganhou aba própria (Skins)
const PF_CLASSES = [['all', 'Todas'], ['Fighter', 'Lutadores'], ['Mage', 'Magos'], ['Assassin', 'Assassinos'], ['Marksman', 'Atiradores'], ['Tank', 'Tanques'], ['Support', 'Suportes']];
const RARITY_CLS = { Suprema: 'ult', Mítica: 'myth', Exaltada: 'myth', Transcendente: 'myth', Lendária: 'leg', Épica: 'epic', Comum: 'com' };

function ago(ts) {
  if (!ts) return tr('nunca');
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return tr('hoje');
  if (d === 1) return tr('ontem');
  if (d === 2) return tr('anteontem');
  if (d < 30) return tr('há {n} dias', { n: d });
  const m = Math.floor(d / 30);
  if (m < 12) return tr(m === 1 ? 'há 1 mês' : 'há {n} meses', { n: m });
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
  pf.data = await window.overlay.getProfile(force).catch((e) => ({ error: e.message }));
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

/** Aba Skins: coleção, sugestões e galeria (mesmos dados do Perfil, lidos uma vez). */
function drawSkins() {
  const body = $('sk-body');
  const d = pf.data;
  const s = d && d.summoner;
  $('sk-who').textContent = s ? `${s.gameName}${s.tagLine ? `#${s.tagLine}` : ''}` : t('Sua coleção');
  if (!d || pf.loading) { body.replaceChildren(pfCard(null, h('p', { class: 'muted pad', text: 'Lendo sua coleção no cliente…' }))); return; }
  if (!d.mastery && !d.collection) { body.replaceChildren(pfCard(null, h('p', { class: 'muted pad', text: d.error || 'Abra o cliente do LoL para ver suas skins.' }))); return; }
  const animKey = `skins:${d.version}`;
  body.classList.toggle('pf-anim', animKey !== pf.skAnimKey);
  pf.skAnimKey = animKey;
  body.replaceChildren(...drawCollectionTab(d));
}

function drawProfile() {
  if (page === 'skins') { drawSkins(); return; }
  const body = $('pf-body');
  const d = pf.data;
  const s = d && d.summoner;
  $('pf-who').textContent = s ? `${s.gameName}${s.tagLine ? `#${s.tagLine}` : ''}` : t('Seu perfil');
  $('pf-title').textContent = t({ mastery: 'Sua maestria', style: 'Seu estilo de jogo', collection: 'Sua coleção' }[pf.tab]);
  if (!d || pf.loading) { body.replaceChildren(pfCard(null, h('p', { class: 'muted pad', text: 'Lendo maestria, histórico e coleção no cliente…' }))); return; }
  if (!d.mastery) { body.replaceChildren(pfCard(null, h('p', { class: 'muted pad', text: d.error || 'Abra o cliente do LoL para ver o perfil.' }))); return; }
  // anima só quando troca de aba ou chegam dados novos (clicar numa bolha não repete a animação)
  const animKey = `${pf.tab}:${pf.cls}:${d.version}:${d.mastery.total}`;
  body.classList.toggle('pf-anim', animKey !== pf.animKey);
  pf.animKey = animKey;
  if (pf.tab === 'style') body.replaceChildren(...drawStyleTab(d));
  else body.replaceChildren(...drawMasteryTab(d));
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
    pfStat(`${m.played}`, 'Campeões jogados', tr('de {n}', { n: m.champions })),
    m.main ? h('div', { class: 'pf-stat main' }, h('img', { class: 'ic', src: champIcon(d.version, m.main.id), alt: '' }),
      h('div', {}, h('b', { text: m.main.name }), h('span', { text: 'Seu main' }), h('em', { text: tr('{p}% dos seus pontos', { p: Math.round(m.main.share * 100) }) }))) : null);

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
    const el = h('button', { class: `pf-bub${b.row.id === pf.sel ? ' sel' : ''}`, type: 'button', title: `${b.row.name} · ${tr('nível {n}', { n: b.row.level })} · ${b.row.points.toLocaleString()} pts` });
    el.style.cssText = `left:${((b.x - b.r) / W) * 100}%;top:${b.y - b.r}px;width:${b.r * 2}px;height:${b.r * 2}px;background-image:url("${champIcon(d.version, b.row.id)}")`;
    if (b.r >= 22) el.append(h('span', { class: 'pf-lv', text: String(b.row.level) }));
    el.addEventListener('click', () => { pf.sel = b.row.id; drawProfile(); });
    area.append(el);
  }
  const left = pfCard(null, h('div', { class: 'pf-toolbar' }, filters), area,
    h('p', { class: 'muted small pf-hint', text: tr('Clique numa bolha para ver os detalhes · {n} campeões a mais na lista abaixo', { n: Math.max(0, rows.length - 70) }) }));

  // painel do campeão selecionado
  const c = m.rows.find((r) => r.id === pf.sel) || m.rows[0];
  const detail = c ? pfCard(null,
    h('div', { class: 'pf-dh' }, h('img', { class: 'pf-dico', src: champIcon(d.version, c.id), alt: '' }),
      h('div', {}, h('h2', { text: c.name }), h('div', { class: 'muted small', text: tr('Maestria nível {n}', { n: c.level }) })),
      c.grades.length ? h('span', { class: 'pf-grade', text: c.grades[c.grades.length - 1] }) : null),
    h('div', { class: 'pf-kv' },
      h('div', {}, h('span', { text: 'Pontos' }), h('b', { text: c.points.toLocaleString('pt-BR') })),
      h('div', {}, h('span', { text: 'Última partida' }), h('b', { text: ago(c.lastPlayTime) }))),
    h('div', { class: 'pf-prog' },
      h('div', { class: 'pf-prog-h' }, h('span', { text: tr('Rumo ao nível {n}', { n: c.level + 1 }) }), h('b', { text: c.untilNext > 0 ? tr('faltam {n}', { n: c.untilNext.toLocaleString() }) : 'pronto' })),
      h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${Math.round(c.progress * 100)}%` })),
      c.daysToNext ? h('div', { class: 'pf-pace', text: tr(c.daysToNext === 1 ? 'No seu ritmo atual, nível {n} em ~1 dia' : 'No seu ritmo atual, nível {n} em ~{d} dias', { n: c.level + 1, d: c.daysToNext }) }) : null),
    c.marksNeeded ? h('div', { class: 'pf-row' }, h('span', { class: 'muted small', text: 'Marcas para subir' }),
      h('span', { class: 'pf-marks' }, ...Array.from({ length: c.marksNeeded }, (_, i) => h('i', { class: i < c.marks ? 'on' : '' })))) : null,
    c.grades.length ? h('div', { class: 'pf-row col' }, h('span', { class: 'muted small', text: 'Notas desta temporada' }),
      h('div', { class: 'pf-grades' }, ...c.grades.map((g) => h('span', { class: 'pf-grade sm', text: g })))) : null,
    c.milestone ? h('div', { class: 'muted small', text: tr('Próximo marco: {m}', { m: c.milestone }) }) : null,
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
    pfStat(String(st.unique), 'Campeões diferentes', tr('nas suas últimas {n} partidas', { n: st.recent })),
    st.mainIndex ? pfStat(`${Math.round(st.mainIndex.share * 100)}%`, 'Índice de main', st.mainIndex.name) : null,
    pfStat(String(st.srGames), "Partidas no Summoner's Rift", `de ${st.analyzed} lidas`),
    st.winRate != null ? pfStat(`${Math.round(st.winRate * 100)}%`, 'Vitórias', 'últimas partidas') : null);
  // mini mapa com as rotas
  // posições sobre o mapa do Summoner's Rift (base azul embaixo à esquerda)
  const POS = { top: [17, 19], jungle: [33, 57], middle: [50, 50], bottom: [83, 80], utility: [70, 87] };
  const map = h('div', { class: 'pf-map' }, h('img', { class: 'pf-map-img', src: 'img/sr-map.jpg', alt: "Summoner's Rift" }), h('div', { class: 'pf-map-shade' }),
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
    h('p', { class: 'muted', text: st.mainRole ? tr('{p}% das suas partidas no Summoner\'s Rift são de {role}. {s}% de tudo o que você joga é Ranqueada Solo/Duo.', { p: Math.round(st.mainRole.share * 100), role: t(st.mainRole.label), s: Math.round(st.soloShare * 100) }) : 'Sem partidas suficientes.' }),
    h('div', { class: 'pf-ch', text: 'Classes que você domina' }),
    st.profile ? h('p', { class: 'small', text: `Seu perfil: ${st.profile}` }) : null,
    ...st.classes.map((c) => h('div', { class: 'pf-brow' }, h('span', { text: c.label }), h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${Math.round(c.share * 100)}%` })), h('b', { text: `${Math.round(c.share * 100)}%` }))),
    h('div', { class: 'pf-ch', text: 'Modos que mais joga' }),
    h('div', { class: 'chips' }, ...st.modes.slice(0, 5).map((m) => h('span', { class: 'chip', text: `${m.label} · ${m.games}` }))));
  const pool = pfCard(tr('Seu leque de campeões (últimas {n})', { n: st.recent }), h('div', { class: 'pf-pool' }, ...st.pool.map((p) => h('div', { class: 'pf-pc', title: tr('{champ}: {n} partidas', { champ: p.name, n: p.games }) },
    h('img', { src: champIcon(d.version, p.id), alt: '' }), h('span', { text: String(p.games) })))));
  return [stats, pfCard(null, h('div', { class: 'pf-style' }, map, info)), pool,
    h('p', { class: 'muted small', text: 'O cliente do LoL só guarda as últimas partidas; o app lê as mais recentes a cada abertura.' })];
}

function drawCollectionTab(d) {
  const c = d.collection;
  if (!c) return [pfCard(null, h('p', { class: 'muted pad', text: d.collectionError || 'Coleção indisponível.' }))];
  const pc = (a, b) => `${Math.round((a / Math.max(1, b)) * 100)}%`;
  const stats = h('div', { class: 'pf-stats' },
    pfStat(`${c.champions.owned}`, 'Campeões', `${tr('de {n}', { n: c.champions.total })} · ${pc(c.champions.owned, c.champions.total)}`),
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
  // sugestões: filtro (que jogo / lançamentos / promoção) + moeda de cada skin
  const S = d.suggestions && !Array.isArray(d.suggestions) ? d.suggestions : { mine: d.suggestions || [], recent: [], sale: [], hasCatalog: false };
  const SUG_TABS = [['mine', 'Campeões que jogo'], ['recent', 'Lançamentos recentes'], ['sale', 'Em promoção']];
  const sugTabs = h('div', { class: 'seg' }, ...SUG_TABS.map(([k, label]) => {
    const b = h('button', { class: `seg-btn${k === pf.sugMode ? ' on' : ''}`, type: 'button', text: `${label}${S[k] && S[k].length ? ` · ${S[k].length}` : ''}` });
    b.addEventListener('click', () => { pf.sugMode = k; drawProfile(); });
    return b;
  }));
  // filtro por moeda (RP / Essência Mítica / Gacha): vazio = todas
  const sug = (S[pf.sugMode] || []).filter((x) => !pf.cur.size || pf.cur.has((x.price || {}).kind));
  const emptyTxt = pf.sugMode === 'mine' ? 'Você já tem as melhores skins dos campeões que mais joga.'
    : !S.hasCatalog ? 'Precisa do catálogo da loja do cliente (abra o cliente do LoL e clique em Atualizar).'
      : pf.sugMode === 'sale' ? 'Nenhuma skin Lendária ou melhor em promoção agora.' : 'Sem lançamentos recentes que você não tenha.';
  const tops = pfCard(null,
    h('div', { class: 'pf-toolbar' }, h('div', { class: 'pf-ch', text: 'Skins que valem o investimento' }), h('span', { class: 'spacer' }), sugTabs),
    h('p', { class: 'muted small pf-sub', text: 'Lendária, Mítica, Suprema ou de gacha que você ainda não tem. "Mais compradas" não dá: a Riot não divulga vendas.' }),
    curFilters(S[pf.sugMode] || []),
    sug.length ? h('div', { class: 'pf-sugs' }, ...sug.map((x) => h('div', { class: 'pf-sug' },
      h('img', { src: loadingUrl(x.champion, x.num), alt: '', loading: 'lazy' }),
      h('div', { class: 'pf-st' },
        h('span', { class: `rar ${RARITY_CLS[x.rarity] || ''}`, text: x.rarity }),
        h('b', { text: x.name }),
        x.why ? h('span', { class: 'muted small', text: x.why }) : null,
        priceTag(x.price))))) : h('p', { class: 'muted pad', text: emptyTxt }));
  const gallery = skinGallery(d);
  return [stats, tops, gallery, jewels, h('div', { class: 'pf-two' }, rarity, most)];
}

$('pf-refresh').addEventListener('click', () => loadProfile(true));
$('sk-refresh').addEventListener('click', () => loadProfile(true));


/** "Como funciona": marca o passo em que você está agora. */
function howState(state) {
  const open = state.client === 'open';
  const phase = lastView;
  const set = (n, cls, text) => { const el = $(`how-${n}`); if (!el) return; el.classList.remove('done', 'now'); if (cls) el.classList.add(cls); $(`how-s${n}`).textContent = text; };
  set(1, open ? 'done' : 'now', open ? '✓ cliente conectado' : 'aguardando o cliente');
  set(2, phase === 'select' ? 'now' : '', phase === 'select' ? 'agora' : '');
  set(3, phase === 'game' ? 'now' : '', phase === 'game' ? 'agora' : '');
  set(4, '', '');
}


/** Selo de preço: ícone da moeda + valor (RP, Essência Mítica, gacha, legado). */
function priceTag(p, label) {
  p = p || { kind: 'unknown' };
  const KIND = { rp: ['rp', 'RP'], me: ['essence', 'Essência Mítica'], gacha: ['gacha', 'Gacha'], legacy: ['lock', 'Legado (fora da loja)'], unknown: ['rp', '—'] };
  const [ico, name] = KIND[p.kind] || KIND.unknown;
  const val = label || (p.kind === 'gacha' ? 'Gacha (Santuário)' : p.kind === 'legacy' ? 'Legado · fora da loja'
    : p.amount ? `${p.amount.toLocaleString()} ${p.kind === 'rp' ? 'RP' : 'EM'}${p.estimated ? t(' (aprox.)') : ''}` : p.kind === 'me' ? 'Essência Mítica' : name);
  if (p.sale && p.amount) {
    // em promoção: preço cheio riscado + preço atual
    return h('span', { class: `cur cur-${p.kind} on-sale`, title: `${t(name)} · ${tr('em promoção')}` },
      svgIcon(ico, 'ico'), h('s', { text: p.amount.toLocaleString('pt-BR') }), h('span', { text: `${p.sale.toLocaleString('pt-BR')} ${p.kind === 'rp' ? 'RP' : 'EM'}` }));
  }
  return h('span', { class: `cur cur-${p.kind}`, title: name }, svgIcon(ico, 'ico'), h('span', { text: val }));
}

/** Galeria de todas as skins com filtros (nome/campeão, tenho/não tenho, raridade, legado, ordem). */
function skinGallery(d) {
  const all = d.skins || [];
  if (!all.length) return null;
  const f = pf.sk;
  const rarities = ['all', 'Suprema', 'Exaltada', 'Transcendente', 'Mítica', 'Lendária', 'Épica', 'Comum'].filter((r) => r === 'all' || all.some((x) => x.rarity === r));
  const q = f.q.trim().toLowerCase();
  let list = all.filter((x) => (f.own === 'all' || (f.own === 'yes') === x.owned) && (f.rar === 'all' || x.rarity === f.rar) && (f.legacy || !x.legacy)
    && (!q || x.name.toLowerCase().includes(q) || x.championName.toLowerCase().includes(q)));
  if (f.sort === 'rarity') list = [...list].sort((a, b) => b.rank - a.rank || a.championName.localeCompare(b.championName));
  else if (f.sort === 'recent') list = [...list].sort((a, b) => (b.released || 0) - (a.released || 0) || b.id - a.id);
  const sel = (id, opts, val, on) => {
    const el = h('select', { id }, ...opts.map(([v, t]) => h('option', { value: v, text: t })));
    el.value = val;
    el.addEventListener('change', () => { on(el.value); f.limit = 60; drawProfile(); });
    return el;
  };
  const search = h('input', { id: 'sk-q', type: 'text', placeholder: 'Skin ou campeão', value: f.q, maxlength: '40' });
  search.addEventListener('input', () => {
    f.q = search.value; f.limit = 60;
    const pos = search.selectionStart;
    drawProfile();
    const el = $('sk-q'); if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  });
  const legacy = h('label', { class: 'sk-chk' }, h('input', { type: 'checkbox' }), document.createTextNode('Mostrar legado'));
  legacy.firstChild.checked = f.legacy;
  legacy.firstChild.addEventListener('change', () => { f.legacy = legacy.firstChild.checked; f.limit = 60; drawProfile(); });
  const owned = all.filter((x) => x.owned).length;
  const tiles = list.slice(0, f.limit).map((x) => h('div', { class: `sk-tile${x.owned ? ' owned' : ''}`, title: `${x.name} · ${x.rarity}${x.chromas ? ` · ${x.chromas} cromas` : ''}` },
    h('img', { src: loadingUrl(x.champion, x.num), alt: '', loading: 'lazy' }),
    x.owned ? h('span', { class: 'sk-own', text: '✓ sua' }) : null,
    h('div', { class: 'sk-info' }, h('span', { class: `rar ${RARITY_CLS[x.rarity] || ''}`, text: x.rarity }), h('b', { text: x.name }), x.owned ? null : priceTag(x.price))));
  const more = list.length > f.limit ? h('button', { class: 'btn ghost sk-more', type: 'button', text: tr('Mostrar mais ({n} restantes)', { n: list.length - f.limit }) }) : null;
  if (more) more.addEventListener('click', () => { f.limit += 60; drawProfile(); });
  return pfCard(null,
    h('div', { class: 'pf-toolbar' }, h('div', { class: 'pf-ch', text: tr('Todas as skins · você tem {a} de {b}', { a: owned, b: all.length }) })),
    h('div', { class: 'pf-toolbar sk-filters' }, search,
      sel('sk-own', [['all', 'Todas'], ['yes', 'Tenho'], ['no', 'Não tenho']], f.own, (v) => { f.own = v; }),
      sel('sk-rar', rarities.map((r) => [r, r === 'all' ? 'Toda raridade' : r]), f.rar, (v) => { f.rar = v; }),
      sel('sk-sort', [['rarity', 'Raridade'], ['champion', 'Campeão'], ['recent', 'Mais recentes']], f.sort, (v) => { f.sort = v; }),
      legacy, h('span', { class: 'muted small', text: `${list.length} skin${list.length === 1 ? '' : 's'}` })),
    list.length ? h('div', { class: 'skin-grid' }, ...tiles) : h('p', { class: 'muted pad', text: 'Nenhuma skin com esses filtros.' }),
    more);
}


/** Botões de filtro por moeda: clique liga/desliga; com nenhum ligado, mostra todas. */
function curFilters(list) {
  const KINDS = [['rp', 'RP'], ['me', 'Essência Mítica'], ['gacha', 'Gacha (Santuário)']];
  const count = (k) => list.filter((x) => (x.price || {}).kind === k).length;
  const btns = KINDS.map(([k, label]) => {
    const n = count(k);
    const b = h('button', { type: 'button', class: `cur cur-${k} cur-btn${pf.cur.has(k) ? ' on' : ''}${pf.cur.size && !pf.cur.has(k) ? ' off' : ''}`, title: pf.cur.has(k) ? 'Clique para tirar o filtro' : `Mostrar só ${label}` },
      svgIcon(k === 'rp' ? 'rp' : k === 'me' ? 'essence' : 'gacha', 'ico'), h('span', { text: `${label} · ${n}` }));
    b.disabled = !n && !pf.cur.has(k);
    b.addEventListener('click', () => { if (pf.cur.has(k)) pf.cur.delete(k); else pf.cur.add(k); drawProfile(); });
    return b;
  });
  const clear = pf.cur.size ? h('button', { type: 'button', class: 'link', text: 'limpar filtro' }) : null;
  if (clear) clear.addEventListener('click', () => { pf.cur.clear(); drawProfile(); });
  return h('div', { class: 'pf-legend' }, ...btns, clear);
}

/* ---------- editor de runas (clicável) ---------- */
let runeCat = null;
let runeCatAsk = null;
function loadRuneCat() {
  if (runeCat || runeCatAsk || !window.overlay.runeCatalog) return;
  runeCatAsk = window.overlay.runeCatalog().then((c) => { runeCat = c && c.styles && c.styles.length ? c : null; }).catch(() => {}).finally(() => { runeCatAsk = null; });
}
loadRuneCat();
const runeEdits = new Map(); // chave da tela -> página { primaryStyleId, subStyleId, perks[9] }

function pageFromTree(t) {
  const sel = (row) => (row.find((r) => r.selected) || row[0] || {}).id;
  const sec = t.secondary.flat().filter((r) => r.selected).map((r) => r.id).slice(0, 2);
  return {
    primaryStyleId: (t.primaryStyles.find((s) => s.selected) || {}).id,
    subStyleId: (t.secondaryStyles.find((s) => s.selected) || {}).id,
    perks: [...t.primary.map(sel), ...sec, ...t.shards.map(sel)],
  };
}
function treeFromPage(page) {
  const st = runeCat.styles;
  const chosen = new Set(page.perks);
  const prim = st.find((s) => s.id === page.primaryStyleId) || st[0];
  const sub = st.find((s) => s.id === page.subStyleId && s.id !== prim.id) || st.find((s) => s.id !== prim.id);
  const rows = (style, from) => style.slots.slice(from).map((row) => row.map((r) => ({ ...r, selected: chosen.has(r.id) })));
  return {
    primaryStyles: st.map((s) => ({ ...s, selected: s.id === prim.id })),
    primary: rows(prim, 0),
    secondaryStyles: st.filter((s) => s.id !== prim.id).map((s) => ({ ...s, selected: s.id === sub.id })),
    secondary: rows(sub, 1),
    shards: runeCat.shards.map((row, i) => row.map((x) => ({ ...x, selected: page.perks[6 + i] === x.id }))),
  };
}
/** Aplica um clique numa runa e devolve a página nova (regras do cliente: 1 por linha, 2 da árvore secundária). */
function editPage(page, kind, r, rowIdx) {
  const st = runeCat.styles;
  const p = { ...page, perks: [...page.perks] };
  const style = (id) => st.find((s) => s.id === id);
  const firstSec = (s) => [s.slots[1][0].id, s.slots[2][0].id];
  if (kind === 'pstyle') {
    if (r.id === p.primaryStyleId) return p;
    const old = p.primaryStyleId;
    p.primaryStyleId = r.id;
    const ps = style(r.id);
    p.perks.splice(0, 4, ...ps.slots.slice(0, 4).map((row) => row[0].id));
    if (p.subStyleId === r.id) { p.subStyleId = old; p.perks.splice(4, 2, ...firstSec(style(old))); }
  } else if (kind === 'prune') {
    p.perks[rowIdx] = r.id;
  } else if (kind === 'sstyle') {
    if (r.id === p.subStyleId) return p;
    p.subStyleId = r.id;
    p.perks.splice(4, 2, ...firstSec(style(r.id)));
  } else if (kind === 'srune') {
    const ss = style(p.subStyleId);
    const rowOf = (id) => ss.slots.findIndex((row) => row.some((x) => x.id === id));
    const cur = [p.perks[4], p.perks[5]];
    const same = cur.findIndex((id) => rowOf(id) === rowOf(r.id));
    if (same >= 0) cur[same] = r.id; else { cur.shift(); cur.push(r.id); }
    p.perks.splice(4, 2, ...cur);
  } else if (kind === 'shard') {
    p.perks[6 + rowIdx] = r.id;
  }
  return p;
}
/** Árvores de runas clicáveis: guarda a edição por tela (key) e redesenha com onChange. */
function editableRunes(tree, key, onChange) {
  loadRuneCat();
  if (!runeCat || !tree) return tree ? drawRunes(tree) : h('div');
  const edited = runeEdits.get(key);
  const page = edited || pageFromTree(tree);
  const t = edited ? treeFromPage(edited) : tree;
  const set = (kind, r, i) => { runeEdits.set(key, editPage(page, kind, r, i)); onChange(); };
  const row = (list, cls, kind, i) => h('div', { class: 'r-row' }, ...list.map((r) => {
    const el = icon(ddImg(r.icon), `${cls}${r.selected ? ' sel' : ''} pick`, '');
    tipOn(el, r.name, r.desc);
    el.addEventListener('click', () => set(kind, r, i));
    return el;
  }));
  const left = h('div', { class: 'tree' }, row(t.primaryStyles, 'r-style', 'pstyle'), ...t.primary.map((rw, i) => row(rw, i === 0 ? 'r-key' : 'r-rune', 'prune', i)));
  const right = h('div', { class: 'tree' }, row(t.secondaryStyles, 'r-style', 'sstyle'), ...t.secondary.map((rw) => row(rw, 'r-rune', 'srune')),
    h('div', { class: 'shards' }, ...t.shards.map((rw, i) => row(rw, 'r-shard', 'shard', i))));
  const out = h('div', {}, h('div', { class: 'trees' }, left, right));
  if (edited) {
    const back = h('button', { class: 'link', type: 'button', text: 'Voltar à página do meta' });
    back.addEventListener('click', () => { runeEdits.delete(key); onChange(); });
    out.prepend(h('div', { class: 'r-edited' }, h('span', { text: 'Página editada por você: o Importar usa esta versão.' }), back));
  }
  return out;
}

/* ---------- laboratório de builds (várias builds com win rate, geral ou contra um campeão) ---------- */
const labState = new Map(); // `${id}:${role}` -> { vs, mode, source, sel, data, ask }
const LAB_SOURCES = [['opgg', 'OP.GG'], ['lola', 'Lolalytics']];
let labSource = 'opgg'; // última fonte escolhida vale para os próximos campeões
const activeLabs = new Set();
if (window.overlay.onLabUpdated) window.overlay.onLabUpdated((p) => {
  for (const a of [...activeLabs]) {
    if (!a.el.isConnected) { activeLabs.delete(a); continue; }
    if (a.id === p.id) fetchLab(a, true);
  }
});
const pctTxt = (x) => `${(x * 100).toFixed(1)}%`;
const gamesTxt = (n) => tr('{n} jogos', { n: n.toLocaleString('pt-BR') });

/**
 * ctx: { id, role, vsOptions: [{ id, name }], defaultVs, runeKey, onRunes(page), owned: Set }
 * Devolve um bloco que se atualiza sozinho quando os dados do OP.GG chegam.
 */
function buildLab(ctx) {
  const key = `${ctx.id}:${ctx.role || ''}`;
  let st = labState.get(key);
  if (!st) { st = { vs: ctx.defaultVs || null, mode: (settings && settings.buildMode) || 'play', source: labSource, sel: 0, pick: {}, data: null, ask: '' }; labState.set(key, st); }
  const el = h('div', { class: 'g-full lab' });
  const a = { el, id: ctx.id, key, ctx, st };
  activeLabs.add(a);
  fetchLab(a, false);
  drawLab(a);
  return el;
}
function fetchLab(a, force) {
  const { st, ctx } = a;
  const ask = `${st.vs || ''}:${st.mode}:${st.source}`;
  if (!force && st.data && st.ask === ask) return;
  st.ask = ask;
  window.overlay.getLab({ id: ctx.id, role: ctx.role, vs: st.vs, mode: st.mode, source: st.source }).then((d) => {
    if (st.ask !== ask) return;
    st.data = d;
    if (d && d.locked) { a.el.replaceChildren(h('div', { class: 'gb-h' }, h('h3', { text: 'Builds' })), proLock('lab')); return; }
    if (st.sel >= ((d && d.cores.length) || 0)) st.sel = 0;
    if (st.pickAsk !== ask) { st.pick = {}; st.pickAsk = ask; }
    if (a.el.isConnected) drawLab(a);
  });
}
function drawLab(a) {
  const { st, ctx, el } = a;
  const d = st.data;
  const seg = (items, cur, onPick) => h('div', { class: 'seg lab-seg' }, ...items.map(([k, label]) => {
    const b = h('button', { class: `seg-btn${k === cur ? ' on' : ''}`, type: 'button', text: label });
    b.addEventListener('click', () => onPick(k));
    return b;
  }));
  const mode = seg([['play', 'Mais jogada'], ['wr', 'Maior win rate']], st.mode, (k) => { st.mode = k; st.sel = 0; fetchLab(a); drawLab(a); });
  const vsList = [{ id: null, name: t('Geral') }, ...(ctx.vsOptions || [])];
  const chips = h('div', { class: 'lab-vs' }, h('span', { class: 'muted small', text: 'Contra' }), ...vsList.map((o) => {
    const b = h('button', { class: `lab-chip${(o.id || null) === (st.vs || null) ? ' on' : ''}`, type: 'button' },
      o.id && version ? h('img', { src: champIcon(version, o.id), alt: '' }) : null, h('span', { text: o.name }));
    b.addEventListener('click', () => { st.vs = o.id || null; st.sel = 0; fetchLab(a); drawLab(a); });
    return b;
  }));
  const source = seg(LAB_SOURCES, st.source, (k) => { st.source = k; labSource = k; st.sel = 0; fetchLab(a); drawLab(a); });
  const top = h('div', { class: 'lab-top' }, h('div', { class: 'lbl', style: 'margin:0' }, h('span', { text: 'Builds' })), source, h('span', { class: 'spacer' }), mode);
  if (!d || (!d.cores.length && d.pending)) {
    el.replaceChildren(top, chips, h('p', { class: 'muted small lab-note', text: d && d.vs ? tr('Buscando as builds contra {champ}…', { champ: d.vsName }) : 'Buscando as builds com win rate…' }));
    return;
  }
  if (!d.cores.length) {
    el.replaceChildren(top, chips, h('p', { class: 'muted small lab-note', text: d.note || t('Sem amostra suficiente para listar builds.') }));
    return;
  }
  const owned = ctx.owned || null;
  const minG = d.minGames || 0;
  const rows = d.cores.map((b, i) => {
    const r = h('div', { class: `lab-row${i === st.sel ? ' on' : ''}` },
      h('span', { class: 'muted small', text: String(i + 1) }),
      h('div', { class: 'lab-its' }, ...b.items.map((it) => {
        const im = icon(ddVerImg(`item/${it.id}.png`), `it-icon${owned && owned.has(it.id) ? ' own' : ''}`, it.name);
        return im;
      })),
      h('span', { class: 'lab-names small', text: b.items.map((it) => it.name).join(' › ') }),
      h('span', { class: `lab-wr ${b.wr >= 0.52 ? 'up' : b.wr < 0.48 ? 'down' : ''}`, text: pctTxt(b.wr) }),
      h('span', { class: `muted small lab-g${b.play < Math.max(minG, 100) ? ' small-sample' : ''}`, text: gamesTxt(b.play), title: b.play < Math.max(minG, 100) ? t('Amostra pequena: win rate menos confiável') : '' }));
    r.addEventListener('click', () => { st.sel = i; st.pick.slots = {}; drawLab(a); });
    return r;
  });
  const b0 = d.cores[st.sel] || d.cores[0];
  const pk = st.pick || (st.pick = {});
  // posições 1º–3º do Lolalytics trocam o item daquela posição no núcleo
  const coreItems = b0.items.slice();
  (d.slots || []).filter((sl) => sl.pos <= 3).forEach((sl) => {
    const i = sl.pos - 1;
    const j = pk.slots && pk.slots[sl.pos];
    const o = j != null && sl.options[j];
    if (!o || !o.items[0]) return;
    const dup = coreItems.findIndex((it) => it.id === o.items[0].id);
    if (dup >= 0 && dup !== i) coreItems[dup] = coreItems[i];
    coreItems[i] = o.items[0];
  });
  const b = { ...b0, items: coreItems };
  // 4º/5º/6º: sem escolha manual, o 1º item que ainda não está na build
  const laterSel = {};
  const usedIds = new Set(b.items.map((it) => it.id));
  for (const sl of (d.slots || []).filter((x) => x.pos >= 4)) {
    let j = pk.slots && pk.slots[sl.pos] != null ? pk.slots[sl.pos] : sl.options.findIndex((o) => o.items[0] && !usedIds.has(o.items[0].id));
    if (j < 0) j = 0;
    laterSel[sl.pos] = j;
    const o = sl.options[j];
    if (o && o.items[0]) usedIds.add(o.items[0].id);
  }
  // caminho da build escolhida: inicial -> 1º item -> botas -> resto do núcleo
  const step = (items, cap) => h('div', { class: 'bp-step' }, h('div', { class: 'bp-icons' }, ...items.map((it) => icon(ddVerImg(`item/${it.id}.png`), `it-icon${owned && owned.has(it.id) ? ' own' : ''}`, it.name))), cap ? h('span', { class: 'bp-cap', text: cap }) : null);
  const arrow = () => h('span', { class: 'bp-arr', text: '›' });
  const path = [];
  const starterSel = d.starters[pk.starters || 0] || d.starters[0];
  const bootSel = d.boots[pk.boots || 0] || d.boots[0];
  if (starterSel) path.push(step(starterSel.items, t('Início')), arrow());
  path.push(step([b.items[0]], t('1º item')));
  const bootIds = new Set(d.boots.flatMap((o) => o.items.map((it) => it.id)));
  if (bootSel && !b.items.some((it) => bootIds.has(it.id))) path.push(arrow(), step(bootSel.items, t('Botas')));
  for (const it of b.items.slice(1)) path.push(arrow(), step([it], ''));
  // 4º/5º/6º item escolhidos
  (d.slots || []).filter((sl) => sl.pos >= 4).forEach((sl) => {
    const o = sl.options[laterSel[sl.pos]];
    if (o && o.items[0] && !b.items.some((it) => it.id === o.items[0].id)) path.push(arrow(), step([o.items[0]], ''));
  });
  // cada linha de opções é clicável: a escolhida entra na build ("Usar esta build")
  const optLine = (label, list, fmt, onPick, selIdx = -1) => (list.length ? h('div', { class: 'lab-opts' }, h('span', { class: 'lab-ol muted small', text: label }),
    ...list.slice(0, 4).map((o, i) => {
      const stats = o.wr == null
        ? [h('span', { class: 'muted small', text: tr('{p}% escolhem', { p: Math.round((o.pick || 0) * (o.pick <= 1 ? 100 : 1)) }) })]
        : [h('b', { class: o.wr >= 0.52 ? 'up' : o.wr < 0.48 ? 'down' : '', text: pctTxt(o.wr) }), h('span', { class: `muted small${o.play < 100 ? ' small-sample' : ''}`, text: o.play.toLocaleString('pt-BR'), title: o.play < 100 ? t('Amostra pequena: win rate menos confiável') : '' })];
      const c = h(onPick ? 'button' : 'span', { class: `lab-opt${onPick ? ' click' : ''}${i === selIdx ? ' on' : ''}`, type: onPick ? 'button' : undefined }, ...fmt(o, i), ...stats);
      if (onPick) c.addEventListener('click', () => onPick(o, i));
      return c;
    })) : null);
  const pickIn = (kind) => (o, i) => { pk[kind] = i; drawLab(a); };
  const runeOpts = optLine('Runas', d.runes, (o) => {
    const ic = (x, cls) => (x && x.icon ? icon(ddImg(x.icon), cls, x.name) : null);
    const el = h('span', { class: 'lab-rune' }, ic(o.icons && o.icons[0], 'lab-key'), ...((o.icons || []).slice(1).map((x) => ic(x, 'lab-minor'))));
    el.title = (o.icons || []).map((x) => x.name).join(' · ');
    return [el];
  },
    (o, i) => { pk.runes = i; if (ctx.onRunes) ctx.onRunes({ primaryStyleId: o.primaryStyleId, subStyleId: o.subStyleId, perks: o.perks }); else drawLab(a); }, pk.runes || 0);
  const starterOpts = d.starters.length > 1 ? optLine('Início', d.starters, (o) => o.items.map((it) => icon(ddVerImg(`item/${it.id}.png`), 'it-mini', it.name)), pickIn('starters'), pk.starters || 0) : null;
  const bootOpts = optLine('Botas', d.boots, (o) => o.items.map((it) => icon(ddVerImg(`item/${it.id}.png`), 'it-mini', it.name)), pickIn('boots'), pk.boots || 0);
  const spellOpts = optLine('Feitiços', d.spells, (o) => o.ids.map((sid, i) => (o.keys && o.keys[i] ? icon(ddVerImg(`spell/${o.keys[i]}.png`), 'it-mini', o.names[i]) : h('span', { text: o.names[i] }))), pickIn('spells'), pk.spells || 0);
  // ordens diferentes com a mesma prioridade e o mesmo início viram uma opção só (somando os jogos)
  const skillGroups = new Map();
  for (const o of d.skills) {
    const p = skillPrio(o.order);
    const k = `${p.prio.join('')}:${p.start.join('')}`;
    const g = skillGroups.get(k) || { prio: p.prio, start: p.start, order: o.order, play: 0, wins: 0 };
    g.play += o.play; g.wins += o.wr * o.play;
    skillGroups.set(k, g);
  }
  const skills = [...skillGroups.values()].map((g) => ({ ...g, wr: g.play ? g.wins / g.play : 0 })).sort((a, b) => b.play - a.play);
  const sIcons = (ctx.skillIcons && ctx.skillIcons.spells) || [];
  const skIco = (k) => { const sp = sIcons['QWER'.indexOf(k)]; return sp ? h('span', { class: 'lab-sk' }, icon(ddVerImg(sp.icon), 'lab-sk-i', `${k} · ${sp.name}`, k), h('b', { text: k })) : h('span', { class: `sk-key s-${k}`, text: k }); };
  const skillOpts = optLine('Habilidades', skills, (o) => [
    ...o.prio.flatMap((k, i) => (i ? [h('span', { class: 'sk-arr', text: '›' }), skIco(k)] : [skIco(k)])),
    h('span', { class: 'muted small', text: `(${o.start.join(' ')})` })], pickIn('skills'), pk.skills || 0);
  const slotOpts = (d.slots || []).map((sl) => optLine(sl.label, sl.options, (o) => o.items.map((it) => icon(ddVerImg(`item/${it.id}.png`), 'it-mini', it.name)),
    (o, i) => { pk.slots = { ...(pk.slots || {}), [sl.pos]: i }; drawLab(a); }, sl.pos >= 4 ? laterSel[sl.pos] : pk.slots && pk.slots[sl.pos] != null ? pk.slots[sl.pos] : sl.options.findIndex((o) => o.items[0] && b.items[sl.pos - 1] && o.items[0].id === b.items[sl.pos - 1].id)));
  // "Usar esta build": vira a build do guia, do Importar e do overlay ao vivo
  const srcName = (LAB_SOURCES.find(([k]) => k === d.source) || [null, 'OP.GG'])[1];
  const labelTxt = `${srcName}${d.vsName ? ` · vs ${d.vsName}` : ''} · ${st.mode === 'wr' ? t('Maior win rate') : t('Mais jogada')}`;
  const patch = () => {
    const later = (d.slots || []).filter((sl) => sl.pos >= 4).map((sl) => sl.options.map((o, j) => ({ ids: o.items.map((it) => it.id), pick: j === laterSel[sl.pos] ? 1e9 : (o.play || o.pick || 0) })));
    const runeSel = d.runes[pk.runes || 0];
    const edited = ctx.runeKey && runeEdits.get(ctx.runeKey);
    const skillSel = skills[pk.skills || 0];
    return {
      core: b.items.map((it) => it.id), boots: bootSel ? bootSel.items.map((it) => it.id) : null, starter: starterSel ? starterSel.items.map((it) => it.id) : null,
      spells: (d.spells[pk.spells || 0] || {}).ids || null, skills: skillSel ? skillSel.order : null,
      runes: edited || (runeSel ? { primaryStyleId: runeSel.primaryStyleId, subStyleId: runeSel.subStyleId, perks: runeSel.perks } : null),
      later: later.length ? later : null,
    };
  };
  // comparação com a outra fonte
  const oc = d.other;
  const cmp = oc ? h('div', { class: 'lab-cmp small' },
    h('span', { class: 'muted', text: tr('Comparando com {src}:', { src: oc.source }) }),
    h('span', { class: oc.same === oc.of ? 'up' : oc.same === 0 ? 'down' : '', text: tr('núcleo {a}/{b} igual', { a: oc.same, b: oc.of }) }),
    ...(oc.core || []).filter((id) => !b0.items.some((it) => it.id === id)).slice(0, 3).map((id) => icon(ddVerImg(`item/${id}.png`), 'it-mini', tr('Na build do {src}', { src: oc.source }))),
    oc.keystoneSame == null ? null : h('span', { class: oc.keystoneSame ? 'up' : 'down', text: oc.keystoneSame ? t('mesma runa principal') : tr('runa principal diferente ({name})', { name: (oc.keystone && oc.keystone.name) || '?' }) }),
    oc.bootsSame == null ? null : h('span', { class: oc.bootsSame ? 'up' : '', text: oc.bootsSame ? t('mesmas botas') : t('botas diferentes') })) : null;
  const lowData = d.totalGames > 0 && d.totalGames < 1500
    ? h('p', { class: 'small lab-warn', text: tr('Poucos dados ({n} jogos): os win rates ainda oscilam. Comum no começo do patch ou em elos altos.', { n: d.totalGames.toLocaleString('pt-BR') }) }) : null;
  const useBtn = h('button', { class: 'btn primary lab-use', type: 'button', text: d.chosen ? 'Atualizar minha build' : 'Usar esta build' });
  useBtn.title = t('Vale para o Importar, a página de itens da loja e as sugestões do overlay durante a partida.');
  useBtn.addEventListener('click', async () => {
    useBtn.disabled = true;
    const res = await window.overlay.chooseLab({ id: ctx.id, role: d.role, patch: patch(), source: d.source, label: labelTxt, importNow: ctx.importNow !== false });
    useBtn.disabled = false;
    st.flash = res && res.imported ? (res.imported.ok ? tr('Build aplicada e importada ({what}).', { what: (res.imported.done || []).join(', ') }) : tr('Build aplicada; a importação falhou: {err}', { err: res.imported.error })) : t('Build aplicada: o Importar e o overlay vão usar esta.');
    fetchLab(a, true);
  });
  const resetBtn = d.chosen ? h('button', { class: 'btn ghost', type: 'button', text: 'Voltar ao padrão' }) : null;
  if (resetBtn) resetBtn.addEventListener('click', async () => { await window.overlay.chooseLab({ id: ctx.id, role: d.role, patch: null }); st.flash = t('Voltou para a build padrão do OP.GG.'); fetchLab(a, true); });
  const useRow = h('div', { class: 'lab-use-row' }, useBtn, resetBtn,
    d.chosen ? h('span', { class: 'small lab-chosen', text: tr('Em uso: {label}', { label: d.chosen.label || srcName }) }) : null,
    st.flash ? h('span', { class: 'muted small', text: st.flash }) : null);
  st.flash = '';
  const tierName = t(TL_ELO_PT[d.tier] || 'Esmeralda+');
  const sampleNote = d.source === 'ugg' ? tr('U.GG · mundial, Esmeralda+ · build mais jogada da rota.')
    : d.source === 'lola' ? `${tr('Lolalytics · {tier}{patch}', { tier: tierName, patch: d.patch ? ` · patch ${d.patch}` : '' })}${d.vsName ? ` · ${tr('contra {vs}', { vs: d.vsName })}` : ''} · ${t('item mais escolhido em cada posição; o win rate é o do 3º item.')}`
    : d.vs ? tr('Partidas de {champ} contra {vs} nesta rota.', { champ: d.champion.name, vs: d.vsName })
    : tr('Soma dos {n} confrontos mais comuns nesta rota{p}.', { n: d.sample, p: d.pending ? ` (${t('carregando o resto')})` : '' });
  el.replaceChildren(...[top, chips,
    d.tip ? h('div', { class: 'g-tip' }, h('b', { text: `vs ${d.vsName}` }), document.createTextNode(d.tip)) : null,
    h('div', { class: 'lab-list' }, ...rows),
    h('div', { class: 'bp lab-path' }, ...path),
    cmp, ...slotOpts, runeOpts, starterOpts, bootOpts, spellOpts, skillOpts, lowData, useRow,
    d.note ? h('p', { class: 'small lab-warn', text: d.note }) : null,
    h('p', { class: 'muted small lab-note', text: `${sampleNote}${st.mode === 'wr' ? ` ${tr('Maior win rate: só builds com {n}+ jogos.', { n: minG })}` : ''}` })].filter(Boolean));
}

/* ---------- aba Itens (database) ---------- */
const itv = { data: null, cls: 'all', sel: null };
const IT_CLS = [['all', 'Todos'], ['ap', 'Poder de habilidade'], ['ad', 'Dano físico'], ['tank', 'Defesa'], ['support', 'Suporte'], ['boots', 'Botas'], ['other', 'Outros']];
async function loadItems() {
  if (!itv.data || !itv.data.items.length) itv.data = await window.overlay.listItems().catch(() => null);
  drawItems();
}
function itemIco(id, cls = 'it-icon') {
  const v = (itv.data && itv.data.version) || version;
  return icon(`${DD}/cdn/${v}/img/item/${id}.png`, cls, (itemById(id) || {}).name || String(id));
}
const itemById = (id) => itv.data && itv.data.items.find((x) => x.id === Number(id));
function drawItems() {
  const d = itv.data;
  $('it-cls').replaceChildren(...IT_CLS.map(([k, label]) => {
    const b = h('button', { class: `seg-btn${k === itv.cls ? ' on' : ''}`, type: 'button', text: label });
    b.addEventListener('click', () => { itv.cls = k; drawItems(); });
    return b;
  }));
  if (!d || !d.items.length) { $('it-grid').replaceChildren(h('p', { class: 'muted pad', text: 'Carregando os itens…' })); $('it-detail').replaceChildren(); return; }
  const pv = String(d.version || '').split('.').slice(0, 2).join('.');
  $('it-meta').replaceChildren(h('span', { text: "Summoner's Rift" }), document.createTextNode(` · ${tr('patch {v}', { v: pv })} · ${tr('{n} itens', { n: d.items.length })}`));
  const q = $('it-q').value.trim().toLowerCase();
  const sort = $('it-sort').value;
  let list = d.items.filter((x) => (itv.cls === 'all' || x.cls === itv.cls) && (!q || x.name.toLowerCase().includes(q) || x.plaintext.toLowerCase().includes(q)));
  list = list.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : sort === 'cheap' ? (a, b) => a.gold - b.gold : (a, b) => b.gold - a.gold);
  if (!itv.sel || !list.some((x) => x.id === itv.sel)) itv.sel = list[0] ? list[0].id : null;
  $('it-grid').replaceChildren(...(list.length ? list.map((x) => {
    const tile = h('div', { class: `it-tile${x.id === itv.sel ? ' on' : ''}` }, itemIco(x.id),
      h('div', { class: 'it-tt' }, h('b', { text: x.name }), h('span', { class: 'muted small', text: `${x.gold.toLocaleString('pt-BR')} g` })));
    tile.addEventListener('click', () => { itv.sel = x.id; drawItems(); });
    return tile;
  }) : [h('p', { class: 'muted pad', text: 'Nenhum item com esses filtros.' })]));
  drawItemDetail(itemById(itv.sel));
}
function drawItemDetail(x) {
  const box = $('it-detail');
  if (!x) { box.replaceChildren(); return; }
  const icons = (ids) => h('div', { class: 'it-mini-row' }, ...ids.map((id) => {
    const el = itemIco(id, 'it-icon');
    el.addEventListener('click', () => { if (itemById(id)) { itv.sel = id; drawItems(); } });
    return el;
  }));
  box.replaceChildren(...[
    h('div', { class: 'it-dh' }, itemIco(x.id, 'it-big'), h('div', {}, h('h2', { text: x.name }),
      h('div', { class: 'small' }, h('b', { class: 'gold', text: `${x.gold.toLocaleString('pt-BR')} g` }),
        h('span', { class: 'muted', text: ` · ${tr('combinar {g} g', { g: x.base.toLocaleString('pt-BR') })} · ${tr('vende por {g} g', { g: x.sell.toLocaleString('pt-BR') })}` })))),
    x.plaintext ? h('p', { class: 'muted small', text: x.plaintext }) : null,
    h('p', { class: 'it-desc small', text: x.desc }),
    x.from.length ? h('div', {}, head('Receita'), icons(x.from)) : null,
    x.into.length ? h('div', {}, head('Vira'), icons(x.into)) : null,
    x.users.length ? h('div', {}, head('Na build de'), h('div', { class: 'it-users' }, ...x.users.map((u) => {
      const el = h('button', { class: 'lab-chip', type: 'button' }, version ? h('img', { src: champIcon(version, u.id), alt: '' }) : null, h('span', { text: u.name }));
      el.addEventListener('click', () => goChamp(u.id));
      return el;
    }))) : null].filter(Boolean));
}
$('it-q').addEventListener('input', () => drawItems());
$('it-sort').addEventListener('change', () => drawItems());

/* ---------- apagar conjuntos de itens da loja (2 cliques: o 2º confirma) ---------- */
function clearSetsButton(id, onlyApp, confirmText) {
  const b = $(id);
  let label = '';
  let armed = 0;
  b.addEventListener('click', async () => {
    if (!label) label = b.textContent; // já traduzido
    if (Date.now() - armed > 5000) {
      armed = Date.now();
      b.textContent = t(confirmText);
      setTimeout(() => { if (Date.now() - armed >= 5000) b.textContent = label; }, 5100);
      return;
    }
    armed = 0;
    b.textContent = label;
    $('clear-msg').textContent = t('Apagando…');
    const r = await window.overlay.clearItemSets(onlyApp);
    $('clear-msg').textContent = r.ok ? (r.removed ? tr('{n} conjuntos de itens apagados.', { n: r.removed }) : t('Não havia conjuntos para apagar.')) : tr('Não consegui apagar: {err}', { err: r.error });
  });
}
clearSetsButton('set-clear-app', true, 'Clique de novo para apagar os do app');
/* ---------- Pro: plano, travas e compra ---------- */
let planInfo = { plan: 'pro', paywall: false, plans: [], proFeatures: [] };
let proWhy = '';
let proMsg = '';
let proWaiting = false;
function can(feature) { return !planInfo.paywall || planInfo.plan === 'pro' || !(planInfo.proFeatures || []).includes(feature); }
const PRO_TEXT = {
  lab: 'Laboratório de builds: Lolalytics, build por confronto e "Usar esta build".',
  roleSwitch: 'Trocar a rota em que você caiu.',
  picks: 'Sugestões de pick e de ban no champ select.',
  skins: 'Aba Skins: sua coleção e sugestões.',
  items: 'Aba Itens: todos os itens do jogo.',
};
/** Cartão que fica no lugar de um recurso do Pro no plano grátis. */
function proLock(feature) {
  const btn = h('button', { class: 'btn primary', type: 'button', text: 'Ver planos' });
  btn.addEventListener('click', () => { proWhy = feature; goPage('pro'); });
  return h('div', { class: 'pro-lock' }, h('i', { class: 'pro-tag', text: 'PRO' }), h('p', { text: PRO_TEXT[feature] || 'Recurso do Pro.' }), btn);
}
const brl = (n) => `R$ ${Number(n).toFixed(2).replace('.', ',')}`;
const PLAN_NAME = { m1: '30 dias', y1: '1 ano', life: 'Vitalício' };
const PLAN_SUB = { m1: 'Pagamento único, sem renovação automática.', y1: 'Sai mais barato que 12 passes de 30 dias.', life: 'Paga uma vez, vale para sempre.' };
function applyPlan(p) {
  if (!p) return;
  const was = planInfo.plan + planInfo.paywall;
  planInfo = { ...planInfo, ...p };
  $('nav-pro').hidden = false;
  if (p.justLogged) { proMsg = tr('Conectado como {who}.', { who: p.account || '' }); }
  maybeAskAccount();
  if (p.justPaid) { proWaiting = false; proMsg = t('Pagamento aprovado. Pro liberado!'); }
  if (!$('pro').hidden) drawPro();
  if (was !== planInfo.plan + planInfo.paywall && lastState) { try { render(lastState); } catch { /* tela ainda não montada */ } }
}
async function accountLogin(btn) {
  if (btn) btn.disabled = true;
  const res = await window.overlay.accountLogin();
  proMsg = res && res.ok ? t('Termine o login no navegador que abriu. O app entra sozinho.') : tr('Não consegui abrir o login: {err}', { err: (res && res.error) || '?' });
  if (btn) btn.disabled = false;
  if (!$('pro').hidden) drawPro(); else goPage('pro');
}
let askedShown = false;
function maybeAskAccount() {
  if (askedShown || planInfo.asked || planInfo.account || planInfo.asked === undefined) return;
  askedShown = true;
  const close = () => { window.overlay.accountAsked(); box.remove(); };
  const login = h('button', { class: 'pro-choice primary', type: 'button' }, h('b', { text: 'Entrar com conta' }), h('span', { text: 'Seu Pro libera sozinho e vale em até 2 PCs. Google ou e-mail.' }));
  const guest = h('button', { class: 'pro-choice', type: 'button' }, h('b', { text: 'Continuar como convidado' }), h('span', { text: 'Sem conta. Usa a conta do LoL aberta neste PC.' }));
  login.addEventListener('click', () => { close(); accountLogin(null); });
  guest.addEventListener('click', close);
  const box = h('div', { class: 'pro-ask', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Como você quer usar?') },
    h('div', { class: 'pro-ask-card' }, h('h2', { text: 'Como você quer usar?' }), h('p', { class: 'muted', text: 'Dá para trocar depois na aba Pro.' }), h('div', { class: 'pro-choices' }, login, guest)));
  document.body.append(box);
  guest.focus();
}
function drawPro() {
  const p = planInfo;
  const isPro = p.paywall && p.plan === 'pro';
  $('pro-eyebrow').textContent = !p.paywall ? t('Tudo liberado') : isPro ? t('Você é Pro') : t('Plano grátis');
  const until = p.expiresAt ? new Date(p.expiresAt).toLocaleDateString('pt-BR') : null;
  const status = !p.paywall ? h('p', { class: 'muted', text: 'A cobrança ainda não está ligada: todos os recursos estão liberados para todo mundo.' })
    : isPro ? h('div', { class: 'pro-status ok' }, h('b', { text: until ? tr('Pro ativo até {date}', { date: until }) : t('Pro vitalício ativo') }),
      p.key ? h('span', { class: 'muted small', text: tr('Sua chave: {key} (vale em até 2 computadores)', { key: p.key }) }) : null)
      : h('div', { class: 'pro-status' }, h('b', { text: 'Você está no plano grátis' }),
        h('span', { class: 'muted small', text: 'Grátis: build do OP.GG, Importar, overlay e tier list.' }));
  const why = proWhy && PRO_TEXT[proWhy] ? h('p', { class: 'pro-why', text: tr('Recurso do Pro: {what}', { what: t(PRO_TEXT[proWhy]) }) }) : null;
  const feats = h('ul', { class: 'pro-feats' }, ...Object.values(PRO_TEXT).map((x) => h('li', { text: x })));
  const cards = h('div', { class: 'pro-plans' }, ...(p.plans || []).map((pl) => {
    const b = h('button', { class: 'btn primary', type: 'button', text: isPro && !until ? 'Você já tem' : isPro ? 'Estender' : 'Comprar' });
    b.disabled = isPro && !until;
    b.addEventListener('click', async () => {
      b.disabled = true; proMsg = t('Abrindo o pagamento no navegador…'); drawPro();
      const res = await window.overlay.proCheckout(pl.id);
      proWaiting = Boolean(res && res.ok);
      proMsg = res && res.ok ? t('Pague com Pix ou cartão na página que abriu. O Pro libera aqui sozinho, em alguns segundos após a aprovação.') : tr('Não consegui abrir o pagamento: {err}', { err: (res && res.error) || '?' });
      drawPro();
    });
    return h('div', { class: `pro-plan${pl.id === 'y1' ? ' best' : ''}` },
      pl.id === 'y1' ? h('i', { class: 'pro-tag', text: 'Mais escolhido' }) : null,
      h('h3', { text: PLAN_NAME[pl.id] || pl.id }), h('div', { class: 'pro-price', text: brl(pl.price) }),
      h('p', { class: 'muted small', text: PLAN_SUB[pl.id] || '' }), b);
  }));
  const keyIn = h('input', { type: 'text', class: 'pro-key', placeholder: 'LOP-XXXXX-XXXXX-XXXXX', maxlength: '21', spellcheck: 'false' });
  const keyBtn = h('button', { class: 'btn ghost', type: 'button', text: 'Ativar chave' });
  keyBtn.addEventListener('click', async () => {
    keyBtn.disabled = true;
    const res = await window.overlay.proActivate(keyIn.value);
    proMsg = res && res.ok ? t('Chave ativada. Pro liberado!') : tr('Não ativou: {err}', { err: (res && res.error) || '?' });
    if (res && res.ok) applyPlan(res.plan); else drawPro();
  });
  const again = h('button', { class: 'btn ghost', type: 'button', text: 'Já paguei, conferir agora' });
  again.addEventListener('click', async () => { again.disabled = true; applyPlan(await window.overlay.proRefresh()); if (planInfo.plan !== 'pro' || !planInfo.paywall) { proMsg = t('Ainda não chegou a confirmação do pagamento. O Pix costuma levar alguns segundos.'); drawPro(); } });
  const acc = p.account
    ? h('section', { class: 'card pad pro-acc' }, h('div', { class: 'pro-acc-row' },
      h('div', {}, h('b', { text: tr('Conectado como {who}', { who: p.account }) }), h('p', { class: 'muted small', text: 'Seu Pro e seus PCs ficam na sua conta.' })),
      (() => { const b = h('button', { class: 'btn ghost', type: 'button', text: 'Sair da conta' }); b.addEventListener('click', async () => { b.disabled = true; proMsg = ''; applyPlan(await window.overlay.accountLogout()); }); return b; })()))
    : h('section', { class: 'card pad pro-acc' }, h('div', { class: 'pro-acc-row' },
      h('div', {}, h('b', { text: 'Modo convidado' }), h('p', { class: 'muted small', text: 'O app funciona com a conta do LoL aberta neste PC. Entre com sua conta para usar o Pro em até 2 PCs.' })),
      (() => { const b = h('button', { class: 'btn primary', type: 'button', text: 'Entrar com conta' }); b.addEventListener('click', () => accountLogin(b)); return b; })()));
  $('pro-body').replaceChildren(
    acc,
    h('section', { class: 'card pad' }, status, why, proMsg ? h('p', { class: 'pro-msg', text: proMsg }) : null, proWaiting && !isPro ? again : null),
    p.paywall ? h('section', { class: 'card pad' }, h('h2', { text: 'O que o Pro libera' }), feats, cards,
      h('p', { class: 'muted small', text: 'Pagamento pelo Mercado Pago: Pix ou cartão. Sem assinatura: nada é cobrado de novo sozinho.' })) : null,
    p.paywall ? h('section', { class: 'card pad' }, h('h2', { text: 'Já tenho uma chave' }),
      h('p', { class: 'muted small', text: 'Use a chave para reinstalar ou ativar em outro computador.' }), h('div', { class: 'pro-key-row' }, keyIn, keyBtn)) : null);
}
window.overlay.getPlan().then(applyPlan).catch(() => {});
if (window.overlay.onPlanUpdated) window.overlay.onPlanUpdated(applyPlan);

$('set-net').addEventListener('click', async () => {
  const box = $('net-test');
  box.hidden = false;
  box.replaceChildren(h('p', { class: 'muted small', text: 'Testando…' }));
  const res = await window.overlay.testNet().catch((e) => [{ name: 'App', ok: false, error: e.message }]);
  box.replaceChildren(...res.map((r) => h('div', { class: `net-row ${r.ok ? 'ok' : 'bad'}` },
    h('b', { text: r.name }), h('span', { text: r.ok ? tr('ok · {ms} ms', { ms: r.ms }) : tr('falhou: {err}', { err: r.error || '?' }) }))),
  res.some((r) => !r.ok) ? h('p', { class: 'muted small', text: 'Se uma fonte falha e as outras não: firewall, antivírus, VPN ou DNS bloqueando aquele site. Se todas falham: sem internet para o app.' }) : null);
});
clearSetsButton('set-clear-all', false, 'Clique de novo: apaga TODOS');
