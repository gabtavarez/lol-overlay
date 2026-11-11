(async () => {
  const API = 'https://wzvpedyefbmevazdxtoc.supabase.co/functions/v1/pro';
  const q = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const o = q.get('o'); const t = q.get('t');
  if (!o || !t) { $('title').textContent = 'Pedido não encontrado'; $('sub').textContent = 'Abra o pagamento pelo app (Pro → Comprar).'; return; }
  for (let i = 0; i < 60; i += 1) {
    let d = null;
    try { d = await (await fetch(`${API}/order?o=${encodeURIComponent(o)}&t=${encodeURIComponent(t)}`)).json(); } catch { /* tenta de novo */ }
    if (d && d.status === 'paid' && d.key) {
      $('title').textContent = 'Pagamento aprovado. Pro liberado!';
      $('sub').textContent = 'Pode voltar para o Nexo.';
      $('key').textContent = d.key;
      $('until').textContent = d.expires_at ? `Válido até ${new Date(d.expires_at).toLocaleDateString('pt-BR')}.` : 'Licença vitalícia.';
      $('box').hidden = false;
      return;
    }
    if (d && ['refunded', 'charged_back', 'cancelled'].includes(d.status)) { $('title').textContent = 'Pagamento cancelado'; $('sub').textContent = 'Nada foi cobrado. Você pode tentar de novo pelo app.'; return; }
    if (d && d.error) { $('title').textContent = 'Pedido não encontrado'; $('sub').textContent = 'Abra o pagamento pelo app (Pro → Comprar).'; return; }
    $('title').textContent = 'Aguardando o pagamento…';
    $('sub').textContent = 'Se você pagou com Pix, a confirmação chega em alguns segundos. Pode deixar esta página aberta.';
    await new Promise((r) => setTimeout(r, 5000));
  }
  $('sub').textContent = 'Ainda não chegou a confirmação. Se você já pagou, abra o app e clique em “Já paguei, conferir agora”.';
})();
