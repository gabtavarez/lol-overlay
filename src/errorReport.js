// Relatório de erro anônimo: só envia quando o usuário ativa nas configurações.
// Vai só o tipo, a mensagem e a pilha do erro, sem caminhos do PC, nome de usuário, Riot ID ou chave do Pro.
const MAX_PER_SESSION = 20;

/** Tira do texto o que poderia identificar a pessoa (pastas do Windows, Riot ID, e-mail, chave do Pro). */
function scrub(text) {
  return String(text || '')
    .replace(/[A-Za-z]:\\Users\\[^\\\s"')]+/g, 'C:/Users/~')
    .replace(/\/(home|Users)\/[^/\s"')]+/g, '/$1/~')
    .replace(/[^\s"'()]+\.asar[\\/]/g, 'app/')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
    .replace(/LOP-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}/g, '<chave>')
    .replace(/[^\s#"']{2,16}#[A-Za-z0-9]{2,5}\b/g, '<riot-id>');
}

function createErrorReporter({ fetchImpl, server, version, platform, isEnabled, log = () => {} }) {
  const seen = new Set();
  let sent = 0;
  return {
    /** kind: 'main' | 'renderer' | 'overlay' | 'promise'. Sem efeito se o usuário não ativou. */
    report(kind, err) {
      try {
        if (!isEnabled() || sent >= MAX_PER_SESSION) return false;
        const message = scrub(err && err.message ? err.message : String(err)).slice(0, 500);
        const stack = scrub(err && err.stack ? err.stack : '').slice(0, 4000);
        const key = `${kind}|${message}`;
        if (!message || seen.has(key)) return false;
        seen.add(key);
        sent += 1;
        fetchImpl(`${server}/report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, message, stack, version, platform }),
        }).catch((e) => log(`relatório de erro não enviado: ${e.message}`));
        return true;
      } catch {
        return false;
      }
    },
  };
}

module.exports = { createErrorReporter, scrub };
