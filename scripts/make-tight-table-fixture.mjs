// Draws tests/fixtures/tight-table.pdf and tight-table.png: an invented flat form whose table has rows 22 pt high
// (61 px at the 1700 px the page works at), for a known defect: in rows this tight the blank finder takes the upright
// strokes of the header's letters for cell walls and finds blanks in the header row that are not there. Synthetic
// test material: no real organisation's form. Needs poppler (pdftoppm) for the picture.
//   node scripts/make-tight-table-fixture.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const here = name => fileURLToPath(new URL('../tests/fixtures/' + name, import.meta.url));
const doc = await PDFDocument.create(), page = doc.addPage([612, 792]);
const plain = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
const black = rgb(0, 0, 0), text = (words, x, y, size = 11, font = plain) => page.drawText(words, { x, y, size, font, color: black });

text('Tight Table Sheet (invented form)', 72, 730, 16, bold);
text('Lakeside Training Center - synthetic test material, not a real form', 72, 716, 8);
// A table of three columns: a header row and two empty rows, each 22 pt high.
const cols = [72, 232, 392, 540], top = 680, row = 22;
for (let line = 0; line <= 3; line++) page.drawLine({ start: { x: cols[0], y: top - row * line }, end: { x: cols[3], y: top - row * line }, thickness: 0.9, color: black });
for (const x of cols) page.drawLine({ start: { x, y: top }, end: { x, y: top - row * 3 }, thickness: 0.9, color: black });
text('Visitor', cols[0] + 6, top - 15); text('Room', cols[1] + 6, top - 15); text('Badge', cols[2] + 6, top - 15);

doc.setTitle('Tight Table Sheet (invented form)'); doc.setProducer('Form Filler fixtures'); doc.setCreator('Form Filler fixtures');
doc.setCreationDate(new Date('2026-11-17T12:00:00Z')); doc.setModificationDate(new Date('2026-11-17T12:00:00Z'));
writeFileSync(here('tight-table.pdf'), await doc.save({ useObjectStreams: false }));
execFileSync('pdftoppm', ['-png', '-gray', '-scale-to-x', '1700', '-scale-to-y', '-1', '-singlefile', here('tight-table.pdf'), here('tight-table').replace(/\.png$/, '')]);
console.log('wrote tight-table.pdf and tight-table.png');
