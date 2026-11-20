// Reads the header cells of the invented table pages as the page does (src/lib/headers.js: each cell on its own, as
// it is and enlarged twofold, Tesseract's page segmentation mode 6) and writes every read, in the order headerLabels
// asks for them, to tests/fixtures/*-headers.json. The tests can then check the table labels without the reader.
// Run it after scripts/make-word-fixtures.mjs, and again whenever a fixture page or the header cells change.
//   node scripts/make-header-fixtures.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { skewOf, rotate, findBlanks, labelBlanks } from '../src/lib/blanks.js';
import { headerLabels } from '../src/lib/headers.js';

const require = createRequire(import.meta.url), here = name => fileURLToPath(new URL('../tests/fixtures/' + name, import.meta.url));
const { createWorker } = require('tesseract.js');
const langPath = fileURLToPath(new URL('../node_modules/@tesseract.js-data/eng/4.0.0_best_int', import.meta.url));
const PAGES = ['form.png', 'form-photo.png', 'form-webkit.png', 'tight-table.png'];
const sure = confidence => Math.round(confidence * 100) / 100;
const pngOf = (gray, width, height) => { const png = new PNG({ width, height, colorType: 0, inputColorType: 0, bitDepth: 8 }); png.data = Buffer.from(gray); return PNG.sync.write(png, { colorType: 0, inputColorType: 0 }); };

const worker = await createWorker('eng', 1, { langPath, gzip: true, cacheMethod: 'none' });
try {
  await worker.setParameters({ tessedit_pageseg_mode: '6' });
  for (const name of PAGES) {
    const png = PNG.sync.read(readFileSync(here(name))), { width, height } = png;
    let gray = new Uint8Array(width * height);
    for (let at = 0; at < gray.length; at++) gray[at] = Math.round(0.299 * png.data[at * 4] + 0.587 * png.data[at * 4 + 1] + 0.114 * png.data[at * 4 + 2]);
    const angle = skewOf(gray, width, height);
    if (Math.abs(angle) >= 0.2) gray = rotate(gray, width, height, angle);
    // The page's words for the page (scripts/make-word-fixtures.mjs), and its text size from them, as the page has them.
    const { words } = JSON.parse(readFileSync(here(name.replace(/\.png$/, '-words.json')), 'utf8'));
    const heights = words.filter(word => word.confidence > 50).map(word => word.bbox.y1 - word.bbox.y0).sort((a, b) => a - b), unit = heights.length ? heights[Math.floor(heights.length / 2)] : 20;
    const reads = [];
    await headerLabels(gray, width, height, labelBlanks(findBlanks(gray, width, height), words, unit), unit, async (pixels, w, h) => {
      const { data } = await worker.recognize(pngOf(pixels, w, h), {}, { blocks: true, text: false });
      // With the picture's size and how many of its pixels are ink, so a test can tell it is given the same picture.
      const read = { width: w, height: h, ink: pixels.reduce((count, value) => count + (value < 128 ? 1 : 0), 0), words: (data.blocks || []).flatMap(block => block.paragraphs || []).flatMap(paragraph => paragraph.lines || []).flatMap(line => line.words || []).map(word => ({ text: word.text, confidence: sure(word.confidence) })) };
      reads.push(read); return read;
    });
    const out = name.replace(/\.png$/, '-headers.json');
    // One read to a line, so a change shows as a small diff.
    writeFileSync(here(out), '{"page": ' + JSON.stringify(name) + ', "reads": [\n' + reads.map(read => JSON.stringify(read)).join(',\n') + '\n]}\n');
    console.log(out + ': ' + reads.length + ' reads: ' + reads.map(read => JSON.stringify(read.words.map(word => word.text).join(' '))).join(', '));
  }
} finally { await worker.terminate(); }
