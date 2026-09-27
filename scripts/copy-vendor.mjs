// Copies the OCR and PDF runtimes out of node_modules into public/vendor so they are
// served from our own origin. Nothing is fetched from a CDN at runtime: tesseract.js
// defaults to jsDelivr for its worker, core and language data, and every one of those
// defaults is overridden in src/lib/ocr.ts to point here instead.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const out = join(root, 'public', 'vendor');

const pkgDir = (name, from) =>
  dirname(createRequire(from ?? join(root, 'package.json')).resolve(`${name}/package.json`));

const tesseractDir = pkgDir('tesseract.js');
// The core is tesseract.js's own dependency, resolved from inside it, so the worker and
// the wasm can never be of mismatched versions.
const coreDir = pkgDir('tesseract.js-core', join(tesseractDir, 'package.json'));
const pdfjsDir = pkgDir('pdfjs-dist');

const stamp = JSON.stringify({
  tesseract: require(join(tesseractDir, 'package.json')).version,
  core: require(join(coreDir, 'package.json')).version,
  pdfjs: require(join(pdfjsDir, 'package.json')).version,
});
const stampFile = join(out, '.stamp');
if (existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) {
  console.log('vendor: up to date');
  process.exit(0);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'tesseract', 'core'), { recursive: true });
mkdirSync(join(out, 'tesseract', 'lang'), { recursive: true });

cpSync(join(tesseractDir, 'dist', 'worker.min.js'), join(out, 'tesseract', 'worker.min.js'));
// LSTM-only builds: we run OEM 1 with the best_int models, so the legacy engine is dead
// weight. The worker picks one of these three at runtime from wasm feature detection.
for (const f of [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
]) {
  cpSync(join(coreDir, f), join(out, 'tesseract', 'core', f));
}
for (const lang of ['eng', 'lav']) {
  const dir = pkgDir(`@tesseract.js-data/${lang}`);
  cpSync(
    join(dir, '4.0.0_best_int', `${lang}.traineddata.gz`),
    join(out, 'tesseract', 'lang', `${lang}.traineddata.gz`),
  );
}

// pdf.js: standard fonts (text-layer PDFs that use the base-14 fonts), the wasm image
// decoders (JBIG2 and JPEG 2000 are what scanners emit), CMaps and ICC profiles.
for (const d of ['standard_fonts', 'wasm', 'cmaps', 'iccs']) {
  cpSync(join(pdfjsDir, d), join(out, 'pdfjs', d), { recursive: true });
}

writeFileSync(stampFile, stamp);
console.log('vendor: copied', stamp);
