/* Helpers compartilhados pela janela principal e pelo overlay do TAB. */
const DD = 'https://ddragon.leagueoflegends.com';
const ROLE_LABEL = { top: 'Topo', jungle: 'Selva', middle: 'Meio', bottom: 'Atirador', utility: 'Suporte', aram: 'ARAM', arena: 'Arena' };

// Nomes de jogadores, itens e motivos vêm de fora: sempre textContent, nunca innerHTML.
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = typeof t === 'function' ? t(v) : v;
    else if ((k === 'title' || k === 'placeholder') && typeof t === 'function') el.setAttribute(k, t(v));
    else if (k === 'style') el.style.cssText = v; // via CSSOM: permitido pelo CSP
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

// CommunityDragon: ícones oficiais de rota e de elo (mesmos do cliente).
const CD = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default';
const roleIconUrl = (role) => `${CD}/svg/position-${role}.svg`;
const rankIconUrl = (tier) => `${CD}/images/ranked-mini-crests/${String(tier || 'unranked').toLowerCase()}.svg`;
function roleImg(role, cls = 'role-img') { return h('img', { class: cls, src: roleIconUrl(role), alt: '' }); }
function rankImg(tier, cls = 'rank-img') { return h('img', { class: cls, src: rankIconUrl(tier), alt: tier || '' }); }

const itemIcon = (version, id) => `${DD}/cdn/${version}/img/item/${id}.png`;
const champIcon = (version, id) => `${DD}/cdn/${version}/img/champion/${id}.png`;
const champSplash = (id) => `${DD}/cdn/img/champion/splash/${id}_0.jpg`;

/** Selo "Bom contra: Dano mágico" + os inimigos que motivaram o item (estilo LoLTheory). */
function goodTag(good, vs, version) {
  if (!good) return null;
  return h('div', { class: `good-tag g-${good.key}` },
    h('span', { class: 'good-dot' }),
    h('span', { class: 'good-lbl', text: 'Bom contra' }),
    h('b', { text: good.label }),
    ...((vs || []).slice(0, 4).map((id) => (version ? h('img', { class: 'good-vs', src: champIcon(version, id), alt: id, title: id }) : null))));
}

/** Lista "Compras" com até 3 itens, motivo e ouro faltando. */
function renderBuyList(container, buys, version) {
  const items = (buys && buys.items) || [];
  if (!items.length) {
    container.replaceChildren(h('p', { class: 'muted', text: (buys && buys.notes && buys.notes[0]) || 'Sem sugestões agora.' }));
    return;
  }
  container.replaceChildren(
    ...items.map((it, i) =>
      h('div', { class: `buy${i === 0 ? ' best' : ''}${it.canBuy ? ' afford' : ''}` },
        version ? h('img', { class: 'buy-icon', src: itemIcon(version, it.id), alt: it.name }) : h('div', { class: 'buy-icon' }),
        h('div', { class: 'buy-body' },
          h('div', { class: 'buy-name', text: it.name }),
          goodTag(it.good, it.vs, version),
          h('div', { class: 'buy-reason', text: it.reason }),
          h('div', { class: 'buy-gold', text: it.canBuy
            ? `Já dá para comprar (${it.missing} g)`
            : `Faltam ${it.needGold ?? it.missing} g (custa ${it.missing} g${it.parts && it.parts.length ? `, já descontando ${it.parts.join(' + ')}` : ''})` }),
        ),
        h('div', { class: 'buy-score', text: String(it.score) }),
      ),
    ),
  );
}

/** Aviso de recall, nota de matchup e alertas de itens inimigos (texto puro). */
function renderExtras(els, advice) {
  const buys = (advice && advice.buys) || {};
  els.recall.textContent = buys.recall || '';
  els.recall.hidden = !buys.recall;
  const note = buys.matchup && buys.matchup.tip ? `vs ${buys.matchup.vs}: ${buys.matchup.tip}` : (buys.notes && buys.notes[0]) || '';
  els.matchup.textContent = buys.items && buys.items.length ? note : '';
  els.matchup.hidden = !els.matchup.textContent;
  const alerts = (advice && advice.alerts) || [];
  els.alerts.replaceChildren(...alerts.map((a) => h('div', { class: 'alert', text: a.text })));
  els.alerts.hidden = !alerts.length;
}

// Comportamento de app: sem menu de contexto do navegador nem arrastar imagens.
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('dragstart', (e) => e.preventDefault());
