const http = require('http');
const https = require('https');

// A Live Client API usa certificado autoassinado da Riot, então a verificação
// TLS é desligada SOMENTE para endereços de loopback (nunca para a internet).
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const insecureLocalAgent = new https.Agent({ rejectUnauthorized: false });

function connectionError(message) {
  const err = new Error(message);
  err.isConnectionError = true;
  return err;
}

function getJson(urlString, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    if (!LOOPBACK.has(url.hostname)) {
      return reject(connectionError(`host não permitido: ${url.hostname}`));
    }
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const options = { timeout: timeoutMs };
    if (isHttps) options.agent = insecureLocalAgent;

    const req = lib.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(connectionError(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(connectionError('JSON inválido'));
        }
      });
    });
    req.on('timeout', () => req.destroy(connectionError('timeout')));
    req.on('error', (e) => reject(e.isConnectionError ? e : connectionError(e.code || e.message)));
  });
}

function fetchAllGameData(baseUrl) {
  return getJson(`${baseUrl}/liveclientdata/allgamedata`);
}

module.exports = { fetchAllGameData, getJson };
