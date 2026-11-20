// Copies the readers' runtime files next to the page, so nothing is loaded from a code CDN at run time:
//   public/ocr/  Tesseract (the printed-text reader that labels the blanks) and its English data;
//   public/ort/  ONNX Runtime's WebAssembly, which runs the handwriting model.
import { cp, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const here = process.cwd();
const core = resolve(here, 'node_modules/tesseract.js-core');
await mkdir(resolve(here, 'public/ocr'), { recursive: true });
await mkdir(resolve(here, 'public/ort'), { recursive: true });
await mkdir(resolve(here, 'public/licenses'), { recursive: true });
await cp('node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js');
for (const filename of await readdir(core)) {
  // Only the builds Tesseract.js loads for its LSTM engine (the one used here), each with its WebAssembly inside:
  // relaxed-SIMD (recent Chrome), SIMD (Safari, Firefox) and plain (older browsers).
  if (/^tesseract-core(-simd|-relaxedsimd)?-lstm\.wasm\.js$/.test(filename)) await cp(resolve(core, filename), resolve(here, 'public/ocr', filename));
}
await cp('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'public/ocr/eng.traineddata.gz');
for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) await cp('node_modules/onnxruntime-web/dist/' + name, 'public/ort/' + name);
for (const [path, name] of [
  ['node_modules/tesseract.js/LICENSE.md', 'ocr/Tesseract.js.txt'],
  ['node_modules/tesseract.js-core/LICENSE', 'ocr/Tesseract.js-core.txt'],
  ['node_modules/@tesseract.js-data/eng/LICENSE', 'ocr/Tesseract-English.txt'],
  ['node_modules/onnxruntime-web/LICENSE', 'ort/ONNX-Runtime.txt'],
  ['node_modules/@huggingface/transformers/LICENSE', 'ort/Transformers.js.txt'],
  ['node_modules/pdf-lib/LICENSE.md', 'licenses/pdf-lib.txt'],
  ['node_modules/pdfjs-dist/LICENSE', 'licenses/pdf.js.txt'],
  // The vault's encryption (age) and the cryptography it is built on, bundled into the page's vault chunk.
  ['node_modules/age-encryption/LICENSE', 'licenses/age-encryption.txt'],
  ['node_modules/@noble/ciphers/LICENSE', 'licenses/noble-ciphers.txt'],
  ['node_modules/@noble/curves/LICENSE', 'licenses/noble-curves.txt'],
  ['node_modules/@noble/hashes/LICENSE', 'licenses/noble-hashes.txt'],
  ['node_modules/@noble/post-quantum/LICENSE', 'licenses/noble-post-quantum.txt'],
  ['node_modules/@scure/base/LICENSE', 'licenses/scure-base.txt'],
]) {
  await cp(path, 'public/' + name).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
