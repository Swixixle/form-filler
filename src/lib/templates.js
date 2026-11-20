// A template is a form's blanks, remembered, so the same form fills at once the next time and other programs can fill
// it without finding anything. It is plain JSON:
//
//   { "formFiller": "template", "version": 1,
//     "form": { "sha256": "<hex of the form file's bytes>", "name": "loan.pdf", "type": "pdf" | "image" },
//     "pages": [{ "width": 1700, "height": 2200, "pdfPage": 0 | null, "angle": 0, "image"?: "data:image/jpeg;base64,…" }],
//     "blanks": [{ "page": 0, "kind": "line" | "box" | "check" | "choice" | "sign", "x0", "y0", "x1", "y1", "label",
//                  "field"?, "multiline"?, "maxLength"?, "options"?, "choice"?, "unsure"? }] }
//
// `unsure` (a checkbox's only, with label ""): up to three readings of the words that might be its caption, when which
// words belong to it could not be told. readTemplate drops it anywhere else.
//
// Positions are pixels of the page picture (`width` by `height`). A template for a photo can carry the straightened
// page picture itself (`image`), so a program with no way to straighten a photo can still make the PDF.
export const KINDS = ['line', 'box', 'check', 'choice', 'sign'];
const KEEP = ['page', 'kind', 'x0', 'y0', 'x1', 'y1', 'label', 'column', 'field', 'multiline', 'maxLength', 'options', 'choice', 'unsure'];

export function makeTemplate({ form, pages, blanks }) {
  return {
    formFiller: 'template', version: 1,
    form: { sha256: form.sha256, name: form.name || '', type: form.type },
    pages: pages.map(page => ({ width: page.width, height: page.height, pdfPage: page.pdfPage ?? null, angle: page.angle || 0, ...(page.image ? { image: page.image } : {}) })),
    blanks: blanks.map(blank => Object.fromEntries(KEEP.filter(key => blank[key] !== undefined && blank[key] !== null && blank[key] !== '').map(key => [key, blank[key]]))),
  };
}

// A template read back, checked field by field. Anything malformed is refused with what is wrong, so a hand-edited or
// damaged template never puts answers in the wrong places quietly.
export function readTemplate(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input, fail = message => { throw new Error('Not a usable template: ' + message + '.'); };
  if (!data || data.formFiller !== 'template') fail('it is not a Form Filler template');
  if (data.version !== 1) fail('version ' + data.version + ' is not one this program reads');
  if (!data.form || !/^[0-9a-f]{64}$/.test(data.form.sha256 || '')) fail('the form fingerprint (SHA-256) is missing');
  if (!['pdf', 'image'].includes(data.form.type)) fail('the form type must be "pdf" or "image"');
  if (!Array.isArray(data.pages) || !data.pages.length) fail('it has no pages');
  const number = (value, what) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(what + ' is not a position'); return value; };
  const pages = data.pages.map((page, index) => {
    const out = { width: number(page.width, 'page ' + (index + 1) + ' width'), height: number(page.height, 'page ' + (index + 1) + ' height'), pdfPage: page.pdfPage ?? null, angle: Number(page.angle) || 0 };
    if (out.pdfPage !== null && !Number.isInteger(out.pdfPage)) fail('page ' + (index + 1) + ' has a bad PDF page number');
    if (page.image !== undefined) { if (typeof page.image !== 'string' || !/^data:image\/(png|jpeg);base64,/.test(page.image)) fail('page ' + (index + 1) + ' has a picture that is not a PNG or JPEG'); out.image = page.image; }
    return out;
  });
  if (!Array.isArray(data.blanks)) fail('it has no list of blanks');
  const blanks = data.blanks.map((blank, index) => {
    const what = 'blank ' + (index + 1);
    if (!KINDS.includes(blank.kind)) fail(what + ' has an unknown kind "' + blank.kind + '"');
    if (!Number.isInteger(blank.page) || blank.page < 0 || blank.page >= pages.length) fail(what + ' is on a page the template does not have');
    const out = { page: blank.page, kind: blank.kind };
    for (const key of ['x0', 'y0', 'x1', 'y1']) out[key] = number(blank[key], what + ' ' + key);
    if (out.x1 <= out.x0 || out.y1 <= out.y0) fail(what + ' has no size');
    if (out.x1 > pages[blank.page].width + 1 || out.y1 > pages[blank.page].height + 1) fail(what + ' runs off its page');
    out.label = typeof blank.label === 'string' ? blank.label : '';
    // A label read from the column's header of a table (never filled with your details).
    if (blank.column === true && out.label) out.column = true;
    if (blank.field !== undefined) out.field = String(blank.field);
    if (blank.multiline) out.multiline = true;
    if (out.kind === 'check' && !out.label && Array.isArray(blank.unsure)) { const words = blank.unsure.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()).slice(0, 3); if (words.length) out.unsure = words; }
    if (Number.isInteger(blank.maxLength)) out.maxLength = blank.maxLength;
    if (blank.kind === 'choice') { if (!Array.isArray(blank.options)) fail(what + ' is a choice with no options'); out.options = blank.options.map(String); out.choice = blank.choice || 'list'; }
    return out;
  });
  return { formFiller: 'template', version: 1, form: { sha256: data.form.sha256, name: String(data.form.name || ''), type: data.form.type }, pages, blanks };
}
