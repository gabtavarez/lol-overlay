// Gera "LoL Overlay Setup <versão>.exe" com makensis (funciona em Linux, macOS e Windows, sem wine).
// Uso: npm run dist:setup
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

function findNsisDir() {
  const bases = [
    path.join(os.homedir(), '.cache', 'electron-builder'),
    path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache'),
    path.join(os.homedir(), 'Library', 'Caches', 'electron-builder'),
  ];
  for (const base of bases) {
    const nsisRoot = path.join(base, 'nsis');
    const alt = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith('nsis-') && !d.startsWith('nsis-resources')) : [];
    for (const d of [...alt.map((x) => path.join(base, x)), nsisRoot]) {
      if (!fs.existsSync(d)) continue;
      for (const sub of fs.readdirSync(d)) {
        const dir = path.join(d, sub);
        if (fs.existsSync(path.join(dir, 'Include', 'MUI2.nsh'))) return dir;
      }
    }
  }
  return null;
}

function findMakensis(nsisDir) {
  if (process.env.MAKENSIS) return process.env.MAKENSIS;
  if (nsisDir) {
    const rel = process.platform === 'win32' ? ['Bin', 'makensis.exe'] : [process.platform === 'darwin' ? 'mac' : 'linux', 'makensis'];
    const p = path.join(nsisDir, ...rel);
    if (fs.existsSync(p)) return p;
  }
  return 'makensis';
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32', ...opts });
}

// 1) empacota o app (pasta win-unpacked); no Windows aplica o ícone no .exe
const winEdit = process.platform === 'win32' ? 'true' : 'false';
run('npx', ['electron-builder', '--win', 'dir', `-c.win.signAndEditExecutable=${winEdit}`, '-c.win.target=dir']);

// 2) monta o instalador
const nsisDir = findNsisDir();
const out = path.join(root, 'dist', `LoL Overlay Setup ${pkg.version}.exe`);
const env = { ...process.env, ...(nsisDir ? { NSISDIR: nsisDir } : {}) };
run(findMakensis(nsisDir), [
  `-DVERSION=${pkg.version}`,
  `-DSRC=${path.join(root, 'dist', 'win-unpacked')}`,
  `-DOUT=${out}`,
  `-DICON=${path.join(root, 'build', 'icon.ico')}`,
  path.join(root, 'scripts', 'installer.nsi'),
], { env });
console.log(`\nInstalador pronto: ${out}`);
