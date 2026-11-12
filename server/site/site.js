(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids); return e; };
  const NS = 'http://www.w3.org/2000/svg';
  const icon = (d) => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('width', '22'); s.setAttribute('height', '22'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke-width', '1.8'); p.setAttribute('stroke-linejoin', 'round'); s.append(p); return s; };

  // Demo de build por rota
  const ICON = { top: 'M4 20V4h16l-4 4H8v8l-4 4z', jungle: 'M12 3c-3 4-6 6-6 11a6 6 0 0012 0c0-5-3-7-6-11z', mid: 'M4 20L20 4M4 14v6h6M14 4h6v6', adc: 'M20 4v16H4l4-4h8V8l4-4z', sup: 'M12 3l3 6h6l-5 4 2 7-6-4-6 4 2-7-5-4h6z' };
  const B = {
    top: { role: 'Topo', wr: '51,2%', games: '8.400', items: [['Mv', 'Malevolência', '3.000', 'abre o combo'], ['Bo', 'Botas Ionianas da Lucidez', '1.100', 'menos recarga'], ['Ch', 'Chama Sombria', '3.200', 'dano em lutas'], ['Za', 'Ampulheta de Zhonya', '3.250', 'contra burst'], ['Rb', 'Capuz da Morte de Rabadon', '3.600', 'fechamento']], runes: ['Eletrocutar', 'Golpe Repentino', 'Fluxo de Mana', 'Determinação'] },
    jungle: { role: 'Selva', wr: '48,9%', games: '1.200', items: [['Sm', 'Companheiro da selva', '450', 'início'], ['Mv', 'Malevolência', '3.000', 'ganks'], ['Bo', 'Passos de Mercúrio', '1.100', 'contra CC'], ['Ch', 'Chama Sombria', '3.200', 'dano'], ['Za', 'Ampulheta de Zhonya', '3.250', 'sobreviver']], runes: ['Colheita Sombria', 'Gosto de Sangue', 'Caçador Incansável', 'Precisão'] },
    mid: { role: 'Meio', wr: '52,8%', games: '41.300', items: [['Ma', 'Tomo Amplificador', '435', 'início'], ['Mv', 'Malevolência', '3.000', 'primeiro pico'], ['Bo', 'Sapatos do Feiticeiro', '1.100', 'penetração'], ['Ch', 'Chama Sombria', '3.200', 'segundo pico'], ['Rb', 'Capuz da Morte de Rabadon', '3.600', 'multiplica o dano']], runes: ['Eletrocutar', 'Golpe Repentino', 'Caçador Supremo', 'Feitiçaria'] },
    adc: { role: 'Atirador', wr: '47,1%', games: '600', items: [['Ma', 'Tomo Amplificador', '435', 'início'], ['Ch', 'Chama Sombria', '3.200', 'pico'], ['Bo', 'Sapatos do Feiticeiro', '1.100', 'penetração'], ['Rb', 'Capuz da Morte de Rabadon', '3.600', 'dano'], ['Vd', 'Cajado do Vazio', '3.000', 'contra RM']], runes: ['Cometa Arcano', 'Fluxo de Mana', 'Transcendência', 'Inspiração'] },
    sup: { role: 'Suporte', wr: '49,7%', games: '2.900', items: [['Sp', 'Lâmina do Ladrão Arcano', '400', 'início'], ['Bo', 'Botas Ionianas da Lucidez', '1.100', 'recarga'], ['Mv', 'Malevolência', '3.000', 'pick'], ['Za', 'Ampulheta de Zhonya', '3.250', 'sobreviver'], ['Ch', 'Chama Sombria', '3.200', 'dano']], runes: ['Eletrocutar', 'Golpe Repentino', 'Globos Oculares', 'Inspiração'] },
  };
  const ITEM_IMG = {};
  const itemIcon = (n) => ITEM_IMG[String(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()] || null;
  const roles = $('#roles');
  if (roles) {
    const show = (k) => {
      const b = B[k];
      [...roles.children].forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.k === k)));
      $('#b-role').textContent = b.role; $('#b-wr').textContent = `${b.wr} WR`; $('#b-games').textContent = `${b.games} jogos`;
      $('#b-items').replaceChildren(...b.items.map(([s, n, g, w]) => { const it = itemIcon(n); return el('div', { class: 'slot', tabindex: '0', 'aria-label': `${n}, ${g} de ouro, ${w}` }, it ? el('img', { src: it, alt: '', width: '54', height: '54' }) : s, el('div', { class: 'tip' }, el('b', {}, n), el('span', { class: 'g' }, `${g} de ouro`), el('div', { class: 'muted' }, w))); }));
      $('#b-runes').replaceChildren(...b.runes.map((r) => el('span', { class: 'chip' }, r)));
    };
    const CD = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/svg';
    const POS = { top: 'top', jungle: 'jungle', mid: 'middle', adc: 'bottom', sup: 'utility' };
    for (const k of Object.keys(ICON)) {
      const btn = el('button', { type: 'button', 'aria-label': B[k].role, 'data-k': k, 'aria-pressed': 'false' });
      const im = el('img', { src: `${CD}/position-${POS[k]}.svg`, alt: '', width: '22', height: '22' });
      btn.append(im); btn.onclick = () => show(k); roles.append(btn);
    }
    let cur = 'mid';
    const show0 = show;
    show('mid');
    roles.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) cur = b.dataset.k; });
    // ícones reais do Data Dragon (itens pelo nome em pt_BR e o campeão)
    const DD = 'https://ddragon.leagueoflegends.com';
    fetch(`${DD}/api/versions.json`).then((r) => r.json()).then(async (v) => {
      const ver = v[0];
      const items = (await (await fetch(`${DD}/cdn/${ver}/data/pt_BR/item.json`)).json()).data;
      const norm = (x) => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      for (const [id, it] of Object.entries(items)) if (it.maps && it.maps['11'] && it.gold && it.gold.purchasable) ITEM_IMG[norm(it.name)] = `${DD}/cdn/${ver}/img/item/${id}.png`;
      const ch = document.querySelector('.champ');
      if (ch) ch.replaceChildren(el('img', { src: `${DD}/cdn/${ver}/img/champion/Ahri.png`, alt: 'Ahri', width: '52', height: '52' }));
      show0(cur);
    }).catch(() => {});
  }

  // Timers ao vivo
  const timers = [...document.querySelectorAll('[data-timer]')];
  let t = 0;
  if (timers.length) setInterval(() => { t += 1; for (const x of timers) { const base = Number(x.dataset.timer); const v = base - (t % base); x.textContent = `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; } }, 1000);

  // Planos
  const PL = { free: ['Grátis', 'R$ 0', 'Baixar grátis', 'https://github.com/gabtavarez/lol-overlay/releases/latest'], m1: ['30 dias', 'R$ 9,90', 'Comprar 30 dias', 'conta.html?buy=m1'], y1: ['1 ano', 'R$ 59,90', 'Comprar 1 ano', 'conta.html?buy=y1'], life: ['Vitalício', 'R$ 99,90', 'Comprar vitalício', 'conta.html?buy=life'] };
  const plans = $('#plans');
  if (plans) plans.addEventListener('click', (e) => {
    const b = e.target.closest('.plan'); if (!b) return;
    [...plans.children].forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const [n, p, c, h] = PL[b.dataset.id];
    $('#sel-name').textContent = n; $('#sel-price').textContent = p; $('#sel-cta').textContent = c; $('#sel-cta').href = h;
  });

  // Link de download direto ao instalador mais recente
  fetch('https://api.github.com/repos/gabtavarez/lol-overlay/releases/latest').then((r) => r.json()).then((rel) => {
    const exe = (rel.assets || []).find((a) => /\.exe$/i.test(a.name));
    if (exe) document.querySelectorAll('a.dl').forEach((a) => { a.href = exe.browser_download_url; a.setAttribute('download', exe.name); a.removeAttribute('rel'); });
  }).catch(() => {});
})();

// Topo: mostra "Minha conta" quando já há login neste navegador (sessão salva pelo Supabase)
(() => {
  const a = document.getElementById('nav-acc');
  if (!a) return;
  let s = null;
  try { s = JSON.parse(localStorage.getItem('sb-wzvpedyefbmevazdxtoc-auth-token') || 'null'); } catch { s = null; }
  const user = s && (s.user || (s.currentSession && s.currentSession.user));
  if (!user || !user.email) return;
  const ini = document.createElement('span');
  ini.className = 'avatar-mini';
  ini.textContent = user.email.slice(0, 2).toUpperCase();
  ini.setAttribute('aria-hidden', 'true');
  a.replaceChildren(ini, document.createTextNode('Minha conta'));
  a.title = user.email;
})();

// Rolagem: barra de progresso, revelar ao entrar na tela e leve paralaxe no print
(() => {
  const bar = document.getElementById('progress');
  const win = document.querySelector('.window');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ticking = false;
  const onScroll = () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      const h = document.documentElement;
      const p = h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight);
      if (bar) bar.style.transform = `scaleX(${p})`;
      if (win && !reduce) { const r = win.getBoundingClientRect(); const k = Math.min(1, Math.max(0, 1 - r.top / innerHeight)); win.style.transform = `perspective(1200px) rotateX(${(1 - k) * 10}deg) scale(${0.94 + k * 0.06})`; }
      ticking = false;
    });
  };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  const els = document.querySelectorAll('.reveal');
  if (reduce || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((ents) => { for (const e of ents) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  els.forEach((e) => io.observe(e));
})();


// Tour pelas telas: troca a imagem com fade e pré-carrega as próximas
(() => {
  const tabs = document.getElementById('tour-tabs'); if (!tabs) return;
  const img = document.getElementById('tour-img'); const cap = document.getElementById('tour-cap');
  const btns = [...tabs.querySelectorAll('button')];
  const pick = (b) => {
    btns.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    img.classList.add('fade');
    const next = new Image(); next.src = `shots/${b.dataset.shot}.webp`;
    next.onload = () => { img.src = next.src; img.alt = `Tela ${b.textContent} do Nexo`; img.classList.remove('fade'); };
    cap.textContent = b.dataset.cap + (b.dataset.pro ? ' (Pro)' : '');
  };
  btns.forEach((b, i) => { b.onclick = () => pick(b); b.onkeydown = (e) => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (d) { const n = btns[(i + d + btns.length) % btns.length]; n.focus(); pick(n); } }; });
  const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { btns.forEach((b) => { new Image().src = `shots/${b.dataset.shot}.webp`; }); io.disconnect(); } });
  io.observe(tabs);
})();
