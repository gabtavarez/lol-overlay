const POSITIONS = ['top', 'jungle', 'middle', 'bottom', 'utility'];
const PUUID_RE = /^[0-9a-f-]{20,}$/i;

function normalizePosition(value) {
  const p = String(value || '').toLowerCase();
  return POSITIONS.includes(p) ? p : '';
}

/**
 * O cliente decide se o nome de cada jogador é visível (nameVisibilityType).
 * Quando não é, o nome fica oculto: o app nunca tenta descobrir por outro caminho.
 */
function isNameVisible(selection) {
  return !selection.nameVisibilityType || selection.nameVisibilityType === 'VISIBLE';
}

/** PUUIDs de jogadores com nome visível mas sem gameName na sessão (precisam de lookup). */
function puuidsToResolve(session) {
  const out = new Set();
  const all = [...(session.myTeam || []), ...(session.theirTeam || [])];
  for (const sel of all) {
    if (isNameVisible(sel) && !sel.gameName && PUUID_RE.test(sel.puuid || '')) out.add(sel.puuid);
  }
  return [...out];
}

function mapSelection(sel, { names, dd, localCellId }) {
  const visible = isNameVisible(sel);
  let gameName = '';
  let tagLine = '';
  if (visible) {
    const resolved = names.get(sel.puuid);
    gameName = sel.gameName || (resolved && resolved.gameName) || '';
    tagLine = sel.tagLine || (resolved && resolved.tagLine) || '';
  }
  const lockedKey = sel.championId || 0;
  const effectiveKey = lockedKey || sel.championPickIntent || 0;
  const champ = effectiveKey && dd ? dd.championByKey(effectiveKey) : null;
  return {
    cellId: sel.cellId,
    isMe: sel.cellId === localCellId,
    position: normalizePosition(sel.assignedPosition),
    gameName,
    tagLine,
    nameHidden: !gameName,
    championKey: effectiveKey,
    locked: Boolean(lockedKey),
    champion: champ ? { id: champ.id, name: champ.name, tags: champ.tags || [] } : null,
  };
}

/** Tipo da ação em andamento do jogador local ('ban' | 'pick' | null). */
function currentAction(session) {
  const flat = (session.actions || []).flat();
  const mine = flat.find(
    (a) => a.actorCellId === session.localPlayerCellId && a.isInProgress && !a.completed,
  );
  return mine ? mine.type : null;
}

/** Converte a sessão crua do champ select no estado consumido pelo recomendador e pela UI. */
function buildChampSelectState(session, { names, dd, pickable = [], bannable = [] }) {
  const localCellId = session.localPlayerCellId;
  const ctx = { names, dd, localCellId };
  const team = (session.myTeam || []).map((s) => mapSelection(s, ctx));
  const enemies = (session.theirTeam || []).map((s) => mapSelection(s, ctx));
  const me = team.find((p) => p.isMe) || null;
  const bans = session.bans || {};

  return {
    phase: 'champselect',
    sessionId: session.id,
    queueId: session.queueId,
    timerPhase: (session.timer && session.timer.phase) || '',
    spectating: Boolean(session.isSpectating),
    assets: { version: dd ? dd.version : null },
    myPosition: me ? me.position : '',
    me,
    allies: team.filter((p) => !p.isMe),
    enemies,
    bans: { mine: bans.myTeamBans || [], theirs: bans.theirTeamBans || [] },
    pickable: Array.isArray(pickable) ? pickable : [],
    bannable: Array.isArray(bannable) ? bannable : [],
    action: currentAction(session),
  };
}

module.exports = { buildChampSelectState, puuidsToResolve, normalizePosition, POSITIONS };
