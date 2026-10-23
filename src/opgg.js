// Códigos de região do OP.GG (confirmados na página de multisearch deles):
// NA, ME, EUW, EUNE, OCE, KR, JP, BR, LAS, LAN, RU, TR, SEA, TW, VN.
const REGION_MAP = {
  br: 'br', br1: 'br',
  na: 'na', na1: 'na',
  euw: 'euw', euw1: 'euw',
  eune: 'eune', eun1: 'eune', eun: 'eune',
  kr: 'kr',
  jp: 'jp', jp1: 'jp',
  lan: 'lan', la1: 'lan',
  las: 'las', la2: 'las',
  oce: 'oce', oc1: 'oce',
  tr: 'tr', tr1: 'tr',
  ru: 'ru',
  me: 'me', me1: 'me',
  sea: 'sea', sg2: 'sea', ph2: 'sea', th2: 'sea', sg: 'sea', ph: 'sea', th: 'sea',
  tw: 'tw', tw2: 'tw',
  vn: 'vn', vn2: 'vn',
};

/** Converte o código de região do cliente (BR1, EUW1, br...) no código do OP.GG. */
function toOpggRegion(code) {
  return REGION_MAP[String(code || '').toLowerCase()] || null;
}

function riotIdOf(player) {
  if (!player || !player.gameName) return null;
  return player.tagLine ? `${player.gameName}#${player.tagLine}` : player.gameName;
}

/** Monta a URL da multisearch. Só entram jogadores cujo nome o próprio cliente mostrou. */
function buildMultisearchUrl(players, region) {
  const ids = (players || []).map(riotIdOf).filter(Boolean);
  if (!ids.length || !region) return null;
  return `https://op.gg/lol/multisearch/${region}?summoners=${encodeURIComponent(ids.join(','))}`;
}

function buildMultisearchUrls({ allies, enemies, region }) {
  return {
    allies: buildMultisearchUrl(allies, region),
    enemies: buildMultisearchUrl(enemies, region),
  };
}

module.exports = { toOpggRegion, buildMultisearchUrl, buildMultisearchUrls };
