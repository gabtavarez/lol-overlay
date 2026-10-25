const net = require('net');
const crypto = require('crypto');

/**
 * Discord Rich Presence pelo IPC local do Discord (named pipe discord-ipc-N), sem dependências.
 * Precisa do Application ID de um app criado em discord.com/developers (o nome do app é o
 * "Jogando ..." que aparece no perfil).
 */

const ROLE_PT = { top: 'Topo', jungle: 'Selva', middle: 'Meio', bottom: 'Atirador', utility: 'Suporte', TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte' };
const TIER_PT = { IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro', PLATINUM: 'Platina', EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante' };
const DD = 'https://ddragon.leagueoflegends.com/cdn';
const LOGO = 'https://raw.githubusercontent.com/gabtavarez/lol-overlay/main/build/icon.png';
const DOWNLOAD = 'https://github.com/gabtavarez/lol-overlay/releases/latest';

function rankText(rank) {
  if (!rank || !rank.tier) return null;
  const t = TIER_PT[String(rank.tier).toUpperCase()] || rank.tier;
  const high = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(String(rank.tier).toUpperCase());
  return `${t}${!high && rank.division ? ` ${rank.division}` : ''}${typeof rank.lp === 'number' ? ` · ${rank.lp} PDL` : ''}`;
}

/** Estado do app -> atividade do Discord (ou null para limpar). Pura, testável. */
function activityFor({ live, lcu, rank, version, gameStart }) {
  const rk = rankText(rank);
  const base = { buttons: [{ label: 'Baixar o LoL Overlay', url: DOWNLOAD }], instance: false };
  if (live && live.phase === 'ingame' && live.me) {
    const me = live.me;
    const s = me.scores || {};
    const champImg = version && me.championId ? `${DD}/${version}/img/champion/${me.championId}.png` : LOGO;
    return {
      ...base,
      details: `${me.champion}${ROLE_PT[me.position] ? ` · ${ROLE_PT[me.position]}` : ''}`,
      state: `${s.kills || 0}/${s.deaths || 0}/${s.assists || 0} · ${s.cs || 0} CS`,
      timestamps: gameStart ? { start: gameStart } : undefined,
      assets: { large_image: champImg, large_text: me.champion, small_image: LOGO, small_text: rk || 'LoL Overlay' },
    };
  }
  if (lcu && lcu.phase === 'champselect') {
    const c = lcu.me && lcu.me.champion;
    return {
      ...base,
      details: `Champ select${ROLE_PT[lcu.myPosition] ? ` · ${ROLE_PT[lcu.myPosition]}` : ''}`,
      state: c ? `${lcu.me.locked ? 'Travou' : 'Escolhendo'} ${c.name}` : 'Escolhendo campeão',
      assets: { large_image: c && version ? `${DD}/${version}/img/champion/${c.id}.png` : LOGO, large_text: c ? c.name : 'LoL Overlay', small_image: LOGO, small_text: rk || 'LoL Overlay' },
    };
  }
  if (lcu && lcu.client === 'open') {
    return { ...base, details: 'No cliente do LoL', state: rk || 'Preparando a próxima', assets: { large_image: LOGO, large_text: 'LoL Overlay' } };
  }
  return null;
}

function frame(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

function createDiscordRpc({ log = () => {}, connectImpl = net.connect, platform = process.platform } = {}) {
  let sock = null;
  let ready = false;
  let clientId = null;
  let pending = undefined; // última atividade pedida (undefined = nada novo)
  let sentKey = null;
  let lastSend = 0;
  let timer = null;
  let retryAt = 0;

  const pipe = (n) => (platform === 'win32' ? `\\\\?\\pipe\\discord-ipc-${n}` : `${process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp'}/discord-ipc-${n}`);

  function close() {
    ready = false;
    sentKey = null;
    if (sock) { try { sock.destroy(); } catch { /* já fechado */ } }
    sock = null;
  }

  function connect(n = 0) {
    if (sock || !clientId || Date.now() < retryAt) return;
    if (n > 9) { retryAt = Date.now() + 30000; return; }
    const s = connectImpl(pipe(n));
    sock = s;
    let buf = Buffer.alloc(0);
    s.on('connect', () => s.write(frame(0, { v: 1, client_id: clientId })));
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 8) {
        const op = buf.readInt32LE(0);
        const len = buf.readInt32LE(4);
        if (buf.length < 8 + len) break;
        let msg = null;
        try { msg = JSON.parse(buf.slice(8, 8 + len).toString('utf8')); } catch { /* ignora */ }
        buf = buf.slice(8 + len);
        if (op === 1 && msg && msg.evt === 'READY') { ready = true; log('Discord: conectado'); flush(); }
        if (op === 1 && msg && msg.evt === 'ERROR') log(`Discord: ${msg.data && msg.data.message}`);
        if (op === 2) { log(`Discord: conexão recusada (${msg && msg.message})`); retryAt = Date.now() + 60000; close(); }
      }
    });
    s.on('error', () => { if (sock === s) { sock = null; ready = false; } connect(n + 1); });
    s.on('close', () => { if (sock === s) close(); });
  }

  function flush() {
    if (!ready || pending === undefined) return;
    const key = JSON.stringify(pending);
    if (key === sentKey) { pending = undefined; return; }
    const wait = 15000 - (Date.now() - lastSend); // limite do Discord: ~5 por 20 s
    if (wait > 0) { clearTimeout(timer); timer = setTimeout(flush, wait); return; }
    sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: pending }, nonce: crypto.randomUUID() }));
    sentKey = key;
    lastSend = Date.now();
    pending = undefined;
  }

  return {
    /** Liga/desliga e troca o Application ID. */
    configure(enabled, id) {
      const next = enabled && id ? id : null;
      if (next !== clientId) { close(); clientId = next; retryAt = 0; }
      if (clientId) connect();
    },
    set(activity) {
      if (!clientId) return;
      pending = activity || null;
      if (!sock) connect();
      flush();
    },
    status: () => (!clientId ? 'off' : ready ? 'connected' : 'connecting'),
    stop() { clearTimeout(timer); close(); clientId = null; },
  };
}

module.exports = { createDiscordRpc, activityFor, rankText, frame };
