(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids); return e; };
  const NS = 'http://www.w3.org/2000/svg';
  const icon = (d) => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('width', '22'); s.setAttribute('height', '22'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke-width', '1.8'); p.setAttribute('stroke-linejoin', 'round'); s.append(p); return s; };

  // Demo de build por rota
  const ICON = { top: 'M4 20V4h16l-4 4H8v8l-4 4z', jungle: 'M12 3c-3 4-6 6-6 11a6 6 0 0012 0c0-5-3-7-6-11z', mid: 'M4 20L20 4M4 14v6h6M14 4h6v6', adc: 'M20 4v16H4l4-4h8V8l4-4z', sup: 'M12 3l3 6h6l-5 4 2 7-6-4-6 4 2-7-5-4h6z' };
  const B = {
    top: { role: 'Topo', wr: '51,2%', games: '8.400', items: [['Ld', 'Lâmina da Noite', '3.000', 'abre o combo'], ['Bo', 'Botas Ionianas', '1.100', 'menos recarga'], ['Ch', 'Chama Sombria', '3.200', 'dano em lutas'], ['Za', 'Ampulheta de Zhonya', '3.250', 'contra burst'], ['Rb', 'Capuz da Morte', '3.600', 'fechamento']], runes: ['Eletrocutar', 'Golpe Repentino', 'Fluxo de Mana', 'Determinação'] },
    jungle: { role: 'Selva', wr: '48,9%', games: '1.200', items: [['Sm', 'Companheiro da selva', '450', 'início'], ['Ld', 'Lâmina da Noite', '3.000', 'ganks'], ['Bo', 'Botas de Mercúrio', '1.100', 'contra CC'], ['Ch', 'Chama Sombria', '3.200', 'dano'], ['Za', 'Ampulheta de Zhonya', '3.250', 'sobreviver']], runes: ['Colheita Sombria', 'Gosto de Sangue', 'Caçador Incansável', 'Precisão'] },
    mid: { role: 'Meio', wr: '52,8%', games: '41.300', items: [['Ma', 'Tomo Amplificador', '435', 'início'], ['Ld', 'Lâmina da Noite', '3.000', 'primeiro pico'], ['Bo', 'Sapatos do Feiticeiro', '1.100', 'penetração'], ['Ch', 'Chama Sombria', '3.200', 'segundo pico'], ['Rb', 'Capuz da Morte', '3.600', 'multiplica o dano']], runes: ['Eletrocutar', 'Golpe Repentino', 'Caçador Supremo', 'Feitiçaria'] },
    adc: { role: 'Atirador', wr: '47,1%', games: '600', items: [['Ma', 'Tomo Amplificador', '435', 'início'], ['Ch', 'Chama Sombria', '3.200', 'pico'], ['Bo', 'Sapatos do Feiticeiro', '1.100', 'penetração'], ['Rb', 'Capuz da Morte', '3.600', 'dano'], ['Vd', 'Cajado do Vazio', '3.000', 'contra RM']], runes: ['Cometa Arcano', 'Fluxo de Mana', 'Transcendência', 'Inspiração'] },
    sup: { role: 'Suporte', wr: '49,7%', games: '2.900', items: [['Sp', 'Lâmina do Ladrão Arcano', '400', 'início'], ['Bo', 'Botas Ionianas', '1.100', 'recarga'], ['Ld', 'Lâmina da Noite', '3.000', 'pick'], ['Za', 'Ampulheta de Zhonya', '3.250', 'sobreviver'], ['Ch', 'Chama Sombria', '3.200', 'dano']], runes: ['Eletrocutar', 'Golpe Repentino', 'Globos Oculares', 'Inspiração'] },
  };
  const roles = $('#roles');
  if (roles) {
    const show = (k) => {
      const b = B[k];
      [...roles.children].forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.k === k)));
      $('#b-role').textContent = b.role; $('#b-wr').textContent = `${b.wr} WR`; $('#b-games').textContent = `${b.games} jogos`;
      $('#b-items').replaceChildren(...b.items.map(([s, n, g, w]) => el('div', { class: 'slot', tabindex: '0', 'aria-label': `${n}, ${g} de ouro, ${w}` }, s, el('div', { class: 'tip' }, el('b', {}, n), el('span', { class: 'g' }, `${g} de ouro`), el('div', { class: 'muted' }, w)))));
      $('#b-runes').replaceChildren(...b.runes.map((r) => el('span', { class: 'chip' }, r)));
    };
    for (const k of Object.keys(ICON)) {
      const btn = el('button', { type: 'button', 'aria-label': B[k].role, 'data-k': k, 'aria-pressed': 'false' });
      btn.append(icon(ICON[k])); btn.onclick = () => show(k); roles.append(btn);
    }
    show('mid');
  }

  // Timers ao vivo
  const timers = [...document.querySelectorAll('[data-timer]')];
  let t = 0;
  if (timers.length) setInterval(() => { t += 1; for (const x of timers) { const base = Number(x.dataset.timer); const v = base - (t % base); x.textContent = `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; } }, 1000);

  // Planos
  const PL = { free: ['Grátis', 'R$ 0', 'Baixar grátis', '#baixar'], m1: ['30 dias', 'R$ 9,90', 'Comprar 30 dias', 'conta.html?buy=m1'], y1: ['1 ano', 'R$ 59,90', 'Comprar 1 ano', 'conta.html?buy=y1'], life: ['Vitalício', 'R$ 99,90', 'Comprar vitalício', 'conta.html?buy=life'] };
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
    if (exe) document.querySelectorAll('#baixar a.btn').forEach((a) => { a.href = exe.browser_download_url; });
  }).catch(() => {});
})();
