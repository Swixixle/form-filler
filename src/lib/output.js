// The filled form as a PDF. Two kinds:
//   - editable: the form's own page (the original PDF page itself when the form came as a PDF, or the straightened
//     photo), with a fillable field over each blank holding its answer. Any PDF reader can change an answer later.
//     When the PDF had its own fields, those very fields are filled: nothing is laid over them.
//   - print-ready: the same page with the answers written on it, nothing left to edit.
// Answers are set in Helvetica. Characters Helvetica cannot draw are swapped for the nearest plain ones.
// A signature is a picture (PNG) placed in its blank, kept to its own shape.
import { PDFDocument, PDFName, PDFRef, StandardFonts, rgb, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } from 'pdf-lib';
import { pickOption } from './fields.js';

const PLAIN = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '•': '*', '✓': 'X', '✔': 'X', '☑': 'X', ' ': ' ' };
export const plain = text => String(text ?? '').replace(/[^\x20-\x7e\xa0-\xff\n]/g, char => PLAIN[char] ?? '?');
const INK = rgb(0.05, 0.1, 0.35);

// The largest size, up to 14 pt, at which the answer fits its blank's width and height.
export function fitSize(font, text, width, height) {
  let size = Math.min(14, height * 0.75);
  while (size > 5 && font.widthOfTextAtSize(text, size) > width - 4) size -= 0.5;
  return size;
}

export function wrap(font, text, size, width) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) { const next = line ? line + ' ' + word : word; if (font.widthOfTextAtSize(next, size) <= width || !line) line = next; else { lines.push(line); line = word; } }
    lines.push(line);
  }
  return lines;
}

// A signature value: { signature: 'data:image/png;base64,…' } or { signature: Uint8Array of a PNG }.
export const isSignature = value => Boolean(value && typeof value === 'object' && value.signature);
const pngBytes = value => typeof value.signature === 'string' ? Uint8Array.from(atob(value.signature.replace(/^data:[^,]*,/, '')), char => char.charCodeAt(0)) : value.signature;
const textOf = value => isSignature(value) ? '' : value === true ? 'X' : value === false ? '' : plain(value);

// Where a blank (in the pixels of the page picture it was found on) is on the PDF page, in points from the bottom left.
function boxOn(pdfPage, picture, blank) {
  const view = pdfPage.getCropBox(), sx = view.width / picture.width, sy = view.height / picture.height;
  return { x: view.x + blank.x0 * sx, y: view.y + view.height - blank.y1 * sy, width: (blank.x1 - blank.x0) * sx, height: (blank.y1 - blank.y0) * sy };
}

async function drawSignature(doc, pdfPage, box, value) {
  const image = await doc.embedPng(pngBytes(value)), fit = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * fit, height = image.height * fit;
  pdfPage.drawImage(image, { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height });
}

// One blank that is not one of the PDF's own fields: a field laid over it (editable) or its answer drawn (print-ready).
function placeBlank({ doc, form, font, pdfPage, box, blank, value, editable, name }) {
  if (blank.kind === 'check') {
    if (editable) { const field = form.createCheckBox(name); field.addToPage(pdfPage, { ...box, borderWidth: 0 }); if (value) field.check(); }
    else if (value) { const size = Math.min(box.width, box.height) * 0.9; pdfPage.drawText('X', { x: box.x + (box.width - font.widthOfTextAtSize('X', size)) / 2, y: box.y + box.height * 0.18, size, font, color: rgb(0, 0, 0) }); }
    return;
  }
  const text = textOf(value);
  // A tall box (comments, a description) takes several lines, written from its top; a one-line blank, one line.
  const tall = box.height > 40, size = tall ? 11 : fitSize(font, text, box.width, box.height);
  if (editable) {
    const field = form.createTextField(name);
    if (tall) field.enableMultiline();
    field.setText(text); field.addToPage(pdfPage, { ...box, borderWidth: 0, font }); field.setFontSize(size);
  } else if (text) {
    const lines = tall ? wrap(font, text, size, box.width - 6) : [text];
    lines.forEach((line, row) => { const y = tall ? box.y + box.height - 4 - size * 1.25 * (row + 1) : box.y + Math.max(2, (box.height - size) / 2); if (y >= box.y) pdfPage.drawText(line, { x: box.x + 3, y, size, font, color: INK }); });
  }
  void doc;
}

// One of the PDF's own fields, filled. Anything that cannot go in (an option the form does not offer, an answer longer
// than the field allows) is reported in `problems`, never dropped without a word.
function fillField(form, blank, value, problems, number) {
  let field;
  try { field = form.getField(blank.field); } catch { problems.push('Blank ' + number + ': the form has no field "' + blank.field + '" any more.'); return; }
  if (field instanceof PDFCheckBox) { if (value === true || (typeof value === 'string' && /^(?:x|yes|y|true|on|1|✓)$/i.test(value.trim()))) field.check(); else field.uncheck(); return; }
  if (field instanceof PDFRadioGroup || field instanceof PDFDropdown || field instanceof PDFOptionList) {
    const text = textOf(value);
    if (!text) { if (!(field instanceof PDFRadioGroup)) field.clear(); return; }
    const option = pickOption(field.getOptions(), text);
    if (option) { field.select(option); return; }
    if (field instanceof PDFDropdown && field.isEditable()) { field.select(text); return; }
    problems.push('Blank ' + number + ' (' + blank.label + '): "' + text + '" is not one of its choices (' + field.getOptions().join(', ') + ').');
    return;
  }
  if (field instanceof PDFTextField) {
    let text = textOf(value);
    if (!field.isMultiline()) text = text.replace(/\n+/g, ' ');
    const max = field.getMaxLength();
    if (max !== undefined && text.length > max) { problems.push('Blank ' + number + ' (' + blank.label + '): cut to ' + max + ' characters, the most the form allows.'); text = text.slice(0, max); }
    field.setText(text);
  }
}

// pdf-lib's flatten can leave a page pointing at widgets it removed (radio buttons made as a group's children, for
// one), which some readers report as a broken file. Those pointers are taken out.
function dropDangling(doc) {
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!annots?.asArray) continue;
    const kept = annots.asArray().filter(item => !(item instanceof PDFRef) || doc.context.lookup(item) !== undefined);
    if (kept.length === annots.size()) continue;
    if (kept.length) page.node.set(PDFName.of('Annots'), doc.context.obj(kept)); else page.node.delete(PDFName.of('Annots'));
  }
}

// pages: [{ width, height (pixels of the picture the blanks were found on), image: { bytes, type } | null,
//          pdfPage: index in `sourcePdf` | null }]; blanks: [{ page, kind, x0, y0, x1, y1, field? }]; values: one per blank.
// `problems`, when given, collects what could not be filled as asked.
export async function buildPdf({ pages, blanks, values, sourcePdf, editable, note, problems = [] }) {
  const source = sourcePdf ? await PDFDocument.load(sourcePdf, { ignoreEncryption: true }) : null;
  // The PDF's own fields are filled in the PDF itself. Every page of it is kept, in its own order.
  const ownFields = Boolean(source && !source.isEncrypted && blanks.some(blank => blank.field));
  const doc = ownFields ? source : await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  const form = editable || ownFields ? doc.getForm() : null;
  if (ownFields && form.hasXFA()) form.deleteXFA();   // the PDF's second, XFA copy of the form would otherwise hide what was filled
  const out = [];
  for (const [index, page] of pages.entries()) {
    if (ownFields) { out[index] = doc.getPage(page.pdfPage); continue; }
    let pdfPage;
    if (source && !source.isEncrypted && page.pdfPage !== null && page.pdfPage !== undefined) { [pdfPage] = await doc.copyPages(source, [page.pdfPage]); doc.addPage(pdfPage); }
    else {
      // A photo, or a locked PDF whose pages cannot be copied: the page picture itself.
      const width = 612, height = 612 * page.height / page.width;
      pdfPage = doc.addPage([width, height]);
      const image = page.image.type === 'png' ? await doc.embedPng(page.image.bytes) : await doc.embedJpg(page.image.bytes);
      pdfPage.drawImage(image, { x: 0, y: 0, width, height });
    }
    out[index] = pdfPage;
  }
  const taken = new Set(form ? form.getFields().map(field => field.getName()) : []), nameFor = index => { let name = 'blank-' + (index + 1); while (taken.has(name)) name += '-'; taken.add(name); return name; };
  for (const [index, blank] of blanks.entries()) {
    const pdfPage = out[blank.page], box = boxOn(pdfPage, pages[blank.page], blank), value = values[index];
    if (isSignature(value)) { await drawSignature(doc, pdfPage, box, value); continue; }
    if (ownFields && blank.field) { fillField(form, blank, value, problems, index + 1); continue; }
    placeBlank({ doc, form, font, pdfPage, box, blank, value, editable, name: nameFor(index) });
  }
  if (form) form.updateFieldAppearances(font);
  if (ownFields && !editable) { form.flatten(); dropDangling(doc); }
  doc.setTitle('Filled form'); doc.setProducer('Form Filler'); doc.setCreator('Form Filler');
  if (note) doc.setSubject(note);
  return doc.save();
}

// Several filled copies of one form, one after another in a single PDF (a mail merge). Each copy is made print-ready
// first, so the copies' fields cannot clash.
export async function joinPdfs(list) {
  const doc = await PDFDocument.create();
  for (const bytes of list) { const part = await PDFDocument.load(bytes); for (const page of await doc.copyPages(part, part.getPageIndices())) doc.addPage(page); }
  doc.setTitle('Filled forms'); doc.setProducer('Form Filler'); doc.setCreator('Form Filler');
  return doc.save();
}
