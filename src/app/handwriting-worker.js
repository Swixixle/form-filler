// Reads one line of handwriting at a time with TrOCR, in this worker so the page stays usable. The model comes from
// Hugging Face at a pinned revision the first time and is then kept by the browser; the runtime (ONNX Runtime's
// WebAssembly) is served with the page itself, so nothing is fetched from a code CDN. Only pictures of lines come in
// here, and only text goes back out.
import { pipeline, env, RawImage } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;
// The page says where its own files are (`base`), since a worker's address differs between a build and development.
let runtimeSet = false;
// Always replaced: on import, Transformers.js points the runtime at a CDN (jsDelivr) by default.
const runtimeAt = base => { if (runtimeSet) return; runtimeSet = true; env.backends.onnx.wasm.wasmPaths = { mjs: new URL('ort/ort-wasm-simd-threaded.mjs', base).href, wasm: new URL('ort/ort-wasm-simd-threaded.wasm', base).href }; };

const readers = new Map();
const readerFor = model => {
  if (!readers.has(model.id)) readers.set(model.id, pipeline('image-to-text', model.id, { revision: model.revision, dtype: 'q8', device: 'wasm',
    progress_callback: item => { if (item.status === 'progress') self.postMessage({ type: 'progress', file: item.file, loaded: item.loaded, total: item.total }); } }));
  return readers.get(model.id);
};

self.onmessage = async ({ data }) => {
  if (data.type !== 'read') return;
  try {
    runtimeAt(data.base);
    const read = await readerFor(data.model);
    const image = new RawImage(new Uint8ClampedArray(data.data), data.width, data.height, 4).rgb();
    const [result] = await read(image, { max_new_tokens: 64 });
    self.postMessage({ type: 'read', index: data.index, text: (result?.generated_text || '').trim() });
  } catch (error) { self.postMessage({ type: 'error', message: error.message || String(error) }); }
};
