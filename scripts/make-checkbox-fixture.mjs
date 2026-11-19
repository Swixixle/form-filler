// Draws tests/fixtures/checkboxes.pdf and checkboxes.png: an invented flat form (no fill-in fields of its own) for
// testing which words a checkbox is labelled with. Synthetic test material: no real organisation's form. Needs
// poppler (pdftoppm) for the picture.
//   node scripts/make-checkbox-fixture.mjs
//
// Rows, top to bottom (each box is a small drawn square):
//   Caption on the right:    [ ] Yes                    the box's words are on its right
//   Caption on the left:     Yes [ ]                    ... on its left
//   Do you need a locker?    [ ] Yes   [ ] No           a pair on one line, captions on the right
//   Do you need parking?     Yes [ ]   No [ ]           a pair on one line, captions on the left
//   I agree to the house rules [ ]                      a long caption on the left
//   [ ] I have read the notice                          a long caption on the right
//   Unclear spacing:         [ ]   Maybe   [ ]          "Maybe" exactly as far from either box: neither may take it
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const here = name => fileURLToPath(new URL('../tests/fixtures/' + name, import.meta.url));
const doc = await PDFDocument.create(), page = doc.addPage([612, 792]);
const plain = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
const black = rgb(0, 0, 0), SIZE = 11, BOX = 10, GAP = 5;
const text = (words, x, y, size = SIZE, font = plain) => page.drawText(words, { x, y, size, font, color: black });
const width = words => plain.widthOfTextAtSize(words, SIZE);
// A checkbox sitting on the line of text at y, its left edge at x. Returns where it ends.
const box = (x, y) => { page.drawRectangle({ x, y: y - 1, width: BOX, height: BOX, borderWidth: 0.8, borderColor: black }); return x + BOX; };
const right = (x, y, words) => { const end = box(x, y); text(words, end + GAP, y); return end + GAP + width(words); };
const left = (x, y, words) => { text(words, x, y); return box(x + width(words) + GAP, y); };

text('Checkbox Test Sheet (invented form)', 72, 730, 16, bold);
text('Lakeside Training Center - synthetic test material, not a real form', 72, 716, 8);
text('Name:', 72, 686); page.drawLine({ start: { x: 110, y: 684 }, end: { x: 380, y: 684 }, thickness: 1, color: black });

const COLUMN = 250;
text('Caption on the right:', 72, 650); right(COLUMN, 650, 'Yes');
text('Caption on the left:', 72, 624); left(COLUMN, 624, 'Yes');
text('Do you need a locker?', 72, 598); right(COLUMN, 598, 'Yes'); right(COLUMN + 70, 598, 'No');
text('Do you need parking?', 72, 572); left(COLUMN, 572, 'Yes'); left(COLUMN + 70, 572, 'No');
left(72, 546, 'I agree to the house rules');
right(72, 520, 'I have read the notice');
// "Maybe" centred between two boxes: the same gap to each.
text('Unclear spacing:', 72, 494);
const first = box(COLUMN, 494), word = width('Maybe'), between = 22;
text('Maybe', first + between, 494); box(first + between + word + between, 494);

doc.setTitle('Checkbox Test Sheet (invented form)'); doc.setProducer('Form Filler fixtures'); doc.setCreator('Form Filler fixtures');
doc.setCreationDate(new Date('2026-11-17T12:00:00Z')); doc.setModificationDate(new Date('2026-11-17T12:00:00Z'));
writeFileSync(here('checkboxes.pdf'), await doc.save({ useObjectStreams: false }));
execFileSync('pdftoppm', ['-png', '-gray', '-scale-to-x', '1700', '-scale-to-y', '-1', '-singlefile', here('checkboxes.pdf'), here('checkboxes').replace(/\.png$/, '')]);
console.log('wrote checkboxes.pdf and checkboxes.png');
