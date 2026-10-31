/**
 * Auditoria de rotas e tipo de dano (roda no GitHub Actions, onde o OP.GG e o Data Dragon respondem):
 *  1) rotas válidas = tier list do OP.GG por rota, com >= 15% dos jogos do campeão na rota;
 *  2) tipo de dano = damage_type do OP.GG + atributos dos itens core da build mais jogada na rota principal;
 *  3) compara com data/champion-flags.json (apShare) e lista as divergências.
 * Saída: audit/report.json e audit/report.md
 */
const fs = require('fs');
const path = require('path');
const { createMcpClient } = require('../src/providers/opggMcp');
const flags = require('../data/champion-flags.json');

const MIN_ROLE = 0.15; // mesmo corte do picker
const DD = 'https://ddragon.leagueoflegends.com';
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const label = (ap) => (ap >= 0.6 ? 'AP' : ap <= 0.4 ? 'AD' : 'Misto');

(async () => {
  const version = (await (await fetch(`${DD}/api/versions.json`)).json())[0];
  const champs = (await (await fetch(`${DD}/cdn/${version}/data/en_US/champion.json`)).json()).data;
  const items = (await (await fetch(`${DD}/cdn/${version}/data/en_US/item.json`)).json()).data;
  const byNorm = new Map(Object.values(champs).flatMap((c) => [[norm(c.id), c.id], [norm(c.name), c.id]]));
  const client = createMcpClient();

  const tl = await client.tierList();
  const roles = {}; // id -> { role: roleRate }
  for (const [role, rows] of Object.entries(tl)) {
    for (const r of rows) {
      const id = byNorm.get(norm(r.champion));
      if (id) (roles[id] ||= {})[role] = r.roleRate || 0;
    }
  }

  const out = [];
  const ids = Object.keys(champs).sort();
  let done = 0;
  await Promise.all(ids.map(async (id) => {
    const rr = roles[id] || {};
    const valid = Object.entries(rr).filter(([, v]) => v >= MIN_ROLE).sort((a, b) => b[1] - a[1]);
    const main = valid[0] ? valid[0][0] : Object.entries(rr).sort((a, b) => b[1] - a[1]).map(([k]) => k)[0];
    let opgg = null; let core = []; let buildAp = null;
    if (main) {
      try {
        const a = await client.analysis({ id }, main);
        opgg = a.damageType || null;
        core = a.core || [];
        let ap = 0; let ad = 0;
        for (const it of core) {
          const st = (items[it] || {}).stats || {};
          ap += st.FlatMagicDamageMod || 0;
          ad += (st.FlatPhysicalDamageMod || 0) + (st.FlatCritChanceMod || 0) * 50 + (st.PercentAttackSpeedMod || 0) * 40;
        }
        buildAp = ap + ad > 0 ? Math.round((ap / (ap + ad)) * 100) / 100 : null;
      } catch (err) { opgg = `erro: ${err.message}`; }
    }
    const table = flags.apShare[id];
    const issues = [];
    if (!valid.length) issues.push('sem rota com >= 15% dos jogos');
    if (table === undefined) issues.push('fora da tabela apShare');
    const opggLabel = /^AP$/i.test(opgg) ? 'AP' : /^AD$/i.test(opgg) ? 'AD' : opgg ? 'Misto' : null;
    if (table !== undefined && opggLabel && opggLabel !== 'Misto' && label(table) !== opggLabel) issues.push(`tabela ${label(table)} x OP.GG ${opggLabel}`);
    if (table !== undefined && buildAp !== null && label(table) !== 'Misto' && label(buildAp) !== 'Misto' && label(table) !== label(buildAp)) issues.push(`tabela ${label(table)} x itens core ${label(buildAp)}`);
    out.push({ id, name: champs[id].name, roles: Object.fromEntries(valid.map(([k, v]) => [k, Math.round(v * 1000) / 10])), main, table, opgg, buildAp, core, issues });
    if (++done % 20 === 0) console.log(`${done}/${ids.length}`);
  }));
  out.sort((a, b) => a.id.localeCompare(b.id));

  fs.mkdirSync('audit', { recursive: true });
  fs.writeFileSync(path.join('audit', 'report.json'), JSON.stringify({ version, at: new Date().toISOString(), champions: out }, null, 1));
  const lines = [`# Auditoria ${version}`, '', '| Campeão | Rotas (≥5%) | Tabela | OP.GG | Itens core (AP) | Problemas |', '|---|---|---|---|---|---|'];
  for (const c of out) lines.push(`| ${c.name} | ${Object.entries(c.roles).map(([k, v]) => `${k} ${v}%`).join(', ') || '—'} | ${c.table === undefined ? '—' : `${label(c.table)} (${c.table})`} | ${c.opgg || '—'} | ${c.buildAp ?? '—'} | ${c.issues.join('; ')} |`);
  fs.writeFileSync(path.join('audit', 'report.md'), `${lines.join('\n')}\n`);
  console.log(`problemas: ${out.filter((c) => c.issues.length).length}`);
})().catch((err) => { console.error(err); process.exit(1); });
