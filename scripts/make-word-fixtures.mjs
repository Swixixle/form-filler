// Reads the invented test pages with the text reader and settings the page uses (Tesseract, LSTM, automatic page
// layout) and writes every word it returns, with its box, its confidence and its letters, to tests/fixtures/*-words.json:
// what the page hands labelBlanks (src/app/main.js, wordsOf). The tests can then check blank labels without running
// the reader. Run it again whenever a fixture page changes.
//   node scripts/make-word-fixtures.mjs
//
// Where these words differ from the browser's: the page straightens a crooked photo by turning its canvas, and this
// script turns the pixels with the library's rotate(), so form-photo's pixels, and some of its words, differ a little
// from what either browser reads. scripts/walk.cjs checks the labels the page itself finds, in WebKit and Chromium.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { skewOf, rotate } from '../src/lib/blanks.js';

const require = createRequire(import.meta.url), here = name => fileURLToPath(new URL('../tests/fixtures/' + name, import.meta.url));
const { createWorker } = require('tesseract.js');
const langPath = fileURLToPath(new URL('../node_modules/@tesseract.js-data/eng/4.0.0_best_int', import.meta.url));
const PAGES = ['form.png', 'form-photo.png', 'form-webkit.png', 'checkboxes.png', 'tight-table.png'];
const box = bbox => ({ x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1 }), sure = confidence => Math.round(confidence * 100) / 100;

const worker = await createWorker('eng', 1, { langPath, gzip: true, cacheMethod: 'none' });
try {
  await worker.setParameters({ tessedit_pageseg_mode: '3' });
  for (const name of PAGES) {
    const png = PNG.sync.read(readFileSync(here(name))), { width, height } = png;
    let gray = new Uint8Array(width * height);
    for (let at = 0; at < gray.length; at++) gray[at] = Math.round(0.299 * png.data[at * 4] + 0.587 * png.data[at * 4 + 1] + 0.114 * png.data[at * 4 + 2]);
    const angle = skewOf(gray, width, height);
    if (Math.abs(angle) >= 0.2) gray = rotate(gray, width, height, angle);
    const page = new PNG({ width, height, colorType: 0, inputColorType: 0, bitDepth: 8 }); page.data = Buffer.from(gray);
    const { data } = await worker.recognize(PNG.sync.write(page, { colorType: 0, inputColorType: 0 }), {}, { blocks: true, text: false });
    // The same fields as the page's wordsOf, every word kept: the page filters by confidence itself.
    const words = (data.blocks || []).flatMap(block => block.paragraphs || []).flatMap(paragraph => paragraph.lines || []).flatMap(line => line.words || [])
      .map(word => ({ text: word.text, confidence: sure(word.confidence), bbox: box(word.bbox), symbols: (word.symbols || []).map(symbol => ({ text: symbol.text, confidence: sure(symbol.confidence), bbox: box(symbol.bbox) })) }));
    const out = name.replace(/\.png$/, '-words.json');
    // One word to a line, so a change to the reader's words shows as a small diff.
    writeFileSync(here(out), '{"page": ' + JSON.stringify(name) + ', "width": ' + width + ', "height": ' + height + ', "angle": ' + angle + ', "words": [\n' + words.map(word => JSON.stringify(word)).join(',\n') + '\n]}\n');
    console.log(out + ': ' + words.length + ' words (' + words.filter(word => word.confidence > 50).length + ' over 50%)' + (angle ? ', straightened ' + angle + '°' : ''));
  }
} finally { await worker.terminate(); }
