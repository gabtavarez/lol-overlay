/** Normaliza nomes de campeões para comparação: "Kai'Sa" e "Kaisa" viram "kaisa". */
function norm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

module.exports = { norm, clamp };
