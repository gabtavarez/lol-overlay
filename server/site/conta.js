(async () => {
  const SB_URL = 'https://wzvpedyefbmevazdxtoc.supabase.co';
  const SB_KEY = 'sb_publishable_HKM3oyV8sjAbLgKcdKEL2A__hsDiZsr'; // chave pública (só identifica o projeto)
  const API = `${SB_URL}/functions/v1/pro`;
  const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } });
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids.filter((x) => x != null)); return e; };
  const q = new URLSearchParams(location.search);
  // guarda os pedidos da URL antes do login (o Google volta para a página limpa)
  for (const k of ['link', 'buy']) { if (q.get(k)) sessionStorage.setItem(`lo-${k}`, q.get(k)); }
  const pending = (k) => sessionStorage.getItem(`lo-${k}`);
  const clear = (k) => sessionStorage.removeItem(`lo-${k}`);
  const say = (id, text, kind = 'bad') => { $(id).textContent = text || ''; $(id).className = `msg ${kind}`; };
  const brl = (n) => `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;
  const date = (s) => (s ? new Date(s).toLocaleDateString('pt-BR') : '—');
  const PLAN = { m1: '30 dias', y1: '1 ano', life: 'Vitalício', gift: 'Presente' };
  const STATUS = { paid: 'Aprovado', refunded: 'Estornado', charged_back: 'Contestado', cancelled: 'Cancelado' };

  async function call(route, body = {}) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${API}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }

  // ---------- entrar ----------
  let mode = 'in';
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $('auth-title').textContent = mode === 'in' ? 'Entrar' : 'Criar conta';
    $('submit').textContent = mode === 'in' ? 'Entrar' : 'Criar conta';
    $('pass').autocomplete = mode === 'in' ? 'current-password' : 'new-password';
    say('auth-msg', '');
  }));
  $('google').onclick = async () => {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/conta.html` } });
    if (error) say('auth-msg', error.message);
  };
  $('auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('email').value.trim(); const password = $('pass').value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return say('auth-msg', 'E-mail inválido.');
    if (password.length < 8) return say('auth-msg', 'A senha precisa de pelo menos 8 caracteres.');
    $('submit').disabled = true;
    const res = mode === 'in' ? await sb.auth.signInWithPassword({ email, password })
      : await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/conta.html` } });
    $('submit').disabled = false;
    if (res.error) return say('auth-msg', res.error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : res.error.message);
    if (mode === 'up' && !res.data.session) say('auth-msg', 'Conta criada. Confirme pelo link que enviamos ao seu e-mail.', 'ok');
  };
  $('forgot').onclick = async () => {
    const email = $('email').value.trim();
    if (!email) return say('auth-msg', 'Digite seu e-mail acima.');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/conta.html?reset=1` });
    say('auth-msg', error ? error.message : 'Enviamos um link para redefinir a senha.', error ? 'bad' : 'ok');
  };
  $('logout').onclick = async () => { await sb.auth.signOut(); location.href = 'conta.html'; };

  // ---------- conta ----------
  async function load() {
    let d;
    try { d = await call('me'); } catch (err) { say('top-msg', err.message); return; }
    $('acc-email').textContent = d.email || '';
    $('avatar').textContent = (d.email || '?').slice(0, 2).toUpperCase();
    const lic = d.license;
    $('acc-pro').classList.toggle('hidden', !lic);
    $('acc-sub').textContent = lic ? (lic.expires_at ? 'Pro ativo' : 'Pro vitalício') : 'Plano grátis';
    $('acc-until').textContent = lic ? (lic.expires_at ? date(lic.expires_at) : 'para sempre') : '—';
    $('key-box').classList.toggle('hidden', !lic);
    $('acc-key').textContent = lic ? lic.key : '';
    const used = d.devices.filter((x) => x.active).length;
    $('pc-count').textContent = `${used} de ${d.maxDevices}`;
    $('pcs').replaceChildren(...(d.devices.length ? d.devices.map((pc) => {
      const b = el('button', { class: 'btn', type: 'button' }, 'Liberar');
      b.onclick = async () => { b.disabled = true; try { await call('me/release', { install: pc.install }); await load(); } catch (err) { say('top-msg', err.message); b.disabled = false; } };
      return el('div', { class: 'list-row' }, el('div', { style: 'flex:1' }, el('b', {}, `PC ${pc.short}`), el('div', { class: 'dim small' }, pc.active ? `usando o Pro${pc.linked_at ? ` · conectado em ${date(pc.linked_at)}` : ''}` : 'conectado, sem Pro')), b);
    }) : [el('p', { class: 'muted small', style: 'margin:0' }, 'Nenhum PC ainda. Entre com esta conta no app.')]));
    $('buy-title').textContent = lic ? (lic.expires_at ? 'Estender o Pro' : 'Você tem o Pro vitalício') : 'Comprar o Pro';
    $('buy').replaceChildren(...(lic && !lic.expires_at ? [] : d.plans.map((p) => {
      const b = el('button', { class: 'btn primary', type: 'button' }, 'Comprar');
      b.onclick = () => buy(p.id, b);
      return el('div', { class: 'list-row', style: `background:var(--card2)${p.id === 'y1' ? ';border-color:var(--acc)' : ''}` },
        el('div', { style: 'flex:1' }, el('b', {}, PLAN[p.id]), el('div', { class: 'dim small' }, p.days ? `+${p.days} dias` : 'para sempre')),
        el('span', { class: 'mono', style: 'font-weight:700;color:var(--acc)' }, brl(p.price)), b);
    })));
    $('orders').replaceChildren(...d.orders.map((o) => el('tr', {}, el('td', {}, date(o.paid_at || o.created_at)), el('td', {}, PLAN[o.plan] || o.plan), el('td', { class: 'mono' }, brl(o.amount)), el('td', { style: `color:${o.status === 'paid' ? 'var(--good)' : 'var(--warn)'}` }, STATUS[o.status] || o.status))));
    $('no-orders').classList.toggle('hidden', d.orders.length > 0);
  }
  async function buy(plan, btn) {
    if (btn) btn.disabled = true;
    say('buy-msg', 'Abrindo o pagamento…', 'ok');
    try {
      const d = await call('checkout', { plan });
      const host = new URL(d.url).hostname;
      if (!/(^|\.)mercadopago\.com(\.br)?$/.test(host)) throw new Error('endereço de pagamento inesperado');
      location.href = d.url;
    } catch (err) { say('buy-msg', `Não consegui abrir o pagamento: ${err.message}`); if (btn) btn.disabled = false; }
  }
  $('claim').onsubmit = async (e) => {
    e.preventDefault();
    try { await call('me/claim-key', { key: $('claim-key').value }); $('claim-key').value = ''; say('top-msg', 'Chave adicionada à sua conta.', 'ok'); await load(); } catch (err) { say('top-msg', err.message); }
  };
  $('link-ok').onclick = async () => {
    $('link-ok').disabled = true;
    try { await call('link/claim', { code: pending('link') }); clear('link'); $('link-box').classList.add('hidden'); say('top-msg', 'Pronto! Pode voltar para o app: ele entra sozinho em alguns segundos.', 'ok'); await load(); } catch (err) { say('top-msg', err.message); clear('link'); $('link-box').classList.add('hidden'); }
  };

  // Volta do Mercado Pago: confere o pedido até aprovar
  async function watchOrder() {
    const o = q.get('o'); const t = q.get('t');
    if (!o || !t) return;
    history.replaceState(null, '', 'conta.html');
    say('top-msg', 'Conferindo o pagamento… (o Pix costuma levar alguns segundos)', 'ok');
    for (let i = 0; i < 60; i += 1) {
      const d = await fetch(`${API}/order?o=${encodeURIComponent(o)}&t=${encodeURIComponent(t)}`).then((r) => r.json()).catch(() => null);
      if (d && d.status === 'paid') { say('top-msg', 'Pagamento aprovado. Pro liberado!', 'ok'); await load(); return; }
      if (d && (d.error || ['refunded', 'cancelled', 'charged_back'].includes(d.status))) { say('top-msg', 'Pagamento não aprovado.'); return; }
      await new Promise((r) => setTimeout(r, 5000));
    }
    say('top-msg', 'Ainda não chegou a confirmação. Recarregue a página em alguns minutos.');
  }

  let shown;
  async function render(session) {
    const uid = session ? session.user.id : null;
    if (shown === uid) return;
    shown = uid;
    const logged = Boolean(session);
    $('auth').classList.toggle('hidden', logged);
    $('account').classList.toggle('hidden', !logged);
    $('logout').classList.toggle('hidden', !logged);
    $('who').classList.toggle('hidden', !logged);
    if (!logged) {
      if (pending('link')) $('auth-sub').textContent = 'Entre para conectar o LoL Overlay deste PC à sua conta.';
      else if (pending('buy')) $('auth-sub').textContent = 'Entre ou crie sua conta para comprar o Pro.';
      return;
    }
    $('who').textContent = session.user.email;
    $('link-box').classList.toggle('hidden', !pending('link'));
    await load();
    watchOrder();
    const b = pending('buy');
    if (b) { clear('buy'); if (['m1', 'y1', 'life'].includes(b)) buy(b); }
  }
  if (q.get('reset')) {
    const p = prompt('Nova senha (mínimo 8 caracteres):');
    if (p && p.length >= 8) { const { error } = await sb.auth.updateUser({ password: p }); say('top-msg', error ? error.message : 'Senha alterada.', error ? 'bad' : 'ok'); }
  }
  const { data: { session } } = await sb.auth.getSession();
  await render(session);
  sb.auth.onAuthStateChange((ev, s) => { render(s); });
})();
