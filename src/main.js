import './style.css';
import { findBlanks, skewOf, order, labelFor } from './blanks.js';
import { placeAnswers } from './answers.js';
import { buildPdf } from './output.js';

const app = document.getElementById('app');
const asset = path => new URL(import.meta.env.BASE_URL + path, window.location.href).href;
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const sha256 = async data => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data));
const MAX_PAGES = 10, WIDTH = 1700;

let form = null;          // { name, bytes, hash, pdf: bool, pages: [{ canvas, width, height, pdfPage, angle }] }
let blanks = [];          // [{ id, page, kind, x0, y0, x1, y1, label }]
let answers = '', overrides = {}, busy = '', note = '', adding = false, prints = {};
let nextId = 1;

const placed = () => placeAnswers(blanks, answers);
const valueOf = (blank, index, values) => blank.id in overrides ? overrides[blank.id] : values[index];

async function reader() {
  const { createWorker } = await import('tesseract.js');
  return createWorker('eng', 1, { workerPath: asset('ocr/worker.min.js'), corePath: asset('ocr'), langPath: asset('ocr'), workerBlobURL: false, cacheMethod: 'none' });
}
const grayOf = canvas => { const { width, height } = canvas, data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data, gray = new Uint8Array(width * height);
  for (let at = 0; at < gray.length; at++) gray[at] = (data[at * 4] * 299 + data[at * 4 + 1] * 587 + data[at * 4 + 2] * 114) / 1000; return gray; };

// The form, as pictures of its pages: a PDF page drawn, or a photo turned upright, shrunk to a working size and
// straightened if it was taken a little crooked.
async function pagesOf(file, bytes) {
  if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    const pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise, pages = [];
    for (let number = 1; number <= Math.min(pdf.numPages, MAX_PAGES); number++) {
      const page = await pdf.getPage(number), base = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: WIDTH / base.width });
      const canvas = document.createElement('canvas'); canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      pages.push({ canvas, width: canvas.width, height: canvas.height, pdfPage: number - 1, angle: 0 });
    }
    return { pdf: true, pages };
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => { throw new Error('That picture could not be opened here. Save it as a JPEG, PNG or PDF and try again.'); });
  const scale = Math.min(1, WIDTH / bitmap.width, 2800 / bitmap.height);
  let canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  let context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const angle = skewOf(grayOf(canvas), canvas.width, canvas.height);
  if (Math.abs(angle) >= 0.2) {
    const turned = document.createElement('canvas'); turned.width = canvas.width; turned.height = canvas.height;
    context = turned.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, turned.width, turned.height);
    context.translate(turned.width / 2, turned.height / 2); context.rotate(-angle * Math.PI / 180); context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    canvas = turned;
  }
  return { pdf: false, pages: [{ canvas, width: canvas.width, height: canvas.height, pdfPage: null, angle }] };
}

async function openForm(file) {
  busy = 'Opening the form…'; render();
  try {
    const bytes = await file.arrayBuffer(), { pdf, pages } = await pagesOf(file, bytes);
    form = { name: file.name, bytes, hash: await sha256(bytes), pdf, pages };
    blanks = []; overrides = {}; prints = {};
    const ocr = await reader();
    try {
      for (const [index, page] of pages.entries()) {
        busy = 'Finding the blanks' + (pages.length > 1 ? ' on page ' + (index + 1) + ' of ' + pages.length : '') + '…'; render();
        await ocr.setParameters({ tessedit_pageseg_mode: '3' });
        const { data } = await ocr.recognize(page.canvas, {}, { blocks: true, text: false });
        const words = (data.blocks || []).flatMap(block => block.paragraphs || []).flatMap(paragraph => paragraph.lines || []).flatMap(line => line.words || []).filter(word => word.confidence > 50);
        const heights = words.map(word => word.bbox.y1 - word.bbox.y0).sort((a, b) => a - b), textHeight = heights.length ? heights[Math.floor(heights.length / 2)] : undefined;
        // The blank finder measures by the page, not by the reader's guess at the text size: the reader's guess makes
        // letters look like checkboxes on some pages. The text size is used only to find each blank's label.
        const found = findBlanks(grayOf(page.canvas), page.width, page.height);
        for (const blank of found) blanks.push({ ...blank, id: nextId++, page: index, label: labelFor(blank, words, textHeight || 20) });
      }
    } finally { await ocr.terminate(); }
    note = blanks.length ? '' : 'No blanks were found. Add them by hand: tap “Add a blank”, then drag across each place to write.';
  } catch (error) { form = null; note = error.message || String(error); }
  busy = ''; render();
}

// Answers from a photo of a page: read with the same text reader. Printed or neatly printed handwriting reads best;
// joined-up handwriting mostly does not. What it read goes into the box to be corrected, never straight onto the form.
async function readAnswers(file) {
  busy = 'Reading your answers from the photo…'; render();
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }), canvas = document.createElement('canvas');
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height)); canvas.width = bitmap.width * scale; canvas.height = bitmap.height * scale;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const ocr = await reader();
    try { await ocr.setParameters({ tessedit_pageseg_mode: '4' }); const { data } = await ocr.recognize(canvas); answers = (answers.trim() ? answers.trim() + '\n' : '') + (data.text || '').trim(); }
    finally { await ocr.terminate(); }
    note = 'Check what was read before you use it: the reader often gets handwriting wrong.';
  } catch (error) { note = 'The photo could not be read: ' + (error.message || error); }
  busy = ''; render();
}

function reorder() {
  const unit = 20;
  blanks = form.pages.flatMap((_, page) => order(blanks.filter(blank => blank.page === page), unit).map(blank => blanks.find(item => item.id === blank.id && item.page === page) || blank));
}

function pageMarkup(page, index, values) {
  const mine = blanks.map((blank, number) => [blank, number]).filter(([blank]) => blank.page === index);
  const pct = (value, total) => (value / total * 100).toFixed(3) + '%';
  return '<section class="sheet' + (adding ? ' adding' : '') + '" data-page="' + index + '"><img alt="Page ' + (index + 1) + ' of the form" src="' + page.canvas.toDataURL('image/jpeg', 0.85) + '">' +
    mine.map(([blank, number]) => {
      const style = 'left:' + pct(blank.x0, page.width) + ';top:' + pct(blank.y0, page.height) + ';width:' + pct(blank.x1 - blank.x0, page.width) + ';height:' + pct(blank.y1 - blank.y0, page.height);
      const value = valueOf(blank, number, values), tag = '<span class="tag">' + (number + 1) + '</span>';
      return '<div class="blank ' + blank.kind + '" style="' + style + '">' + tag + (blank.kind === 'check'
        ? '<input type="checkbox" data-blank="' + blank.id + '" aria-label="Blank ' + (number + 1) + (blank.label ? ', ' + h(blank.label) : '') + '"' + (value ? ' checked' : '') + '>'
        : blank.y1 - blank.y0 > 90 ? '<textarea data-blank="' + blank.id + '" aria-label="Blank ' + (number + 1) + (blank.label ? ', ' + h(blank.label) : '') + '">' + h(value) + '</textarea>'
        : '<input data-blank="' + blank.id + '" aria-label="Blank ' + (number + 1) + (blank.label ? ', ' + h(blank.label) : '') + '" value="' + h(value) + '">') +
        (adding ? '<button type="button" class="remove" data-remove="' + blank.id + '" aria-label="Remove blank ' + (number + 1) + '">×</button>' : '') + '</div>';
    }).join('') + '</section>';
}

function render() {
  const { values, extra } = form ? placed() : { values: [], extra: [] };
  app.innerHTML = '<header class="top"><h1>Form Filler</h1><p>Photograph or open a form, write your answers anywhere as plain lines, and get the form back filled in. ' +
    '<b>Everything happens on this device.</b> Nothing is uploaded.</p></header>' +
    (busy ? '<div class="busy" role="status">' + h(busy) + '<div class="bar"><i></i></div></div>' : '') +
    (note ? '<div class="note" role="status">' + h(note) + '</div>' : '') +
    '<section class="panel"><h2>1. The form</h2><label class="pick">' + (form ? 'Use a different form' : 'Choose the form: a photo, a scan or a PDF') +
    '<input id="form-file" type="file" accept="image/*,application/pdf,.pdf"></label>' +
    (form ? '<p class="subtle">' + h(form.name) + ' · ' + form.pages.length + ' page' + (form.pages.length === 1 ? '' : 's') + ' · ' + blanks.length + ' blank' + (blanks.length === 1 ? '' : 's') + ' found' +
      (form.pages[0].angle ? ' · straightened ' + Math.abs(form.pages[0].angle) + '°' : '') + '</p>' : '') + '</section>' +
    (form ? '<section class="panel"><h2>2. Your answers</h2><p class="rules">One answer after another, in the form’s order. A <b>period</b> or a <b>new line</b> moves to the next blank. ' +
      'A lone <b>-</b> leaves a blank empty. <b>4)</b> at the start puts that answer in blank 4. For a checkbox, <b>x</b> or <b>yes</b> ticks it.</p>' +
      '<textarea id="answers" rows="8" placeholder="Jane Roe. 11/13/2026. Respiratory Care&#10;Ventilator. VNT-2219. 1">' + h(answers) + '</textarea>' +
      '<label class="pick small">Read answers from a photo of your page<input id="answers-photo" type="file" accept="image/*"></label>' +
      '<ol class="list">' + blanks.map((blank, index) => '<li><span class="label">' + h(blank.label || (blank.kind === 'check' ? 'checkbox' : 'blank')) + '</span> ' +
        (blank.kind === 'check' ? (valueOf(blank, index, values) ? '☑' : '☐') : '<b>' + h(valueOf(blank, index, values) || '—') + '</b>') + '</li>').join('') + '</ol>' +
      (extra.length ? '<p class="note">More answers than blanks. Not placed: ' + h(extra.join(' / ')) + '</p>' : '') + '</section>' +
      '<section class="panel"><h2>3. The filled form</h2><p class="subtle">Tap any answer on the form to change it there. Missed a blank? Add it, then drag across the place to write.</p>' +
      '<div class="tools"><button type="button" id="add-mode" class="secondary">' + (adding ? 'Done adding' : 'Add or remove a blank') + '</button></div>' +
      form.pages.map((page, index) => pageMarkup(page, index, values)).join('') +
      '<div class="tools"><button type="button" id="pdf-edit" class="primary">Download PDF you can still edit</button><button type="button" id="pdf-print" class="secondary">Download print-ready PDF</button><button type="button" id="print" class="secondary">Print</button></div>' +
      '<dl class="prints"><dt>Form</dt><dd>' + form.hash + '</dd><dt>Answers</dt><dd id="answers-print">…</dd>' + Object.entries(prints).map(([name, value]) => '<dt>' + h(name) + '</dt><dd>' + value + '</dd>').join('') + '</dl></section>' : '');
  void sha256(answers).then(print => { const slot = document.getElementById('answers-print'); if (slot) slot.textContent = print; });
}

function refreshValues() {
  const { values } = placed();
  blanks.forEach((blank, index) => {
    const input = app.querySelector('[data-blank="' + blank.id + '"]');
    if (!input || input === document.activeElement) return;
    if (input.type === 'checkbox') input.checked = Boolean(valueOf(blank, index, values)); else input.value = valueOf(blank, index, values) ?? '';
  });
  const list = app.querySelector('.list');
  if (list) list.innerHTML = blanks.map((blank, index) => '<li><span class="label">' + h(blank.label || (blank.kind === 'check' ? 'checkbox' : 'blank')) + '</span> ' +
    (blank.kind === 'check' ? (valueOf(blank, index, values) ? '☑' : '☐') : '<b>' + h(valueOf(blank, index, values) || '—') + '</b>') + '</li>').join('');
  void sha256(answers).then(print => { const slot = document.getElementById('answers-print'); if (slot) slot.textContent = print; });
}

async function download(editable) {
  busy = 'Making the PDF…'; render();
  try {
    const { values } = placed(), finals = blanks.map((blank, index) => valueOf(blank, index, values));
    const pages = await Promise.all(form.pages.map(async page => ({ width: page.width, height: page.height, pdfPage: form.pdf ? page.pdfPage : null,
      image: form.pdf ? null : { type: 'jpg', bytes: new Uint8Array(await (await new Promise(resolve => page.canvas.toBlob(resolve, 'image/jpeg', 0.9))).arrayBuffer()) } })));
    const bytes = await buildPdf({ pages, blanks, values: finals, sourcePdf: form.pdf ? form.bytes : null, editable, note: 'Filled with Form Filler. Form SHA-256 ' + form.hash + '. Answers SHA-256 ' + await sha256(answers) + '.' });
    const name = form.name.replace(/\.[^.]+$/, '') + (editable ? ' - filled.pdf' : ' - filled, print-ready.pdf');
    prints[editable ? 'Editable PDF' : 'Print-ready PDF'] = await sha256(bytes);
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); link.download = name; document.body.append(link); link.click();
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 4000);
  } catch (error) { note = 'The PDF could not be made: ' + (error.message || error); }
  busy = ''; render();
}

app.addEventListener('change', event => {
  const target = event.target;
  if (target.id === 'form-file' && target.files[0]) void openForm(target.files[0]);
  if (target.id === 'answers-photo' && target.files[0]) void readAnswers(target.files[0]);
  if (target.dataset.blank && target.type === 'checkbox') { overrides[target.dataset.blank] = target.checked; refreshValues(); }
});
app.addEventListener('input', event => {
  const target = event.target;
  if (target.id === 'answers') { answers = target.value; refreshValues(); }
  if (target.dataset.blank && target.type !== 'checkbox') { overrides[target.dataset.blank] = target.value; refreshValues(); }
});
app.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.id === 'add-mode') { adding = !adding; render(); }
  if (target.dataset.remove) { blanks = blanks.filter(blank => String(blank.id) !== target.dataset.remove); render(); }
  if (target.id === 'pdf-edit') void download(true);
  if (target.id === 'pdf-print') void download(false);
  if (target.id === 'print') window.print();
});
// Adding a blank: drag across the place to write, on the page itself.
let drag = null;
app.addEventListener('pointerdown', event => {
  const sheet = event.target.closest('.sheet.adding');
  if (!sheet || event.target.closest('.blank')) return;
  const rect = sheet.getBoundingClientRect(), box = document.createElement('div');
  box.className = 'drawing'; sheet.append(box);
  drag = { sheet, rect, box, x: event.clientX - rect.left, y: event.clientY - rect.top };
  sheet.setPointerCapture(event.pointerId); event.preventDefault();
});
app.addEventListener('pointermove', event => {
  if (!drag) return;
  const x = event.clientX - drag.rect.left, y = event.clientY - drag.rect.top;
  Object.assign(drag.box.style, { left: Math.min(x, drag.x) + 'px', top: Math.min(y, drag.y) + 'px', width: Math.abs(x - drag.x) + 'px', height: Math.abs(y - drag.y) + 'px' });
});
app.addEventListener('pointerup', event => {
  if (!drag) return;
  const { sheet, rect, x, y } = drag, page = form.pages[Number(sheet.dataset.page)], sx = page.width / rect.width, sy = page.height / rect.height;
  const x1 = event.clientX - rect.left, y1 = event.clientY - rect.top;
  drag.box.remove(); drag = null;
  if (Math.abs(x1 - x) < 8 || Math.abs(y1 - y) < 6) return;
  const blank = { id: nextId++, page: Number(sheet.dataset.page), kind: Math.abs(x1 - x) < 40 && Math.abs(y1 - y) < 40 ? 'check' : 'box', x0: Math.min(x, x1) * sx, y0: Math.min(y, y1) * sy, x1: Math.max(x, x1) * sx, y1: Math.max(y, y1) * sy, label: 'added by hand' };
  blanks.push(blank); reorder(); render();
});

render();
