const fs = require('fs');
const { norm, clamp } = require('./util');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Normaliza as chaves (nomes de campeões) e valida os valores. Chaves com "_" são comentários. */
function normalizeMeta(raw) {
  const out = { patch: (raw && raw.patch) || null, tiers: {}, counters: {} };

  for (const [role, entries] of Object.entries((raw && raw.tiers) || {})) {
    if (role.startsWith('_') || !entries || typeof entries !== 'object') continue;
    out.tiers[role] = {};
    for (const [champ, value] of Object.entries(entries)) {
      out.tiers[role][norm(champ)] = value;
    }
  }

  for (const [enemy, mine] of Object.entries((raw && raw.counters) || {})) {
    if (enemy.startsWith('_') || !mine || typeof mine !== 'object') continue;
    const row = {};
    for (const [champ, value] of Object.entries(mine)) {
      if (typeof value === 'number' && Number.isFinite(value)) row[norm(champ)] = clamp(value, -1, 1);
    }
    out.counters[norm(enemy)] = row;
  }
  return out;
}

/** Lê e mescla vários arquivos de meta; os últimos sobrescrevem os primeiros. */
function loadMeta(files) {
  const merged = { patch: null, tiers: {}, counters: {} };
  for (const file of files) {
    const raw = readJson(file);
    if (!raw) continue;
    const meta = normalizeMeta(raw);
    merged.patch = meta.patch || merged.patch;
    for (const [role, entries] of Object.entries(meta.tiers)) {
      merged.tiers[role] = { ...(merged.tiers[role] || {}), ...entries };
    }
    for (const [enemy, row] of Object.entries(meta.counters)) {
      merged.counters[enemy] = { ...(merged.counters[enemy] || {}), ...row };
    }
  }
  return merged;
}

module.exports = { loadMeta, normalizeMeta };
