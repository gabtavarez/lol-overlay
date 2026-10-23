const http = require('http');
const https = require('https');
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

// O cliente do LoL (LCU) escuta só em 127.0.0.1 com certificado autoassinado.
// O host é fixo em loopback, então desligar a verificação TLS aqui não expõe nada.
const insecureLocalAgent = new https.Agent({ rejectUnauthorized: false });

function connectionError(message) {
  const err = new Error(message);
  err.isConnectionError = true;
  return err;
}

/** Extrai porta e token da linha de comando do LeagueClientUx. */
function parseCommandLine(text) {
  const port = /--app-port=(\d+)/.exec(text || '');
  const token = /--remoting-auth-token=([\w-]+)/.exec(text || '');
  if (!port || !token) return null;
  return { port: Number(port[1]), token: token[1], protocol: 'https' };
}

/** Formato do lockfile: nome:pid:porta:senha:protocolo */
function parseLockfile(text) {
  const [, , port, password, protocol] = String(text || '').trim().split(':');
  if (!port || !password) return null;
  return { port: Number(port), token: password, protocol: protocol || 'https' };
}

function run(cmd, args, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

async function credentialsFromProcess() {
  if (process.platform === 'win32') {
    // Sem aspas duplas no script para não depender de escape de argumentos.
    const script =
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'LeagueClientUx.exe' } | ForEach-Object { $_.CommandLine }";
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    return parseCommandLine(out);
  }
  const out = await run('ps', ['-A', '-o', 'args=']);
  const line = out.split('\n').find((l) => l.includes('LeagueClientUx'));
  return line ? parseCommandLine(line) : null;
}

function lockfileCandidates() {
  const list = [];
  if (process.env.LOL_INSTALL_DIR) list.push(path.join(process.env.LOL_INSTALL_DIR, 'lockfile'));
  if (process.platform === 'win32') list.push('C:\\Riot Games\\League of Legends\\lockfile');
  if (process.platform === 'darwin') list.push('/Applications/League of Legends.app/Contents/LoL/lockfile');
  return list;
}

/** Procura as credenciais do cliente: primeiro pelo processo, depois pelo lockfile. */
async function discoverCredentials() {
  try {
    const fromProcess = await credentialsFromProcess();
    if (fromProcess) return fromProcess;
  } catch {
    // processo não encontrado ou sem permissão: tenta o lockfile
  }
  for (const file of lockfileCandidates()) {
    try {
      const creds = parseLockfile(await fs.readFile(file, 'utf8'));
      if (creds) return creds;
    } catch {
      // próximo candidato
    }
  }
  return null;
}

/** GET no LCU. Resolve com { status, body } (inclusive 404); rejeita só em falha de conexão. */
function lcuRequest(creds, apiPath, { timeoutMs = 2500, method = 'GET', json } = {}) {
  return new Promise((resolve, reject) => {
    const port = Number(creds && creds.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return reject(connectionError('porta inválida'));
    }
    const isHttps = (creds.protocol || 'https') === 'https';
    const lib = isHttps ? https : http;
    const options = {
      host: '127.0.0.1',
      port,
      path: apiPath,
      method,
      timeout: timeoutMs,
      headers: {
        Authorization: `Basic ${Buffer.from(`riot:${creds.token}`).toString('base64')}`,
        Accept: 'application/json',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
    };
    if (isHttps) options.agent = insecureLocalAgent;

    const req = lib.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch {
          // corpo não-JSON: devolve null
        }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('timeout', () => req.destroy(connectionError('timeout')));
    req.on('error', (e) => reject(e.isConnectionError ? e : connectionError(e.code || e.message)));
    req.end(json !== undefined ? JSON.stringify(json) : undefined);
  });
}

async function lcuGetJson(creds, apiPath, opts) {
  const res = await lcuRequest(creds, apiPath, opts);
  if (res.status !== 200) {
    const err = new Error(`HTTP ${res.status} em ${apiPath.split('?')[0]}`);
    err.status = res.status;
    throw err;
  }
  return res.body;
}

module.exports = {
  discoverCredentials,
  lcuRequest,
  lcuGetJson,
  parseCommandLine,
  parseLockfile,
};
