import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { PDFDocument } from 'pdf-lib';
import * as lib from '../src/lib/index.js';

// Invented material drawn by scripts/make-fixtures.py. Synthetic: no real form, person or handwriting.
const fixture = name => readFileSync(new URL('./fixtures/' + name, import.meta.url));
const grayOfPng = bytes => { const png = PNG.sync.read(bytes), gray = new Uint8Array(png.width * png.height);
  for (let at = 0; at < gray.length; at++) gray[at] = Math.round(0.299 * png.data[at * 4] + 0.587 * png.data[at * 4 + 1] + 0.114 * png.data[at * 4 + 2]); return { gray, width: png.width, height: png.height }; };
const SCALE = 1700 / 612;
// The PDF's text, by poppler; any complaint poppler makes about the file (a broken cross-reference, say) fails the test.
const pdfText = bytes => { const dir = mkdtempSync(join(tmpdir(), 'ff-')), file = join(dir, 'x.pdf'); execFileSync('sh', ['-c', 'cat > ' + file], { input: bytes });
  const run = spawnSync('pdftotext', ['-layout', file, '-']); assert.equal(run.stderr.toString(), '', 'poppler reads the PDF without complaint'); return run.stdout.toString(); };

test('a PDF with its own fields: every field is a blank, with its kind, choices and the form maker\'s label', async () => {
  const { blanks, encrypted, xfa } = await lib.readFields(fixture('fillable.pdf'), { scale: SCALE });
  assert.equal(encrypted, false); assert.equal(xfa, false);
  assert.deepEqual(blanks.map(blank => [blank.field, blank.kind, blank.label]), [
    ['full_name', 'box', 'Full name'], ['email', 'box', 'E-mail'], ['phone', 'box', 'Phone'], ['visit_date', 'box', 'Date'],
    ['unit', 'choice', 'Unit'], ['shift', 'choice', 'Shift'], ['escort', 'check', 'Escort needed'], ['reason', 'box', 'Reason for visit']]);
  assert.deepEqual(blanks[4].options, ['ICU', 'Emergency', 'Floor']);
  assert.deepEqual(blanks[5].options, ['Day', 'Night']);
  assert.ok(Math.abs(blanks[5].x1 - (240 + 14) * SCALE) < 1, 'the radio blank spans both its buttons: ' + JSON.stringify(blanks[5]));
  assert.deepEqual(blanks[5].spots.map(spot => spot.option), ['Day', 'Night'], 'each radio button knows its option');
  assert.ok(blanks[5].spots[0].x1 < blanks[5].spots[1].x0, 'the Day button sits left of the Night button: ' + JSON.stringify(blanks[5].spots));
  assert.ok(Math.abs(blanks[5].spots[1].x1 - blanks[5].x1) < 1, 'the last button ends where the group does');
  assert.equal(blanks[4].spots, undefined, 'a drop-down has no buttons');
  assert.equal(blanks[7].multiline, true);
  // Full name's field is at x=160 pt, y=680 pt (from the bottom of a 792 pt page), 300 by 18 pt.
  assert.ok(Math.abs(blanks[0].x0 - 160 * SCALE) < 1 && Math.abs(blanks[0].y1 - (792 - 680) * SCALE) < 1, JSON.stringify(blanks[0]));
});

test('fields plus what the pixels show: the drawn signature line is added, the fields\' own borders are not', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-')), pdf = join(dir, 'f.pdf');
  execFileSync('sh', ['-c', 'cat > ' + pdf], { input: fixture('fillable.pdf') });
  execFileSync('pdftoppm', ['-png', '-gray', '-scale-to-x', '1700', '-scale-to-y', '-1', '-singlefile', pdf, join(dir, 'page')]);
  const { gray, width, height } = grayOfPng(readFileSync(join(dir, 'page.png')));
  const { blanks: fields } = await lib.readFields(fixture('fillable.pdf'), { scale: width / 612 });
  const all = lib.order(lib.withFound(fields, lib.findBlanks(gray, width, height)));
  const extra = all.filter(blank => !blank.field);
  assert.equal(extra.length, 1, 'one blank with no field: ' + JSON.stringify(extra));
  assert.equal(extra[0].kind, 'line');
  assert.ok(Math.abs(extra[0].y1 - (792 - 326) * width / 612) < 12, 'it is the signature line');
});

test('filling a PDF\'s own fields: the same fields hold the answers; print-ready leaves none; what cannot go in is said', async () => {
  const { blanks } = await lib.readFields(fixture('fillable.pdf'), { scale: SCALE });
  const pages = [{ width: 1700, height: 792 * SCALE, pdfPage: 0 }];
  const values = ['Jane Roe', 'jane@example.org', '555-0100', '11/13/2026', 'emer', 'night', true, 'x'.repeat(130)];
  const problems = [];
  const editable = await lib.buildPdf({ pages, blanks, values, sourcePdf: fixture('fillable.pdf'), editable: true, problems });
  const form = (await PDFDocument.load(editable)).getForm();
  assert.equal(form.getFields().length, 8, 'no field laid over another');
  assert.equal(form.getTextField('full_name').getText(), 'Jane Roe');
  assert.deepEqual(form.getDropdown('unit').getSelected(), ['Emergency'], '"emer" picks Emergency');
  assert.equal(form.getRadioGroup('shift').getSelected(), 'Night');
  assert.equal(form.getCheckBox('escort').isChecked(), true);
  assert.equal(form.getTextField('reason').getText().length, 100);
  assert.deepEqual(problems, ['Blank 8 (Reason for visit): cut to 100 characters, the most the form allows.']);
  const wrong = [];
  await lib.buildPdf({ pages, blanks, values: ['', '', '', '', 'Pharmacy', '', false, ''], sourcePdf: fixture('fillable.pdf'), editable: true, problems: wrong });
  assert.match(wrong[0], /"Pharmacy" is not one of its choices \(ICU, Emergency, Floor\)/);
  const printable = await lib.buildPdf({ pages, blanks, values, sourcePdf: fixture('fillable.pdf'), editable: false });
  assert.equal((await PDFDocument.load(printable)).getForm().getFields().length, 0);
  const text = pdfText(printable);
  for (const word of ['Jane Roe', 'jane@example.org', 'Emergency', 'Visitor Pass Request']) assert.ok(text.includes(word), word + ' in the print-ready PDF');
});

test('a signature is a picture in its blank, kept to its own shape', async () => {
  const png = new PNG({ width: 200, height: 50 }); png.data.fill(0); for (let x = 10; x < 190; x++) { const at = (25 * 200 + x) * 4; png.data[at + 3] = 255; }
  const signature = 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
  const pages = [{ width: 1000, height: 1000, pdfPage: null, image: { type: 'png', bytes: PNG.sync.write(Object.assign(new PNG({ width: 10, height: 10 }), {})) } }];
  const bytes = await lib.buildPdf({ pages, blanks: [{ page: 0, kind: 'line', x0: 100, y0: 100, x1: 900, y1: 160 }], values: [{ signature }], editable: true });
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getForm().getFields().length, 0, 'a signature is not a text field');
  assert.match(Buffer.from(bytes).toString('latin1'), /\/Subtype \/Image[\s\S]*\/Width 200/);
});

test('templates: made, read back the same, and a damaged one refused with what is wrong', async () => {
  const { blanks } = await lib.readFields(fixture('fillable.pdf'), { scale: SCALE });
  const template = lib.makeTemplate({ form: { sha256: 'a'.repeat(64), name: 'fillable.pdf', type: 'pdf' }, pages: [{ width: 1700, height: 2200, pdfPage: 0 }], blanks });
  const back = lib.readTemplate(JSON.stringify(template));
  assert.deepEqual(back.blanks.map(blank => blank.field), blanks.map(blank => blank.field));
  assert.deepEqual(back.blanks[4].options, ['ICU', 'Emergency', 'Floor']);
  const broken = edit => () => lib.readTemplate(edit(structuredClone(template)));
  assert.throws(broken(item => { item.blanks[0].kind = 'oval'; return item; }), /blank 1 has an unknown kind "oval"/);
  assert.throws(broken(item => { item.blanks[2].page = 3; return item; }), /blank 3 is on a page the template does not have/);
  assert.throws(broken(item => { item.blanks[1].x1 = 99999; return item; }), /blank 2 runs off its page/);
  assert.throws(broken(item => { item.form.sha256 = 'nope'; return item; }), /fingerprint/);
  assert.throws(broken(item => { item.version = 3; return item; }), /version 3/);
  assert.throws(() => lib.readTemplate('{"formFiller":"something"}'), /not a Form Filler template/);
});

test('your details: matched by the label\'s words, never into someone else\'s blank; dates get today', () => {
  const cases = { 'Name': 'fullName', 'Full name:': 'fullName', 'Printed name': 'fullName', 'First Name': 'firstName', 'Surname': 'lastName', 'E-mail': 'email',
    'Contact email': 'email', 'Phone #': 'phone', 'Cell': 'phone', 'Street address': 'address', 'City, State, ZIP': 'cityStateZip', 'ZIP code': 'zip', 'DOB': 'birthDate',
    'Emergency contact phone': null, 'Patient name': null, 'Supervisor name': null, 'Department': null, 'Item': null, 'Middle initial': null, 'Comments': null, 'Signature': null };
  for (const [label, key] of Object.entries(cases)) assert.equal(lib.detailFor(label), key, label);
  assert.equal(lib.isDate('Date'), true); assert.equal(lib.isDate("Today's date"), true);
  for (const label of ['Date of birth', 'Start date', 'Due date', 'Date of service', 'Admission date']) assert.equal(lib.isDate(label), false, label);
  const blanks = [{ kind: 'line', label: 'Name' }, { kind: 'line', label: 'Date' }, { kind: 'line', label: 'Department' }, { kind: 'check', label: 'Name' }, { kind: 'line', label: 'Signature' }, { kind: 'line', label: 'City, State, ZIP' }];
  const filled = lib.autofill(blanks, { firstName: 'Jane', lastName: 'Roe', city: 'Bloomfield', state: 'IN', zip: '47424' }, { today: new Date(2026, 10, 13) });
  assert.deepEqual([...filled], [[0, 'Jane Roe'], [1, '11/13/2026'], [5, 'Bloomfield, IN 47424']]);
  assert.equal(lib.formatDate(new Date(2026, 0, 5), 'iso'), '2026-01-05');
});

test('typed answers pass over blanks your details already filled; a numbered one still goes where it says', () => {
  const blanks = [{ kind: 'line' }, { kind: 'line' }, { kind: 'line' }, { kind: 'line' }];
  assert.deepEqual(lib.placeAnswers(blanks, 'Respiratory. Night', { skip: new Set([0, 1]) }).values, ['', '', 'Respiratory', 'Night']);
  assert.deepEqual(lib.placeAnswers(blanks, '1) Override. Night', { skip: [0, 1] }).values, ['Override', '', 'Night', '']);
});

test('mail merge: CSV read the standard way; columns match by number, field name or label; unknown columns are named', () => {
  assert.deepEqual(lib.parseCsv('﻿Name,Comment\r\n"Roe, Jane","said ""hi""\nthen left"\n\nAl,\n'), [['Name', 'Comment'], ['Roe, Jane', 'said "hi"\nthen left'], ['Al', '']]);
  assert.throws(() => lib.parseCsv('a,"b\n'), /never closed/);
  const blanks = [{ kind: 'line', label: 'Name' }, { kind: 'box', label: 'Serial number', field: 'serial' }, { kind: 'check', label: 'Night' }, { kind: 'box', label: 'Qty' }, { kind: 'box', label: 'Qty' }];
  const { columns, unmatched, shared } = lib.matchColumns(blanks, ['name', 'serial', '#3', 'Qty', 'Color']);
  assert.deepEqual(columns, [0, 1, 2, null, null]);
  assert.deepEqual(unmatched, ['Qty', 'Color']); assert.deepEqual(shared, ['Qty']);
  assert.deepEqual(lib.rowValues(blanks, columns, ['Jane', 'VNT-1', 'yes'], ['', '', false, '', '11/13/2026']), ['Jane', 'VNT-1', true, '', '11/13/2026']);
  // "[ ] Other: ____": the box's caption is the line's label. The column fills the line, as before the box had a caption;
  // two checkboxes, or two lines, sharing a label still match neither.
  const other = [{ kind: 'check', label: 'Other' }, { kind: 'line', label: '[] Other' }, { kind: 'check', label: 'Yes' }, { kind: 'check', label: 'Yes' }];
  assert.deepEqual(lib.matchColumns(other, ['Other', 'Yes']), { columns: [1, null], unmatched: ['Yes'], shared: ['Yes'] });
});

test('a CSV\'s columns keep to the blanks they were matched to when a blank is added or removed by hand (defect 16)', () => {
  const blanks = [{ id: 1, kind: 'line', label: 'Name' }, { id: 2, kind: 'box', label: 'Item' }, { id: 3, kind: 'check', label: 'Day' }, { id: 4, kind: 'check', label: 'Night' }];
  const { columns } = lib.matchColumns(blanks, ['Day', '#2', 'Color']), ids = lib.columnIds(blanks, columns), row = ['x', 'Projector', 'blue'];
  assert.deepEqual([columns, ids], [[2, 1, null], [3, 2, null]], 'Day is blank 3, "#2" is Item, Color matches none');
  // Blank 1 removed by hand: the numbers move, the columns keep to Day and to Item ("#2" meant the blank numbered 2 then).
  const removed = blanks.filter(blank => blank.id !== 1);
  assert.deepEqual(lib.columnsNow(removed, ids), [1, 0, null]);
  assert.deepEqual(lib.rowValues(removed, lib.columnsNow(removed, ids), row), ['Projector', true, false], 'Day ticked, not Night');
  assert.deepEqual(lib.rowValues(removed, columns, row), ['', false, true], 'the old numbers on the new blanks: the Night box, as before the fix');
  // A blank added by hand before them, the same.
  assert.deepEqual(lib.columnsNow([{ id: 9, kind: 'box', label: 'added by hand' }, ...blanks], ids), [3, 2, null]);
  // The Day box itself removed: its column matches none, and nothing is ticked in its place.
  const noDay = blanks.filter(blank => blank.id !== 3);
  assert.deepEqual(lib.columnsNow(noDay, ids), [null, 1, null]);
  assert.deepEqual(lib.rowValues(noDay, lib.columnsNow(noDay, ids), row), ['', 'Projector', false]);
});

test('several filled copies join into one PDF, page after page', async () => {
  const one = await lib.buildPdf({ pages: [{ width: 1700, height: 2200, pdfPage: 0 }], blanks: [], values: [], sourcePdf: fixture('form.pdf'), editable: false });
  const joined = await PDFDocument.load(await lib.joinPdfs([one, one, one]));
  assert.equal(joined.getPageCount(), 3);
});

test('a PDF longer than the pages shown keeps every page, in order: the ones past the last blank are not lost', async () => {
  // The page shows a long form's first 10 pages only. An invented 12-page PDF with no fields of its own.
  const long = await PDFDocument.create();
  for (let sheet = 1; sheet <= 12; sheet++) long.addPage([612, 792]).drawText('Sheet ' + sheet + ' of the invented form', { x: 72, y: 700, size: 12 });
  const sourcePdf = await long.save();
  const pages = Array.from({ length: 10 }, (_, index) => ({ width: 1700, height: 2200, pdfPage: index, image: null }));
  const blanks = [{ page: 0, kind: 'line', x0: 200, y0: 500, x1: 900, y1: 560 }, { page: 9, kind: 'line', x0: 200, y0: 500, x1: 900, y1: 560 }];
  const values = ['Jane Roe', 'Last shown page'];
  for (const editable of [true, false]) {
    const bytes = await lib.buildPdf({ pages, blanks, values, sourcePdf, editable });
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 12, (editable ? 'editable' : 'print-ready') + ': all 12 pages');
    const sheets = pdfText(bytes).split('\f').filter(text => text.trim());
    assert.equal(sheets.length, 12);
    sheets.forEach((text, index) => assert.ok(text.includes('Sheet ' + (index + 1) + ' of'), 'page ' + (index + 1) + ' is still sheet ' + (index + 1)));
    if (!editable) { assert.ok(sheets[0].includes('Jane Roe'), 'the first answer is on page 1'); assert.ok(sheets[9].includes('Last shown page'), 'the last answer is on page 10'); }
    else assert.deepEqual((await PDFDocument.load(bytes)).getForm().getFields().map(field => field.getText()), values);
  }
  // A program that wants only the pages it lists can say so.
  assert.equal((await PDFDocument.load(await lib.buildPdf({ pages, blanks, values, sourcePdf, editable: false, keepOtherPages: false }))).getPageCount(), 10);
});

test('a handwritten page (handwriting-style fonts on ruled paper) is cut into its five lines, the rules left out', () => {
  const { gray, width, height } = grayOfPng(fixture('handwritten.png'));
  const lines = lib.segmentLines(gray, width, height);
  assert.equal(lines.length, 5, JSON.stringify(lines));
  // Each line sits on its own rule (every 150 px) and starts after the margin line at x=140.
  lines.forEach((line, index) => { assert.ok(line.y1 > 150 * (index + 1) - 90 && line.y0 < 150 * (index + 1), 'line ' + (index + 1) + ': ' + JSON.stringify(line)); assert.ok(line.x0 > 150, 'margin left out: ' + JSON.stringify(line)); });
});

test('answers written on paper with the blank number in front go to those blanks; answers in order are left alone', () => {
  const read = lib.numberedLines('3 Jane Roe\n1. 555-0100\n#7 - ICU\n12) yes', 13);
  assert.equal(read.numbered, 4);
  assert.equal(read.text, '3) Jane Roe\n1) 555-0100\n7) ICU\n12) yes');
  const blanks = Array.from({ length: 13 }, () => ({ kind: 'box' }));
  const { values } = lib.placeAnswers(blanks, read.text);
  assert.equal(values[2], 'Jane Roe'); assert.equal(values[0], '555-0100'); assert.equal(values[6], 'ICU'); assert.equal(values[11], 'yes');
  // In order, with one answer that happens to start with a number: not taken for numbering.
  assert.deepEqual(lib.numberedLines('Jane Roe\n555-0100\n2 tablets\nICU', 13), { text: 'Jane Roe\n555-0100\n2 tablets\nICU', numbered: 0, unnumbered: [] });
  // What the handwriting reader made of a synthetic numbered page: "9 x" came back as "qx". It is set aside, not put
  // in blank 3 (after "2) Ventilator"), where it would have covered Jane Roe.
  const page = lib.numberedLines('3 Jane Roe\n1 11.1312026\n7 Respiratory Care\n2 Ventilator\nqx', 13);
  assert.deepEqual(page.unnumbered, ['qx']);
  assert.equal(lib.placeAnswers(blanks, page.text).values[2], 'Jane Roe');
  // A number the form does not have is not a blank number.
  assert.equal(lib.numberedLines('40 Main St\n41 Oak Ave', 13).numbered, 0);
});
