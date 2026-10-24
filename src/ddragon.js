const fs = require('fs/promises');
const path = require('path');

const BASE = 'https://ddragon.leagueoflegends.com';
const RAW_PREFIX = 'game_character_displayname_';

function championIdFromRaw(raw) {
  return raw && raw.startsWith(RAW_PREFIX) ? raw.slice(RAW_PREFIX.length) : null;
}

/**
 * Carrega campeões e itens do Data Dragon (oficial da Riot) e guarda em cache
 * em disco por patch. Sem rede, usa a última versão em cache.
 */
class DataDragon {
  constructor({ cacheDir, lang = 'pt_BR', fetchImpl = globalThis.fetch }) {
    this.cacheDir = cacheDir;
    this.lang = lang;
    this.fetch = fetchImpl;
    this.version = null;
    this.champions = {};
    this.items = {};
    this._championsByName = new Map();
  }

  async init() {
    let version;
    try {
      const versions = await this._fetchJson(`${BASE}/api/versions.json`);
      version = versions[0];
    } catch {
      version = await this._latestCachedVersion();
      if (!version) throw new Error('sem rede e sem cache local');
    }
    this.version = version;

    const champions = await this._cachedJson(version, 'champion.json');
    const items = await this._cachedJson(version, 'item.json');
    this.champions = champions.data;
    this._championsByKey = null;
    this.items = items.data;
    this._championsByName = new Map(
      Object.values(this.champions).map((c) => [c.name.toLowerCase(), c]),
    );
  }

  /** Resolve o campeão a partir do rawChampionName da Live API (com fallback pelo nome). */
  championByRaw(raw, displayName) {
    const id = championIdFromRaw(raw);
    if (id && this.champions[id]) return this.champions[id];
    if (displayName) return this._championsByName.get(displayName.toLowerCase()) || null;
    return null;
  }

  /** Campeão pela chave numérica que o cliente do LoL usa (ex.: 222 = Jinx). */
  championByKey(key) {
    if (!this._championsByKey) {
      this._championsByKey = new Map(
        Object.values(this.champions).map((c) => [Number(c.key), c]),
      );
    }
    return this._championsByKey.get(Number(key)) || null;
  }

  /** Passiva + Q/W/E/R do campeão (nome e arquivo do ícone), do arquivo champion/<id>.json. */
  async championSkills(id) {
    this._skills = this._skills || new Map();
    if (this._skills.has(id)) return this._skills.get(id);
    const json = await this._cachedJson(this.version, `champion/${id}.json`);
    const c = json.data[id];
    const out = {
      passive: c.passive ? { name: c.passive.name, icon: `passive/${c.passive.image.full}` } : null,
      spells: c.spells.slice(0, 4).map((s, i) => ({ key: 'QWER'[i], name: s.name, icon: `spell/${s.image.full}`, cooldowns: Array.isArray(s.cooldown) ? s.cooldown : [] })),
    };
    this._skills.set(id, out);
    return out;
  }

  item(id) {
    return this.items[String(id)] || null;
  }

  async _fetchJson(url) {
    const res = await this.fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    return res.json();
  }

  async _cachedJson(version, file) {
    const dir = path.join(this.cacheDir, version, this.lang);
    const filePath = path.join(dir, file);
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch {
      // sem cache (ou cache corrompido): baixa de novo
    }
    const json = await this._fetchJson(`${BASE}/cdn/${version}/data/${this.lang}/${file}`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(json));
    return json;
  }

  async _latestCachedVersion() {
    try {
      const entries = await fs.readdir(this.cacheDir);
      const sorted = entries
        .filter((e) => /^\d+\.\d+(\.\d+)?$/.test(e))
        .sort((a, b) => {
          const pa = a.split('.').map(Number);
          const pb = b.split('.').map(Number);
          for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const d = (pb[i] || 0) - (pa[i] || 0);
            if (d) return d;
          }
          return 0;
        });
      return sorted[0] || null;
    } catch {
      return null;
    }
  }
}

module.exports = { DataDragon, championIdFromRaw, BASE };
