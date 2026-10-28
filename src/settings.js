const fs = require('fs');
const path = require('path');
const DEFAULTS = require('../data/default-settings.json');
const { toOpggRegion } = require('./opgg');
const { clamp } = require('./util');

const ROLES = ['top', 'jungle', 'middle', 'bottom', 'utility'];
const PANELS = ['buys', 'info', 'gold', 'timers', 'kit', 'goals', 'coach'];
const BUILD_TIERS = ['ALL', 'GOLD', 'PLATINUM_PLUS', 'EMERALD_PLUS', 'DIAMOND_PLUS', 'MASTER_PLUS', 'CHALLENGER'];
const WEIGHT_KEYS = ['mastery', 'meta', 'counter', 'comp', 'synergy'];

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((s) => String(s).trim())
    .filter((s) => s && s.length <= 30)
    .slice(0, 40);
}

function number(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Aplica `input` sobre `base` aceitando só chaves conhecidas e valores válidos. */
function sanitize(input, base) {
  const out = structuredClone(base);
  if (!input || typeof input !== 'object') return out;

  if ('region' in input) {
    const r = String(input.region || 'auto').toLowerCase();
    if (r === 'auto') out.region = 'auto';
    else if (toOpggRegion(r)) out.region = toOpggRegion(r);
  }

  if (input.remoteData && typeof input.remoteData === 'object' && 'enabled' in input.remoteData) {
    out.remoteData.enabled = input.remoteData.enabled === true;
  }

  if ('autoAccept' in input) out.autoAccept = input.autoAccept === true;

  if ('buildTier' in input) {
    const t = String(input.buildTier || '').toUpperCase();
    if (BUILD_TIERS.includes(t)) out.buildTier = t;
  }
  if ('myRiotId' in input) {
    const id = String(input.myRiotId || '').trim();
    if (!id || /^[^#]{1,32}#[^#]{1,8}$/.test(id)) out.myRiotId = id;
  }
  if ('autoImport' in input) out.autoImport = input.autoImport !== false;
  if ('autoUpdate' in input) out.autoUpdate = input.autoUpdate !== false;
  if ('language' in input) out.language = ['pt', 'en', 'es'].includes(input.language) ? input.language : 'pt';
  if ('flashKey' in input) out.flashKey = input.flashKey === 'D' ? 'D' : 'F';
  if ('lastSeenVersion' in input && /^\d+\.\d+\.\d+$/.test(String(input.lastSeenVersion))) out.lastSeenVersion = String(input.lastSeenVersion);
  if ('discordRpc' in input) out.discordRpc = input.discordRpc === true;
  if ('discordClientId' in input) {
    const id = String(input.discordClientId || '').trim();
    if (!id || /^\d{15,22}$/.test(id)) out.discordClientId = id;
  }

  const ov = input.overlay;
  if (ov && typeof ov === 'object') {
    if ('mode' in ov) out.overlay.mode = ov.mode === 'always' ? 'always' : 'tab';
    if (ov.enabled && typeof ov.enabled === 'object') {
      out.overlay.enabled = { ...(out.overlay.enabled || {}) };
      for (const name of PANELS) if (name in ov.enabled) out.overlay.enabled[name] = ov.enabled[name] !== false;
    }
    if (ov.panels && typeof ov.panels === 'object') {
      for (const name of PANELS) {
        if (!(name in ov.panels)) continue;
        const p = ov.panels[name];
        out.overlay.panels[name] = p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))
          ? {
            x: clamp(Math.round(Number(p.x)), 0, 10000),
            y: clamp(Math.round(Number(p.y)), 0, 10000),
            scale: clamp(Number.isFinite(Number(p.scale)) ? Number(p.scale) : 1, 0.5, 2.5),
          }
          : null;
      }
    }
  }

  const p = input.picker;
  if (p && typeof p === 'object') {
    if (p.weights && typeof p.weights === 'object') {
      for (const key of WEIGHT_KEYS) {
        if (key in p.weights) {
          out.picker.weights[key] = clamp(number(p.weights[key], out.picker.weights[key]), 0, 1);
        }
      }
    }
    if (p.pool && typeof p.pool === 'object') {
      for (const role of ROLES) if (role in p.pool) out.picker.pool[role] = cleanList(p.pool[role]);
    }
    if ('blacklist' in p) out.picker.blacklist = cleanList(p.blacklist);
    if ('poolBonus' in p) out.picker.poolBonus = clamp(number(p.poolBonus, out.picker.poolBonus), 0, 0.5);
    if ('minGamesForRole' in p) {
      out.picker.minGamesForRole = clamp(Math.round(number(p.minGamesForRole, 1)), 0, 20);
    }
    if ('maxResults' in p) out.picker.maxResults = clamp(Math.round(number(p.maxResults, 10)), 1, 10);
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Configurações do usuário, salvas em JSON na pasta de dados do app. */
function createSettingsStore(filePath) {
  const saved = readJson(filePath);
  let current = sanitize(saved, DEFAULTS);
  current.overlay.enabled = { ...DEFAULTS.overlay.enabled, ...(current.overlay.enabled || {}) };
  current.overlay.panels = { ...DEFAULTS.overlay.panels, ...(current.overlay.panels || {}) };
  // Migração sem apagar nada: quem estava no antigo padrão de 6 sugestões passa para 10.
  if (saved && saved.picker && saved.picker.maxResults === 6) current.picker.maxResults = 10;

  return {
    get: () => current,
    update(patch) {
      current = sanitize(patch, current);
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const tmp = `${filePath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(current, null, 2));
        fs.renameSync(tmp, filePath);
      } catch {
        // sem permissão de escrita: mantém só em memória
      }
      return current;
    },
  };
}

module.exports = { createSettingsStore, sanitize, DEFAULTS };
