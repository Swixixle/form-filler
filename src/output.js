// The filled form as a PDF. Two kinds:
//   - editable: the form's own page (the original PDF page itself when the form came as a PDF, or the straightened
//     photo), with a fillable field over each blank holding its answer. Any PDF reader can change an answer later.
//   - print-ready: the same page with the answers written on it, nothing left to edit.
// Answers are set in Helvetica. Characters Helvetica cannot draw are swapped for the nearest plain ones.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PLAIN = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '•': '*', '✓': 'X', '✔': 'X', '☑': 'X', ' ': ' ' };
export const plain = text => String(text ?? '').replace(/[^\x20-\x7e\xa0-\xff]/g, char => PLAIN[char] ?? '?');

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

// pages: [{ width, height (pixels of the picture the blanks were found on), image: { bytes, type } | null,
//          pdfPage: index in `sourcePdf` | null }]; blanks: [{ page, kind, x0, y0, x1, y1 }]; values: one per blank.
export async function buildPdf({ pages, blanks, values, sourcePdf, editable, note }) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), source = sourcePdf ? await PDFDocument.load(sourcePdf, { ignoreEncryption: true }) : null;
  const form = editable ? doc.getForm() : null;
  const out = [];
  for (const [index, page] of pages.entries()) {
    let pdfPage;
    if (source && page.pdfPage !== null && page.pdfPage !== undefined) { [pdfPage] = await doc.copyPages(source, [page.pdfPage]); doc.addPage(pdfPage); }
    else {
      const width = 612, height = 612 * page.height / page.width;
      pdfPage = doc.addPage([width, height]);
      const image = page.image.type === 'png' ? await doc.embedPng(page.image.bytes) : await doc.embedJpg(page.image.bytes);
      pdfPage.drawImage(image, { x: 0, y: 0, width, height });
    }
    out[index] = pdfPage;
  }
  blanks.forEach((blank, index) => {
    const pdfPage = out[blank.page], { width, height } = pdfPage.getSize(), sx = width / pages[blank.page].width, sy = height / pages[blank.page].height;
    const box = { x: blank.x0 * sx, y: height - blank.y1 * sy, width: (blank.x1 - blank.x0) * sx, height: (blank.y1 - blank.y0) * sy };
    const value = values[index];
    if (blank.kind === 'check') {
      if (editable) { const field = form.createCheckBox('blank-' + (index + 1)); field.addToPage(pdfPage, { ...box, borderWidth: 0 }); if (value) field.check(); }
      else if (value) { const size = Math.min(box.width, box.height) * 0.9; pdfPage.drawText('X', { x: box.x + (box.width - font.widthOfTextAtSize('X', size)) / 2, y: box.y + box.height * 0.18, size, font, color: rgb(0, 0, 0) }); }
      return;
    }
    const text = plain(value);
    // A tall box (comments, a description) takes several lines, written from its top; a one-line blank, one line.
    const tall = box.height > 40, size = tall ? 11 : fitSize(font, text, box.width, box.height);
    if (editable) {
      const field = form.createTextField('blank-' + (index + 1));
      if (tall) field.enableMultiline();
      field.setText(text); field.addToPage(pdfPage, { ...box, borderWidth: 0, font }); field.setFontSize(size);
    } else if (text) {
      const lines = tall ? wrap(font, text, size, box.width - 6) : [text];
      lines.forEach((line, row) => { const y = tall ? box.y + box.height - 4 - size * 1.25 * (row + 1) : box.y + Math.max(2, (box.height - size) / 2); if (y >= box.y) pdfPage.drawText(line, { x: box.x + 3, y, size, font, color: rgb(0.05, 0.1, 0.35) }); });
    }
  });
  if (editable) form.updateFieldAppearances(font);
  doc.setTitle('Filled form'); doc.setProducer('Form Filler'); doc.setCreator('Form Filler');
  if (note) doc.setSubject(note);
  return doc.save();
}
