// Draws tests/fixtures/options.pdf and options.png: an invented flat form (no fill-in fields of its own) whose
// choices are round option buttons, as on forms sent by e-mail, with some text beside them that must NOT be taken
// for buttons: capital O's, zeros, a Q, "o" bullets, a bold heading. Synthetic test material: no real organisation's
// form. Needs poppler (pdftoppm) for the picture.
//   node scripts/make-option-fixture.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const here = name => fileURLToPath(new URL('../tests/fixtures/' + name, import.meta.url));
const doc = await PDFDocument.create(), page = doc.addPage([612, 792]);
const plain = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), mono = await doc.embedFont(StandardFonts.Courier);
const black = rgb(0, 0, 0), text = (words, x, y, size = 11, font = plain) => page.drawText(words, { x, y, size, font, color: black });
// A round option button with its word after it: the circle sits on the line of text, as a form's own would.
const option = (x, y, word, radius = 5) => { page.drawCircle({ x: x + radius, y: y + 3.6, size: radius, borderWidth: 0.8, borderColor: black }); text(word, x + radius * 2 + 5, y); };

text('Clinic Intake Questions (invented form)', 72, 730, 16, bold);
text('Lakeside Training Center - synthetic test material, not a real form', 72, 716, 8);
text('Name:', 72, 680); page.drawLine({ start: { x: 110, y: 678 }, end: { x: 380, y: 678 }, thickness: 1, color: black });

text('Have you visited before?', 72, 644); option(300, 644, 'Yes'); option(370, 644, 'No');
text('Do you need an interpreter?', 72, 618); option(300, 618, 'Yes'); option(370, 618, 'No');
text('Preferred contact:', 72, 592); option(190, 592, 'Phone'); option(280, 592, 'E-mail'); option(370, 592, 'Post');
// Two questions on one line: two groups, not one of four.
text('Parking needed?', 72, 562); option(170, 562, 'Yes'); option(220, 562, 'No');
text('Wheelchair access?', 300, 562); option(410, 562, 'Yes'); option(460, 562, 'No');
// Options one under another, smaller circles.
text('Shift preferred:', 72, 530);
option(90, 510, 'Day', 4); option(90, 492, 'Night', 4); option(90, 474, 'Either', 4);

page.drawRectangle({ x: 72, y: 436, width: 10, height: 10, borderWidth: 0.8, borderColor: black }); text('I agree to the clinic rules', 90, 437);

// Text that has rings in it and is not a button.
text('ROOM BOOKING', 72, 396, 14, bold);
text('OMB No. 0000-0000 (invented). Blood type (circle one):   A   B   AB   O', 72, 372);
text('Qty 0 of 100. OK to contact: ZOO, QUOTE, DOOR.', 72, 354);
text('o  Bring this form with you', 90, 330, 10, mono); text('o  Arrive ten minutes early', 90, 316, 10, mono);

text('Signature:', 72, 250); page.drawLine({ start: { x: 130, y: 248 }, end: { x: 400, y: 248 }, thickness: 1, color: black });

doc.setTitle('Clinic Intake Questions (invented form)'); doc.setProducer('Form Filler fixtures'); doc.setCreator('Form Filler fixtures');
doc.setCreationDate(new Date('2026-11-17T12:00:00Z')); doc.setModificationDate(new Date('2026-11-17T12:00:00Z'));
writeFileSync(here('options.pdf'), await doc.save({ useObjectStreams: false }));
// The same page as a picture, 1700 pixels wide, the size the page works at.
execFileSync('pdftoppm', ['-png', '-gray', '-scale-to-x', '1700', '-scale-to-y', '-1', '-singlefile', here('options.pdf'), here('options').replace(/\.png$/, '')]);
console.log('wrote options.pdf and options.png');
