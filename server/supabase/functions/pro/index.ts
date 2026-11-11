// Nexo Pro — pagamentos (Mercado Pago: Pix e cartão) e licenças assinadas.
// Rotas: /status /checkout /webhook /license /order /admin/*
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const safeEq = (a: Uint8Array, b: Uint8Array) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const MP_TOKEN = () => Deno.env.get("MP_ACCESS_TOKEN") || "";
const MP_SECRET = () => Deno.env.get("MP_WEBHOOK_SECRET") || "";
const ADMIN = () => Deno.env.get("ADMIN_PASSWORD") || "";
const FN_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/pro`;
const DAY = 24 * 3600 * 1000;
const MAX_DEVICES = 2;
const TOKEN_DAYS = 7; // a licença do app é renovada sozinha; offline vale até aqui (+ tolerância do app)

const PLANS: Record<string, { days: number | null; price: number; title: string }> = {
  m1: { days: 30, price: 9.9, title: "Nexo Pro — 30 dias" },
  y1: { days: 365, price: 59.9, title: "Nexo Pro — 1 ano" },
  life: { days: null, price: 99.9, title: "Nexo Pro — vitalício" },
};

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-admin, authorization, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const b64url = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const validInstall = (s: unknown) => typeof s === "string" && /^[A-Za-z0-9-]{16,64}$/.test(s);

// ---------- chave de assinatura (Ed25519): criada no 1º uso e guardada só no banco ----------
let keys: { priv: CryptoKey; pubPem: string } | null = null;
async function signingKeys() {
  if (keys) return keys;
  let { data } = await db.from("pro_secrets").select("value").eq("key", "ed25519").maybeSingle();
  if (!data) {
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as CryptoKeyPair;
    const value = JSON.stringify({ priv: await crypto.subtle.exportKey("jwk", pair.privateKey), spki: b64url(await crypto.subtle.exportKey("spki", pair.publicKey)) });
    await db.from("pro_secrets").upsert({ key: "ed25519", value }, { onConflict: "key", ignoreDuplicates: true });
    ({ data } = await db.from("pro_secrets").select("value").eq("key", "ed25519").maybeSingle());
  }
  const v = JSON.parse(data!.value);
  const priv = await crypto.subtle.importKey("jwk", v.priv, "Ed25519", false, ["sign"]);
  const std = v.spki.replace(/-/g, "+").replace(/_/g, "/");
  const pad = std + "=".repeat((4 - (std.length % 4)) % 4);
  keys = { priv, pubPem: `-----BEGIN PUBLIC KEY-----\n${pad}\n-----END PUBLIC KEY-----\n` };
  return keys;
}
async function signToken(payload: Record<string, unknown>) {
  const { priv } = await signingKeys();
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("Ed25519", priv, new TextEncoder().encode(body));
  return `${body}.${b64url(sig)}`;
}

async function config(key: string, fallback: unknown = null) {
  const { data } = await db.from("pro_config").select("value").eq("key", key).maybeSingle();
  return data ? data.value : fallback;
}
function newKey() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(15));
  const s = [...r].map((b) => abc[b % 32]).join("");
  return `LOP-${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10, 15)}`;
}
const active = (l: { revoked: boolean; expires_at: string | null }) => !l.revoked && (!l.expires_at || new Date(l.expires_at).getTime() > Date.now());
function extended(current: string | null | undefined, days: number | null, had: boolean) {
  if (days == null) return null; // vitalício
  if (had && current == null) return null; // já era vitalício
  const base = current ? Math.max(Date.now(), new Date(current).getTime()) : Date.now();
  return new Date(base + days * DAY).toISOString();
}

// ---------- contas ----------
async function userOf(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt || jwt.split(".").length !== 3) return null;
  const { data } = await db.auth.getUser(jwt);
  return data && data.user ? data.user : null;
}
async function userOfInstall(install: string) {
  const { data } = await db.from("pro_installs").select("user_id").eq("install", install).maybeSingle();
  return data ? data.user_id as string : null;
}
async function licenseOfUser(userId: string) {
  const { data } = await db.from("pro_licenses").select("*").eq("user_id", userId).eq("revoked", false).order("created_at", { ascending: false }).limit(10);
  return (data || []).find(active) || null;
}
async function emailOf(userId: string) {
  const { data } = await db.auth.admin.getUserById(userId);
  return data && data.user ? data.user.email || "" : "";
}
const isWeb = (install: string) => install.startsWith("web-");

// ---------- licença por instalação ----------
async function licenseOfInstall(install: string) {
  const { data } = await db.from("pro_licenses").select("*").contains("devices", [install]).eq("revoked", false).order("created_at", { ascending: false }).limit(5);
  return (data || []).find(active) || null;
}

async function grantForOrder(order: { id: string; install: string; plan: string; license_id: string | null; user_id: string | null }) {
  const plan = PLANS[order.plan];
  const existing = (order.user_id ? await licenseOfUser(order.user_id) : null) || (isWeb(order.install) ? null : await licenseOfInstall(order.install));
  if (existing) {
    const expires_at = extended(existing.expires_at, plan.days, true);
    await db.from("pro_licenses").update({ expires_at, plan: plan.days == null ? "life" : existing.plan === "life" ? "life" : order.plan, ...(order.user_id && !existing.user_id ? { user_id: order.user_id } : {}) }).eq("id", existing.id);
    return existing.id as string;
  }
  const { data, error } = await db.from("pro_licenses").insert({ key: newKey(), plan: order.plan, expires_at: extended(null, plan.days, false), devices: isWeb(order.install) ? [] : [order.install], source: "payment", user_id: order.user_id || null }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

// ---------- Mercado Pago ----------
async function mp(path: string, init: RequestInit = {}) {
  const r = await fetch(`https://api.mercadopago.com${path}`, { ...init, headers: { Authorization: `Bearer ${MP_TOKEN()}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Mercado Pago ${r.status}: ${body.message || body.error || "erro"}`);
  return body;
}

async function validSignature(req: Request, dataId: string) {
  const secret = MP_SECRET();
  if (!secret) return true; // sem segredo configurado: o pagamento é sempre conferido direto na API do Mercado Pago
  const parts = Object.fromEntries((req.headers.get("x-signature") || "").split(",").map((p) => p.trim().split("=")));
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${req.headers.get("x-request-id") || ""};ts:${parts.ts};`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return mac.length === parts.v1.length && safeEq(new TextEncoder().encode(mac), new TextEncoder().encode(parts.v1));
}

async function processPayment(paymentId: string) {
  const p = await mp(`/v1/payments/${encodeURIComponent(paymentId)}`);
  const orderId = String(p.external_reference || "");
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return { ignored: "sem pedido" };
  const { data: order } = await db.from("pro_orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return { ignored: "pedido desconhecido" };
  await db.from("pro_payments").upsert({ mp_id: String(p.id), order_id: order.id, status: p.status, amount: p.transaction_amount, method: p.payment_type_id || p.payment_method_id, updated_at: new Date().toISOString() }, { onConflict: "mp_id" });

  if (p.status === "approved") {
    if (p.currency_id !== "BRL" || Number(p.transaction_amount) + 0.001 < Number(order.amount)) return { ignored: "valor diferente do pedido" };
    // só quem conseguir trocar pending -> paid concede (evita conceder duas vezes em avisos repetidos)
    const { data: won } = await db.from("pro_orders").update({ status: "paid", paid_at: new Date().toISOString(), mp_payment: String(p.id) }).eq("id", order.id).eq("status", "pending").select("id");
    if (!won || !won.length) return { ok: true, already: true };
    try {
      const license_id = await grantForOrder(order);
      await db.from("pro_orders").update({ license_id }).eq("id", order.id);
    } catch (err) {
      await db.from("pro_orders").update({ status: "pending", paid_at: null }).eq("id", order.id); // tenta de novo no próximo aviso
      throw err;
    }
    return { ok: true, granted: true };
  }
  if (["refunded", "charged_back", "cancelled"].includes(p.status) && order.status === "paid" && order.mp_payment === String(p.id)) {
    const { data: won } = await db.from("pro_orders").update({ status: p.status }).eq("id", order.id).eq("status", "paid").select("license_id");
    if (won && won.length && won[0].license_id) await db.from("pro_licenses").update({ revoked: true, note: `estorno do pagamento ${p.id}` }).eq("id", won[0].license_id);
    return { ok: true, revoked: true };
  }
  return { ok: true, status: p.status };
}

// ---------- rotas ----------
async function status() {
  const { pubPem } = await signingKeys();
  return json({ paywall: (await config("paywall", false)) === true, ready: !!MP_TOKEN(), publicKey: pubPem, plans: Object.entries(PLANS).map(([id, p]) => ({ id, days: p.days, price: p.price })) });
}

async function checkout(req: Request) {
  const body = await req.json().catch(() => ({}));
  const plan = body.plan;
  const user = await userOf(req);
  const install = user && !body.install ? `web-${user.id}` : body.install;
  if (!validInstall(install) || !PLANS[plan]) return json({ error: "pedido inválido" }, 400);
  const user_id = user ? user.id : await userOfInstall(install);
  if (!MP_TOKEN()) return json({ error: "pagamento ainda não configurado" }, 503);
  const p = PLANS[plan];
  const view_token = b64url(crypto.getRandomValues(new Uint8Array(18)));
  const { data: order, error } = await db.from("pro_orders").insert({ install, plan, amount: p.price, view_token, user_id }).select("id").single();
  if (error) return json({ error: "não consegui criar o pedido" }, 500);
  const site = String(await config("site", "") || "");
  const back = site ? (user ? `${site}/conta.html?o=${order.id}&t=${view_token}` : `${site}/ok.html?o=${order.id}&t=${view_token}`) : undefined;
  const pref = await mp("/checkout/preferences", {
    method: "POST",
    body: JSON.stringify({
      items: [{ id: plan, title: p.title, quantity: 1, currency_id: "BRL", unit_price: p.price }],
      external_reference: order.id,
      notification_url: `${FN_URL}/webhook`,
      statement_descriptor: "NEXO",
      payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }], installments: 1 },
      ...(back ? { back_urls: { success: back, pending: back, failure: back }, auto_return: "approved" } : {}),
    }),
  });
  await db.from("pro_orders").update({ mp_preference: pref.id }).eq("id", order.id);
  return json({ url: pref.init_point, order: order.id });
}

async function webhook(req: Request, url: URL) {
  const body = await req.json().catch(() => ({}));
  const type = body.type || url.searchParams.get("type") || url.searchParams.get("topic");
  const id = String((body.data && body.data.id) || url.searchParams.get("data.id") || url.searchParams.get("id") || "");
  if (type !== "payment" || !/^\d+$/.test(id)) return json({ ok: true, ignored: true });
  if (!(await validSignature(req, id))) return json({ error: "assinatura inválida" }, 401);
  try {
    return json(await processPayment(id));
  } catch (err) {
    const msg = (err as Error).message || "";
    console.error("webhook", msg);
    if (/Mercado Pago 404/.test(msg)) return json({ ok: true, ignored: "pagamento inexistente" }); // aviso de teste do painel
    return json({ error: "falha ao processar" }, 500); // o Mercado Pago reenvia
  }
}

async function license(req: Request) {
  const { install, key } = await req.json().catch(() => ({}));
  const paywall = (await config("paywall", false)) === true;
  if (!validInstall(install)) return json({ error: "instalação inválida", paywall }, 400);
  let lic = null;
  if (key) {
    const { data } = await db.from("pro_licenses").select("*").eq("key", String(key).trim().toUpperCase()).maybeSingle();
    if (!data) return json({ token: null, reason: "chave não encontrada", paywall });
    if (data.revoked) return json({ token: null, reason: "licença cancelada", paywall });
    if (!active(data)) return json({ token: null, reason: "licença vencida", expires_at: data.expires_at, paywall });
    const devices: string[] = Array.isArray(data.devices) ? data.devices : [];
    if (!devices.includes(install)) {
      if (devices.length >= MAX_DEVICES) return json({ token: null, reason: `esta chave já está em ${MAX_DEVICES} computadores`, paywall });
      await db.from("pro_licenses").update({ devices: [...devices, install] }).eq("id", data.id);
    }
    lic = data;
  } else {
    lic = await licenseOfInstall(install);
  }
  const owner = await userOfInstall(install);
  const account = owner ? await emailOf(owner) : null;
  if (!lic && owner) {
    const ul = await licenseOfUser(owner);
    if (ul) {
      const devices: string[] = Array.isArray(ul.devices) ? ul.devices : [];
      if (devices.length >= MAX_DEVICES) return json({ token: null, reason: `sua conta já está em ${MAX_DEVICES} computadores: libere um no site`, paywall, account });
      await db.from("pro_licenses").update({ devices: [...devices, install] }).eq("id", ul.id);
      lic = ul;
    }
  }
  if (!lic) return json({ token: null, reason: "sem licença", paywall, account });
  const until = lic.expires_at ? new Date(lic.expires_at).getTime() : null;
  const exp = Math.min(until ?? Infinity, Date.now() + TOKEN_DAYS * DAY);
  const token = await signToken({ plan: "pro", kind: lic.plan, install, exp, until });
  return json({ token, key: lic.key, kind: lic.plan, expires_at: lic.expires_at, paywall, account });
}

// ---------- entrar no app pelo navegador ----------
async function linkStart(req: Request) {
  const { install } = await req.json().catch(() => ({}));
  if (!validInstall(install) || isWeb(install)) return json({ error: "instalação inválida" }, 400);
  await db.from("pro_links").delete().lt("created_at", new Date(Date.now() - 15 * 60000).toISOString());
  const code = b64url(crypto.getRandomValues(new Uint8Array(24)));
  await db.from("pro_links").insert({ code, install });
  const site = String(await config("site", "") || "");
  return json({ code, url: `${site}/conta.html?link=${code}` });
}
async function linkClaim(req: Request) {
  const user = await userOf(req);
  if (!user) return json({ error: "entre na sua conta" }, 401);
  const { code } = await req.json().catch(() => ({}));
  const { data: l } = await db.from("pro_links").select("*").eq("code", String(code || "")).maybeSingle();
  if (!l || new Date(l.created_at).getTime() < Date.now() - 15 * 60000) return json({ error: "link expirado: clique em Entrar no app de novo" }, 404);
  await db.from("pro_links").update({ user_id: user.id }).eq("code", l.code);
  await db.from("pro_installs").upsert({ install: l.install, user_id: user.id, linked_at: new Date().toISOString() }, { onConflict: "install" });
  return json({ ok: true });
}
async function linkPoll(req: Request) {
  const { install, code } = await req.json().catch(() => ({}));
  const { data: l } = await db.from("pro_links").select("*").eq("code", String(code || "")).eq("install", String(install || "")).maybeSingle();
  if (!l) return json({ done: false, expired: true });
  if (!l.user_id) return json({ done: false });
  await db.from("pro_links").delete().eq("code", l.code);
  return json({ done: true, account: await emailOf(l.user_id) });
}
async function linkLogout(req: Request) {
  const { install } = await req.json().catch(() => ({}));
  if (!validInstall(install)) return json({ error: "instalação inválida" }, 400);
  const owner = await userOfInstall(install);
  if (owner) {
    const ul = await licenseOfUser(owner);
    if (ul && Array.isArray(ul.devices)) await db.from("pro_licenses").update({ devices: ul.devices.filter((d: string) => d !== install) }).eq("id", ul.id);
    await db.from("pro_installs").delete().eq("install", install);
  }
  return json({ ok: true });
}

// ---------- minha conta (site) ----------
async function me(req: Request, route: string) {
  const user = await userOf(req);
  if (!user) return json({ error: "entre na sua conta" }, 401);
  const body = await req.json().catch(() => ({}));
  if (route === "me/release") {
    const install = String(body.install || "");
    const ul = await licenseOfUser(user.id);
    if (ul && Array.isArray(ul.devices)) await db.from("pro_licenses").update({ devices: ul.devices.filter((d: string) => d !== install) }).eq("id", ul.id);
    await db.from("pro_installs").delete().eq("install", install).eq("user_id", user.id);
    return json({ ok: true });
  }
  if (route === "me/claim-key") {
    const { data: l } = await db.from("pro_licenses").select("id, user_id").eq("key", String(body.key || "").trim().toUpperCase()).maybeSingle();
    if (!l) return json({ error: "chave não encontrada" }, 404);
    if (l.user_id && l.user_id !== user.id) return json({ error: "essa chave já está em outra conta" }, 409);
    await db.from("pro_licenses").update({ user_id: user.id }).eq("id", l.id);
    return json({ ok: true });
  }
  const lic = await licenseOfUser(user.id);
  const { data: installs } = await db.from("pro_installs").select("install, linked_at").eq("user_id", user.id).order("linked_at", { ascending: false });
  const { data: orders } = await db.from("pro_orders").select("id, plan, amount, status, created_at, paid_at, mp_payment").eq("user_id", user.id).neq("status", "pending").order("created_at", { ascending: false }).limit(50);
  const devices: string[] = lic && Array.isArray(lic.devices) ? lic.devices : [];
  const linked = new Map((installs || []).map((i) => [i.install, i.linked_at]));
  return json({
    email: user.email,
    license: lic ? { key: lic.key, kind: lic.plan, expires_at: lic.expires_at } : null,
    devices: [...new Set([...devices, ...linked.keys()])].map((d) => ({ install: d, short: d.slice(0, 8).toUpperCase(), linked_at: linked.get(d) || null, active: devices.includes(d) })),
    maxDevices: MAX_DEVICES,
    orders: orders || [],
    plans: Object.entries(PLANS).map(([id, p]) => ({ id, days: p.days, price: p.price })),
  });
}

async function orderView(url: URL) {
  const o = url.searchParams.get("o") || "";
  const t = url.searchParams.get("t") || "";
  if (!/^[0-9a-f-]{36}$/.test(o) || !t) return json({ error: "pedido inválido" }, 400);
  const { data: order } = await db.from("pro_orders").select("status, plan, view_token, license_id").eq("id", o).maybeSingle();
  if (!order || order.view_token !== t) return json({ error: "pedido não encontrado" }, 404);
  let lic = null;
  if (order.license_id) ({ data: lic } = await db.from("pro_licenses").select("key, expires_at").eq("id", order.license_id).maybeSingle());
  return json({ status: order.status, plan: order.plan, key: lic ? lic.key : null, expires_at: lic ? lic.expires_at : null });
}

async function admin(req: Request, route: string) {
  const pass = ADMIN();
  if (!pass) return json({ error: "defina o segredo ADMIN_PASSWORD no Supabase" }, 503);
  const got = req.headers.get("x-admin") || "";
  const a = new TextEncoder().encode(got.padEnd(128).slice(0, 128));
  const b = new TextEncoder().encode(pass.padEnd(128).slice(0, 128));
  if (got.length !== pass.length || !safeEq(a, b)) {
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: "senha incorreta" }, 401);
  }
  const body = await req.json().catch(() => ({}));
  if (route === "list") {
    const [{ data: licenses }, { data: orders }, { data: payments }] = await Promise.all([
      db.from("pro_licenses").select("*").order("created_at", { ascending: false }).limit(300),
      db.from("pro_orders").select("id, plan, amount, status, created_at, paid_at, license_id, mp_payment").neq("status", "pending").order("created_at", { ascending: false }).limit(300),
      db.from("pro_payments").select("mp_id, status, amount, method, created_at").order("created_at", { ascending: false }).limit(300),
    ]);
    return json({ paywall: (await config("paywall", false)) === true, ready: !!MP_TOKEN(), webhookSigned: !!MP_SECRET(), licenses, orders, payments });
  }
  if (route === "grant") {
    const days = body.days == null || body.days === "" ? null : Math.max(1, Math.min(36500, Number(body.days) || 0));
    const { data, error } = await db.from("pro_licenses").insert({ key: newKey(), plan: days == null ? "life" : "gift", expires_at: extended(null, days, false), source: "gift", note: String(body.note || "").slice(0, 200) }).select("*").single();
    return error ? json({ error: error.message }, 500) : json({ license: data });
  }
  if (route === "revoke") {
    const { error } = await db.from("pro_licenses").update({ revoked: body.revoked !== false }).eq("id", String(body.id));
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }
  if (route === "extend") {
    const { data: l } = await db.from("pro_licenses").select("expires_at").eq("id", String(body.id)).maybeSingle();
    if (!l) return json({ error: "licença não encontrada" }, 404);
    const days = body.days == null || body.days === "" ? null : Number(body.days) || 0;
    const { error } = await db.from("pro_licenses").update({ expires_at: extended(l.expires_at, days, true), ...(days == null ? { plan: "life" } : {}) }).eq("id", String(body.id));
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }
  if (route === "devices") {
    const { error } = await db.from("pro_licenses").update({ devices: [] }).eq("id", String(body.id));
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }
  if (route === "paywall") {
    await db.from("pro_config").upsert({ key: "paywall", value: body.on === true, updated_at: new Date().toISOString() }, { onConflict: "key" });
    return json({ paywall: body.on === true });
  }
  return json({ error: "rota desconhecida" }, 404);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const route = url.pathname.replace(/^.*\/pro\/?/, "").replace(/\/+$/, "");
  try {
    if (route === "status" && req.method === "GET") return await status();
    if (route === "order" && req.method === "GET") return await orderView(url);
    if (req.method !== "POST") return json({ error: "rota desconhecida" }, 404);
    if (route === "checkout") return await checkout(req);
    if (route === "webhook") return await webhook(req, url);
    if (route === "license") return await license(req);
    if (route === "link/start") return await linkStart(req);
    if (route === "link/claim") return await linkClaim(req);
    if (route === "link/poll") return await linkPoll(req);
    if (route === "link/logout") return await linkLogout(req);
    if (route === "me" || route.startsWith("me/")) return await me(req, route);
    if (route.startsWith("admin/")) return await admin(req, route.slice(6));
    return json({ error: "rota desconhecida" }, 404);
  } catch (err) {
    console.error(route, (err as Error).message);
    return json({ error: (err as Error).message || "erro interno" }, 500);
  }
});
