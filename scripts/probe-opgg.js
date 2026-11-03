/** Sonda manual do OP.GG MCP (GitHub Actions): lista as ferramentas/esquemas e salva respostas cruas em audit/probe/. */
const fs = require('fs');
const { ENDPOINT, PROTOCOL } = { ENDPOINT: 'https://mcp-api.op.gg/mcp', PROTOCOL: '2025-06-18' };
let session = null; let id = 1;
async function rpc(method, params, notify = false) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (session) headers['Mcp-Session-Id'] = session;
  const res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: id++, method, params }) });
  if (!session) session = res.headers.get('mcp-session-id');
  const raw = await res.text();
  if (notify) return null;
  const line = raw.trim().startsWith('{') ? raw.trim() : (raw.split('\n').find((l) => l.startsWith('data:')) || '').slice(5).trim();
  return JSON.parse(line);
}
(async () => {
  fs.mkdirSync('audit/probe', { recursive: true });
  await rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'probe', version: '1' } });
  await rpc('notifications/initialized', {}, true);
  const tools = await rpc('tools/list', {});
  fs.writeFileSync('audit/probe/tools.json', JSON.stringify(tools, null, 1));
  const call = async (file, name, args) => {
    const r = await rpc('tools/call', { name, arguments: args });
    fs.writeFileSync(`audit/probe/${file}`, JSON.stringify(r, null, 1));
  };
  const all = ['data'];
  await call('analysis-ahri-mid.json', 'lol_get_champion_analysis', { game_mode: 'ranked', champion: 'AHRI', position: 'mid', lang: 'en_US', desired_output_fields: all });
  await call('analysis-ahri-mid-fields.json', 'lol_get_champion_analysis', { game_mode: 'ranked', champion: 'AHRI', position: 'mid', lang: 'en_US',
    desired_output_fields: ['data.core_items', 'data.core_items[]', 'data.fourth_items', 'data.boots', 'data.starter_items', 'data.runes', 'data.skills', 'data.summoner_spells'] });
  await call('matchup-ahri-zed.json', 'lol_get_lane_matchup_guide', { my_champion: 'AHRI', opponent_champion: 'ZED', position: 'mid', lang: 'en_US' });
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
