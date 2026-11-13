// The blanks a PDF already declares: its own fill-in fields (an AcroForm). When a PDF has them, they are the blanks,
// exactly, with the names the form's maker gave them; nothing has to be found from pixels.
//
// Positions come back in the same pixels the page is drawn at (`scale` pixels per PDF point, measured from the top
// left of the page's visible box), so a field blank sits exactly where a found blank would.
//
// Kinds: 'box' (a text field; `multiline` when the form allows several lines), 'check' (a checkbox), 'choice' (a radio
// group, a drop-down or a list; `options` holds what may be chosen) and 'sign' (a signature field). Push buttons are
// not blanks. A field that shows in several places is one blank, at its first place on the earliest page; a radio
// group's blank covers all its buttons on that page.
import { PDFDocument, PDFName, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, PDFSignature } from 'pdf-lib';

const tooltip = field => { const value = field.acroField.dict.get(PDFName.of('TU')); return value?.decodeText ? value.decodeText().trim() : ''; };
// "topmostSubform[0].Page1[0].f1_02[0]" or "first_name" as words a person can read.
export const readableName = name => String(name).split('.').pop().replace(/\[\d+\]$/, '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();

export async function readFields(bytes, { scale = 1 } = {}) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const result = { encrypted: doc.isEncrypted, xfa: false, rotated: false, blanks: [] };
  let form;
  try { form = doc.getForm(); } catch { return result; }
  result.xfa = form.hasXFA();
  const pages = doc.getPages(), pageOf = new Map(pages.map((page, index) => [page.ref.toString(), index]));
  for (const field of form.getFields()) {
    const kind = field instanceof PDFTextField ? 'box' : field instanceof PDFCheckBox ? 'check'
      : field instanceof PDFRadioGroup || field instanceof PDFDropdown || field instanceof PDFOptionList ? 'choice' : field instanceof PDFSignature ? 'sign' : null;
    if (!kind) continue;
    const places = field.acroField.getWidgets().map(widget => {
      const ref = widget.P()?.toString(), page = ref && pageOf.has(ref) ? pageOf.get(ref) : pages.findIndex(item => item.node.Annots()?.asArray().some(annot => annot === widget.dict || doc.context.lookup(annot) === widget.dict));
      return { page, rect: widget.getRectangle() };
    }).filter(place => place.page >= 0 && place.rect.width > 0 && place.rect.height > 0).sort((a, b) => a.page - b.page || b.rect.y - a.rect.y);
    if (!places.length) continue;
    const { page } = places[0], pdfPage = pages[page];
    // A radio group is one blank covering all its buttons on that page, so the choice can be made over any of them.
    const same = kind === 'choice' && field instanceof PDFRadioGroup ? places.filter(place => place.page === page) : [places[0]];
    const x0 = Math.min(...same.map(place => place.rect.x)), y0 = Math.min(...same.map(place => place.rect.y));
    const rect = { x: x0, y: y0, width: Math.max(...same.map(place => place.rect.x + place.rect.width)) - x0, height: Math.max(...same.map(place => place.rect.y + place.rect.height)) - y0 };
    if (pdfPage.getRotation().angle % 360) result.rotated = true;
    const view = pdfPage.getCropBox(), top = view.y + view.height;
    const blank = { kind, page, field: field.getName(), label: tooltip(field) || readableName(field.getName()),
      x0: (rect.x - view.x) * scale, x1: (rect.x + rect.width - view.x) * scale, y0: (top - rect.y - rect.height) * scale, y1: (top - rect.y) * scale };
    if (kind === 'box') { blank.multiline = field.isMultiline(); const max = field.getMaxLength(); if (max) blank.maxLength = max; }
    if (kind === 'choice') { blank.options = field.getOptions(); blank.choice = field instanceof PDFRadioGroup ? 'radio' : field instanceof PDFDropdown ? 'dropdown' : 'list'; }
    if (field.isReadOnly()) continue;
    result.blanks.push(blank);
  }
  return result;
}

// The option an answer means: an exact match, then one that starts with it, then one that contains it, ignoring case.
// "y" picks "Yes"; nothing that matches picks nothing.
export function pickOption(options, answer) {
  const want = String(answer ?? '').trim().toLowerCase();
  if (!want) return null;
  return options.find(option => option.toLowerCase() === want) ?? options.find(option => option.toLowerCase().startsWith(want)) ?? options.find(option => option.toLowerCase().includes(want)) ?? null;
}

// A PDF's own fields together with blanks found from its pixels: a found blank that sits on a field is the field
// itself (its drawn underline or border), so only the found blanks the fields do not cover are kept. A signature line
// drawn on the page with no field behind it is one of those.
export function withFound(fields, found) {
  const area = box => Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0);
  const overlap = (a, b) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
  const near = (blank, field) => {
    const grown = { x0: field.x0 - 6, y0: field.y0 - 6, x1: field.x1 + 6, y1: field.y1 + 6 };
    return overlap(blank, grown) > 0.3 * Math.min(area(blank), area(field)) || overlap(blank, grown) > 0.5 * area(blank);
  };
  return [...fields, ...found.filter(blank => !fields.some(field => (field.page ?? 0) === (blank.page ?? 0) && near(blank, field)))];
}
