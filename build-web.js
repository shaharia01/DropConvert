// Copies the third-party libraries (video engine, PDF tools) from node_modules into www/lib so the app works fully offline.
const fs = require('fs'), path = require('path');
const nm = (...p) => path.join(__dirname, 'node_modules', ...p), lib = (...p) => path.join(__dirname, 'www', 'lib', ...p);
const warnings = [];
const mkdir = d => fs.mkdirSync(d, { recursive: true });
function copyFile(src, dst, label) {
  if (!fs.existsSync(src)) { warnings.push(`missing ${label || src}`); return false; }
  mkdir(path.dirname(dst)); fs.copyFileSync(src, dst); return true;
}
function copyDir(src, dst, label) {
  if (!fs.existsSync(src)) { warnings.push(`missing ${label || src}`); return false; }
  mkdir(dst);
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else if (!e.name.endsWith('.map')) fs.copyFileSync(s, d);
  }
  return true;
}
fs.rmSync(lib(), { recursive: true, force: true }); mkdir(lib());

copyFile(nm('pdfjs-dist', 'build', 'pdf.min.js'), lib('pdf.min.js'), 'pdf.js');
copyFile(nm('pdfjs-dist', 'build', 'pdf.worker.min.js'), lib('pdf.worker.min.js'), 'pdf.js worker');
copyFile(nm('pdf-lib', 'dist', 'pdf-lib.min.js'), lib('pdf-lib.min.js'), 'pdf-lib');

copyDir(nm('@ffmpeg', 'ffmpeg', 'dist', 'esm'), lib('ffmpeg', 'esm'), 'ffmpeg (module build)');
copyDir(nm('@ffmpeg', 'ffmpeg', 'dist', 'umd'), lib('ffmpeg', 'umd'), 'ffmpeg (classic build)');
copyFile(nm('@ffmpeg', 'core', 'dist', 'esm', 'ffmpeg-core.js'), lib('core', 'esm', 'ffmpeg-core.js'), 'ffmpeg core (module)');
copyFile(nm('@ffmpeg', 'core', 'dist', 'umd', 'ffmpeg-core.js'), lib('core', 'umd', 'ffmpeg-core.js'), 'ffmpeg core (classic)');
// both builds use the same engine file, so ship only one copy
if (!copyFile(nm('@ffmpeg', 'core', 'dist', 'esm', 'ffmpeg-core.wasm'), lib('core', 'ffmpeg-core.wasm')))
  copyFile(nm('@ffmpeg', 'core', 'dist', 'umd', 'ffmpeg-core.wasm'), lib('core', 'ffmpeg-core.wasm'), 'ffmpeg engine (.wasm)');

let umdWorker = null;
try { umdWorker = fs.readdirSync(lib('ffmpeg', 'umd')).find(f => /^\d+\.ffmpeg\.js$/.test(f)) || null; } catch {}
fs.writeFileSync(lib('manifest.json'), JSON.stringify({ umdWorker }));

const size = f => fs.existsSync(f) ? (fs.statSync(f).size / 1048576).toFixed(1) + ' MB' : 'MISSING';
console.log('pdf.min.js        ', size(lib('pdf.min.js')));
console.log('pdf-lib.min.js    ', size(lib('pdf-lib.min.js')));
console.log('ffmpeg-core.wasm  ', size(lib('core', 'ffmpeg-core.wasm')));
if (warnings.length) { console.log('\nWARNING - these files were not found (the matching feature may not work):'); warnings.forEach(w => console.log('  - ' + w)); }
else console.log('\nAll libraries copied.');
