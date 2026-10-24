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
const VIEWS = ['waiting', 'select', 'game', 'tierlist', 'history', 'settings'];
function showView(name) {
  if (name) lastView = name;
  const v = settingsOpen ? 'settings' : page !== 'auto' ? page : lastView;
  for (const id of VIEWS) $(id).hidden = v !== id;
  const navOf = { waiting: 'nav-home', select: 'nav-select', game: 'nav-game', tierlist: 'nav-tier', history: 'nav-history', settings: 'gear' };
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
  card.title = `${c.reasons.join(' · ')}\nClique para marcar no cliente`;
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
    imported.runes = false;
    imported.spells = false;
    els.impMsg.textContent = '';
    window.overlay.getGuide(pickId).then((g) => {
      if (shownId === pickId) { guide = g; drawGuide(); }
    });
  }
  drawGuide();
}

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
  return h('div', { class: 'build' },
    h('div', {}, head('Início'), starter),
    h('div', {}, head('Build'), full));
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

  const left = h('div', { class: 'g-sec' });
  if (g.runeTree) left.append(head(`Runas · ${g.runes.primaryStyleName} + ${g.runes.subStyleName}`, 'runes'), drawRunes(g.runeTree));
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
    parts.push(h('div', { class: 'g-full' }, head(`Ordem de habilidades · ${order.slice(0, 3).join(' › ')}`), drawSkills(g)));
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
  $('bans').hidden = state.action !== 'ban' || !bans.length;
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
  const res = await window.overlay.importBuild(shownId, what, variant);
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
    return h('label', { class: 'ov-item' }, cb, h('div', {}, h('div', { class: 'strong', text: name }), h('div', { class: 'muted small', text: desc })), reset);
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
  fillRoleFields();
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
    overlay: { mode: $('set-overlay-mode').value },
    picker: {
      weights,
      pool: { [els.setRole.value]: splitList(els.setPool.value) },
      blacklist: splitList(els.setBlacklist.value),
    },
  });
  els.setMsg.textContent = 'Salvo.';
  showFlashKey();
}

function showFlashKey() {
  if (guide) drawGuide();
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
const pc = (x) => `${(x * 100).toFixed(1)}%`;

function tlRoleButtons() {
  $('tl-roles').replaceChildren(...TL_ROLES.map(([k, label]) => {
    const b = h('button', { class: `seg-btn${k === tlRole ? ' on' : ''}`, type: 'button', title: label });
    b.append(k === 'all' ? svgIcon('spark') : roleImg(k, 'seg-role'), h('span', { text: label }));
    b.addEventListener('click', () => { tlRole = k; tlRoleButtons(); drawTierList(); });
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
  tile.title = `${r.name} · #${r.rank} na rota · ${r.games.toLocaleString('pt-BR')} partidas · KDA ${r.kda}`;
  return tile;
}

function drawTierList() {
  const body = $('tl-body');
  if (!tl || !tl.data) {
    body.replaceChildren(h('section', { class: 'panel' }, h('p', { class: 'muted', text: tl && tl.error ? `Não consegui carregar: ${tl.error}` : 'Carregando a tier list do OP.GG…' })));
    return;
  }
  const meta = [`Patch ${String(tl.patch || '').split('.').slice(0, 2).join('.')}`, 'Esmeralda+ · Global', 'OP.GG'];
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
  tl = await window.overlay.getTierList(force);
  drawTierList();
}
window.overlay.onTierListUpdated(() => { if (page === 'tierlist') loadTierList(); });
function goPage(p) {
  settingsOpen = false;
  page = p;
  showView(null);
  if (p === 'tierlist') { tlRoleButtons(); loadTierList(); }
  if (p === 'history') loadHistory();
}
$('nav-tier').addEventListener('click', () => goPage('tierlist'));
$('nav-history').addEventListener('click', () => goPage('history'));
for (const id of ['nav-home', 'nav-select', 'nav-game']) $(id).addEventListener('click', () => goPage('auto'));

/* ---------- histórico / pós-partida ---------- */

let histSel = null;
let histItems = [];

/** Junta as partidas do OP.GG com as gravadas pelo app (que têm o gráfico de ouro minuto a minuto). */
function mergeHistory(opgg, local) {
  const used = new Set();
  const out = (opgg.list || []).filter((g) => g.me).map((g) => {
    const start = Date.parse(g.createdAt);
    const loc = local.find((l) => !used.has(l.id) && l.champion.name === g.me.champion && Math.abs((l.at - l.duration * 1000) - start) < 30 * 60 * 1000);
    if (loc) used.add(loc.id);
    return { key: `o:${g.id}`, kind: 'opgg', g, local: loc || null, at: start };
  });
  for (const l of local) if (!used.has(l.id)) out.push({ key: `l:${l.id}`, kind: 'local', local: l, at: l.at });
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
$('tl-search').addEventListener('input', drawTierList);
$('tl-sort').addEventListener('change', drawTierList);
$('tl-refresh').addEventListener('click', () => { tl = null; drawTierList(); loadTierList(true); });
