const fs = require('fs');
const path = require('path');

const MAX_BYTES = 200 * 1024;

/** Log simples em arquivo (userData/overlay.log), cortado em 200 KB, para diagnosticar problemas no PC do usuário. */
function createLogger(file) {
  let size = 0;
  try {
    size = fs.statSync(file).size;
    if (size > MAX_BYTES) {
      fs.renameSync(file, `${file}.old`);
      size = 0;
    }
  } catch {
    // arquivo ainda não existe
  }
  return {
    file,
    log(msg) {
      const line = `${new Date().toISOString()} ${msg}\n`;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, line);
        size += line.length;
      } catch {
        // sem escrita: ignora
      }
    },
  };
}

module.exports = { createLogger };
