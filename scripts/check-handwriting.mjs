// Reads the synthetic handwritten page (tests/fixtures/handwritten.png: handwriting-style FONTS, not a person's hand)
// with the same cutting and the same pinned TrOCR model the page uses, on this computer, and prints what was read
// beside what was written. It downloads the model (about 64 MB, or 338 MB with --base) the first time.
//   node scripts/check-handwriting.mjs [--base] [image.png]
// This is a check of the plumbing and a rough number, not a measure of how well real handwriting reads.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { pipeline, RawImage } from '@huggingface/transformers';
import { segmentLines, HANDWRITING_MODELS } from '../src/lib/index.js';

const model = HANDWRITING_MODELS[process.argv.includes('--base') ? 'base' : 'small'];
const file = process.argv.slice(2).find(arg => !arg.startsWith('--')) || new URL('../tests/fixtures/handwritten.png', import.meta.url);
const WRITTEN = ['Jane Roe', '11/13/2026', 'Respiratory Care', 'Ventilator VNT 2219', 'Return by Friday'];
const png = PNG.sync.read(readFileSync(file)), { width, height } = png, gray = new Uint8Array(width * height);
for (let at = 0; at < gray.length; at++) gray[at] = Math.round(0.299 * png.data[at * 4] + 0.587 * png.data[at * 4 + 1] + 0.114 * png.data[at * 4 + 2]);
const lines = segmentLines(gray, width, height);
const read = await pipeline('image-to-text', model.id, { revision: model.revision, dtype: 'q8' });
// Edit distance, for a character error rate.
const distance = (a, b) => { const row = Array.from({ length: b.length + 1 }, (_, index) => index); for (let i = 1; i <= a.length; i++) { let prior = row[0]; row[0] = i; for (let j = 1; j <= b.length; j++) { const keep = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prior + (a[i - 1] === b[j - 1] ? 0 : 1)); prior = keep; } } return row[b.length]; };
let errors = 0, total = 0;
for (const [index, line] of lines.entries()) {
  const w = line.x1 - line.x0, h = line.y1 - line.y0, rgb = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const value = gray[(line.y0 + y) * width + line.x0 + x]; rgb.fill(value, (y * w + x) * 3, (y * w + x) * 3 + 3); }
  const [{ generated_text: text }] = await read(new RawImage(rgb, w, h, 3));
  const written = WRITTEN[index] ?? '';
  errors += distance(text.trim(), written); total += written.length;
  console.log(String(index + 1).padStart(2) + '  written: ' + written.padEnd(22) + ' read: ' + text.trim());
}
console.log(lines.length + ' lines cut (5 written). Character error rate ' + (100 * errors / Math.max(1, total)).toFixed(1) + '% with ' + model.id + '@' + model.revision.slice(0, 7) + '.');
