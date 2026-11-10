(() => {
  const API = 'https://wzvpedyefbmevazdxtoc.supabase.co/functions/v1/pro';
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
  let pass = sessionStorage.getItem('adm') || '';
  let data = null;
  const call = async (route, body = {}) => {
    const r = await fetch(`${API}/admin/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin': pass }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  };
  const date = (s) => (s ? new Date(s).toLocaleDateString('pt-BR') : '—');
  const brl = (n) => `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;
  const say = (t, bad) => { $('msg').textContent = t; $('msg').className = `small ${bad ? 'bad' : 'muted'}`; };

  function draw() {
    const now = Date.now();
    const live = data.licenses.filter((l) => !l.revoked && (!l.expires_at || new Date(l.expires_at) > now));
    const paid = data.payments.filter((p) => p.status === 'approved');
    $('stats').replaceChildren(
      el('div', { className: 'stat' }, el('b', { textContent: String(live.length) }), 'licenças ativas'),
      el('div', { className: 'stat' }, el('b', { textContent: String(paid.length) }), 'pagamentos aprovados'),
      el('div', { className: 'stat' }, el('b', { textContent: brl(paid.reduce((n, p) => n + Number(p.amount || 0), 0)) }), 'total recebido'));
    $('paywall').textContent = data.paywall ? 'Desligar a cobrança (liberar tudo para todos)' : 'Ligar a cobrança';
    $('paywall').className = data.paywall ? 'danger' : 'primary';
    $('state').textContent = `Cobrança ${data.paywall ? 'LIGADA' : 'desligada'} · Mercado Pago ${data.ready ? 'configurado' : 'SEM token (ninguém consegue pagar)'} · assinatura do webhook ${data.webhookSigned ? 'ligada' : 'desligada'}`;
    $('lic').replaceChildren(...data.licenses.map((l) => {
      const ok = !l.revoked && (!l.expires_at || new Date(l.expires_at) > now);
      const btn = (text, fn, cls = '') => { const b = el('button', { textContent: text, className: cls }); b.onclick = async () => { b.disabled = true; try { await fn(); await load(); } catch (e) { say(e.message, true); b.disabled = false; } }; return b; };
      return el('tr', {},
        el('td', { className: 'k', textContent: l.key }),
        el('td', { textContent: l.plan }),
        el('td', { className: ok ? 'ok' : 'bad', textContent: l.revoked ? 'cancelada' : l.expires_at ? date(l.expires_at) : 'vitalícia' }),
        el('td', { textContent: String((l.devices || []).length) }),
        el('td', { textContent: l.source === 'gift' ? 'presente' : 'pagamento' }),
        el('td', { textContent: l.note || '' }),
        el('td', {}, el('div', { className: 'row' },
          btn('+30 dias', () => call('extend', { id: l.id, days: 30 })),
          btn('Zerar PCs', () => call('devices', { id: l.id })),
          l.revoked ? btn('Reativar', () => call('revoke', { id: l.id, revoked: false })) : btn('Cancelar', () => call('revoke', { id: l.id }), 'danger'))));
    }));
    $('pay').replaceChildren(...data.payments.map((p) => el('tr', {},
      el('td', { textContent: date(p.created_at) }), el('td', { className: 'k', textContent: p.mp_id }),
      el('td', { className: p.status === 'approved' ? 'ok' : 'bad', textContent: p.status }), el('td', { textContent: brl(p.amount) }), el('td', { textContent: p.method || '' }))));
  }
  async function load() {
    data = await call('list');
    $('login').hidden = true; $('panel').hidden = false;
    draw();
  }
  $('login-form').onsubmit = async (e) => {
    e.preventDefault();
    pass = $('pass').value;
    try { await load(); sessionStorage.setItem('adm', pass); say(''); } catch (err) { say(err.message, true); }
  };
  $('reload').onclick = () => load().catch((e) => say(e.message, true));
  $('paywall').onclick = async () => {
    const on = !data.paywall;
    if (on && !data.ready) { say('Configure o token do Mercado Pago antes de ligar a cobrança.', true); return; }
    try { await call('paywall', { on }); await load(); say(on ? 'Cobrança ligada: os apps passam a exigir o Pro em até 6 horas (ou ao reabrir).' : 'Cobrança desligada.'); } catch (e) { say(e.message, true); }
  };
  $('grant').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const d = await call('grant', { days: $('g-days').value === '' ? null : Number($('g-days').value), note: $('g-note').value });
      $('g-key').textContent = d.license.key;
      $('g-note').value = '';
      await load();
    } catch (err) { say(err.message, true); }
  };
  if (pass) load().catch(() => { sessionStorage.removeItem('adm'); });
})();
