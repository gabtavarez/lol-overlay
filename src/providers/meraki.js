const fs = require('fs/promises');
const path = require('path');

/**
 * Meraki Analytics (dados abertos do LoL): habilidades com recarga por nível, rotas e tipo de dano.
 * Um arquivo por campeão, guardado em disco por 3 dias. Campeão novo que o Meraki ainda não tem -> null.
 */
const BASE = 'https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions';
const TTL = 3 * 24 * 3600 * 1000;

function cooldowns(ability) {
  const mod = ability && ability.cooldown && ability.cooldown.modifiers && ability.cooldown.modifiers[0];
  return mod && Array.isArray(mod.values) ? mod.values : [];
}

function summarize(j) {
  const ab = j.abilities || {};
  return {
    positions: j.positions || [],
    adaptiveType: j.adaptiveType || null,
    patchLastChanged: j.patchLastChanged || null,
    abilities: ['Q', 'W', 'E', 'R'].map((key) => {
      const a = (ab[key] || [])[0] || {};
      return { key, name: a.name || key, cooldowns: cooldowns(a), spellshieldable: a.spellshieldable || null };
    }),
  };
}

function createMeraki({ cacheDir, fetchImpl = fetch }) {
  const mem = new Map();
  return {
    async champion(id) {
      if (mem.has(id)) return mem.get(id);
      const file = path.join(cacheDir, `${id}.json`);
      try {
        const st = await fs.stat(file);
        if (Date.now() - st.mtimeMs < TTL) {
          const data = JSON.parse(await fs.readFile(file, 'utf8'));
          mem.set(id, data);
          return data;
        }
      } catch { /* sem cache */ }
      try {
        const res = await fetchImpl(`${BASE}/${encodeURIComponent(id)}.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = summarize(await res.json());
        await fs.mkdir(cacheDir, { recursive: true });
        await fs.writeFile(file, JSON.stringify(data));
        mem.set(id, data);
        return data;
      } catch {
        mem.set(id, null);
        return null;
      }
    },
    cached: (id) => mem.get(id) || null,
  };
}

/** Rank da ult pelo nível do campeão (6/11/16). */
const ultRank = (level) => (level >= 16 ? 3 : level >= 11 ? 2 : level >= 6 ? 1 : 0);

module.exports = { createMeraki, summarize, ultRank };
