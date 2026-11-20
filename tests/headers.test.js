import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import * as lib from '../src/lib/index.js';
import * as drawn from './drawn.js';

// Table cells labelled by their column's header (src/lib/headers.js). The pages are invented (tests/fixtures), and the
// reader's words and header reads for them are stored (scripts/make-word-fixtures.mjs, make-header-fixtures.mjs), so
// these tests need no reader.
const fixture = name => new URL('./fixtures/' + name, import.meta.url);
function page(name) {
  const png = PNG.sync.read(readFileSync(fixture(name + '.png'))), { width, height } = png;
  let gray = new Uint8Array(width * height);
  for (let at = 0; at < gray.length; at++) gray[at] = Math.round(0.299 * png.data[at * 4] + 0.587 * png.data[at * 4 + 1] + 0.114 * png.data[at * 4 + 2]);
  const angle = lib.skewOf(gray, width, height);
  if (Math.abs(angle) >= 0.2) gray = lib.rotate(gray, width, height, angle);
  const { words } = JSON.parse(readFileSync(fixture(name + '-words.json'), 'utf8'));
  const heights = words.filter(word => word.confidence > 50).map(word => word.bbox.y1 - word.bbox.y0).sort((a, b) => a - b), unit = heights[Math.floor(heights.length / 2)];
  return { gray, width, height, unit, blanks: lib.labelBlanks(lib.findBlanks(gray, width, height), words, unit) };
}
// The stored reads, handed back in the order they are asked for; each picture must be the one that was read when they
// were stored: the same size, and as many pixels of ink.
const stored = name => { const { reads } = JSON.parse(readFileSync(fixture(name + '-headers.json'), 'utf8')); let next = 0;
  return async (pixels, width, height) => { const read = reads[next++]; assert.ok(read, name + ': a read more than was stored');
    assert.deepEqual([width, height, pixels.reduce((count, value) => count + (value < 128 ? 1 : 0), 0)], [read.width, read.height, read.ink], name + ': the picture read ' + next); return read; }; };
const read = (text, confidence = 90) => ({ words: text.split(' ').filter(Boolean).map(word => ({ text: word, confidence })) });

test('the invented form, in all three renderings: its table cells are labelled Item, Serial number and Qty, and nothing else changes', async () => {
  for (const name of ['form', 'form-photo', 'form-webkit']) {
    const { gray, width, height, unit, blanks } = page(name), named = await lib.headerLabels(gray, width, height, blanks, unit, stored(name));
    assert.deepEqual(named.slice(3, 9).map(blank => blank.label), ['Item', 'Serial number', 'Qty', 'Item', 'Serial number', 'Qty'], name);
    assert.ok(named.slice(3, 9).every(blank => blank.column === true), name + ': marked as a column\'s');
    named.forEach((blank, index) => { if (index < 3 || index > 8) assert.deepEqual(blank, blanks[index], name + ', blank ' + (index + 1)); });
  }
});

test('a tight table: the first row, which the page\'s read reached, and the second are both labelled by their headers', async () => {
  const { gray, width, height, unit, blanks } = page('tight-table');
  assert.deepEqual(blanks.map(blank => blank.label), ['Visitor', 'Room', 'Badge', '', '', ''], 'the page\'s read names the first row only');
  const named = await lib.headerLabels(gray, width, height, blanks, unit, stored('tight-table'));
  assert.deepEqual(named.map(blank => blank.label), ['Visitor', 'Room', 'Badge', 'Visitor', 'Room', 'Badge']);
  assert.ok(named.every(blank => blank.column === true));
});

test('two reads: the same text, sure, is the header; a misread letter is told by its neighbours', () => {
  assert.equal(lib.headerLabel(read('Serial number', 95), read('Serial number', 96)).label, 'Serial number');
  // The invented form's own case: "Item" 62% sure, then "[tem" from the copy enlarged twofold. "[" is never a letter.
  assert.equal(lib.headerLabel(read('Item', 62), read('[tem', 47)).label, 'Item');
  assert.equal(lib.headerLabel(read('|tem', 80), read('Item', 80)).label, 'Item');
  assert.equal(lib.headerLabel(read('Total', 90), read('TotaI', 90)).label, 'Total', 'an "l" after a small letter');
  assert.equal(lib.headerLabel(read('TotaI', 90), read('Total', 90)).label, 'Total', 'whichever read has it');
  assert.equal(lib.headerLabel(read('lD', 90), read('ID', 90)).label, 'ID', 'an "I" in a word of capitals');
  assert.equal(lib.headerLabel(read('N0.', 75), read('No.', 70)).label, 'No.', 'the letter beside a letter');
  assert.equal(lib.headerLabel(read('Box 1O', 90), read('Box 10', 90)).label, 'Box 10', 'a "0" beside a digit');
  assert.equal(lib.headerLabel(read('#', 88), read('#', 90)).label, '#');
  assert.equal(lib.headerLabel(read('Time in:', 90), read('Time in', 92)).label, 'Time in', 'a trailing colon dropped');
});

test('a misread the neighbours cannot tell, or one both reads keep, leaves the column unlabelled', () => {
  assert.equal(lib.headerLabel(read('ltem', 70), read('Item', 80)).label, '', '"l" or "I" at the start of a word before a small letter');
  assert.equal(lib.headerLabel(read('lbs', 80), read('Ibs', 80)).label, '', 'the same, the other way: "lbs" is a word too');
  assert.equal(lib.headerLabel(read('[tem', 80), read('[tem', 80)).label, '', 'a "[" both reads keep');
  assert.equal(lib.headerLabel(read('Col 0', 80), read('Col O', 80)).label, '', 'a "0" or "O" alone');
  // What no rule here can catch: both reads agreeing on the same misreading. This is a known limit, not a wish.
  assert.equal(lib.headerLabel(read('Ibs', 80), read('Ibs', 80)).label, 'Ibs');
});

test('two reads that do not agree, or a first read that is unsure, leave the column unlabelled', () => {
  // A scribble, as the reader made of it on the invented sheet: "ANNA" 60% sure, then "AVA Ye".
  assert.equal(lib.headerLabel(read('ANNA', 60), read('AVA Ye', 0)).label, '');
  assert.equal(lib.headerLabel(read('Item', 59), read('Item', 95)).label, '', 'the first read under 60% sure');
  assert.equal(lib.headerLabel(read('Qty', 90), read('Oty', 90)).label, '', 'Q and O are not a misread pair');
  assert.equal(lib.headerLabel(read('Serial number', 95), read('Serialnumber', 95)).label, '', 'not letter for letter');
  assert.equal(lib.headerLabel(read('~~', 95), read('~~', 95)).label, '', 'no letter, digit or #');
  assert.equal(lib.headerLabel(read('', 95), read('', 95)).label, '');
  assert.equal(lib.headerLabel({ words: [] }, read('Item')).label, '', 'nothing read the first time');
  assert.equal(lib.headerLabel(read('[tem', 80), read('ltem', 80)).label, '', 'two misreads, and neither has the letter');
  assert.equal(lib.headerLabel({ words: [{ text: 'Serial', confidence: 95 }, { text: 'number', confidence: 30 }] }, read('Serial number', 95)).label, '', 'one word of the first read under 60% sure');
  assert.equal(lib.headerLabel(read('Item', 60), read('Item', 50)).label, 'Item', '60% is sure enough');
  assert.equal(lib.headerLabel(read('Date', 90), read('Date of return', 90)).label, '', 'the first read only the start of the second');
});

// A table drawn in code: a header row (heading words in block capitals) over two empty rows, 61 px each.
const COLUMNS = [200, 633, 1066, 1497], ROWS = [300, 361, 422, 483];
function headed({ walls = COLUMNS, openTop = false, words = ['VISITOR', 'ROOM', 'BADGE'], at = null } = {}) {
  const p = drawn.page();
  drawn.table(p, COLUMNS, ROWS.slice(1));
  if (!openTop) drawn.fill(p, COLUMNS[0], ROWS[0], COLUMNS[3] + 3, ROWS[0] + 3);
  for (const x of walls) drawn.fill(p, x, ROWS[0] + 3, x + 3, ROWS[1]);
  words.forEach((text, index) => text && (at ? drawn.word(p, text, at[index], ROWS[0] + 22) : drawn.inCell(p, text, COLUMNS[index], ROWS[0], ROWS[1])));
  const blanks = lib.findBlanks(p.gray, p.width, p.height).map(blank => ({ ...blank, label: '' }));
  return { ...p, blanks, cells: lib.headerCells(p.gray, p.width, p.height, blanks) };
}
const columnOf = cell => COLUMNS.findIndex((x, index) => cell.x0 > x && cell.x1 < COLUMNS[index + 1]);

test('a header cell is found over each column, closed by a rule over it and the column\'s walls on both sides', () => {
  const { blanks, cells } = headed();
  assert.equal(blanks.length, 6, JSON.stringify(blanks));
  assert.equal(cells.length, 3, JSON.stringify(cells));
  cells.forEach(({ cell, blanks: under }, index) => {
    assert.ok(cell.x0 > COLUMNS[index] && cell.x1 < COLUMNS[index + 1] && cell.y0 > ROWS[0] && cell.y1 < ROWS[1], 'column ' + (index + 1) + ': ' + JSON.stringify(cell));
    assert.deepEqual(under, [index, index + 3], 'column ' + (index + 1) + ' holds both rows');
  });
});

test('no header cell where it cannot be told: a header across several columns, no rule over the header, or no words in it', () => {
  assert.deepEqual(headed({ walls: [COLUMNS[0], COLUMNS[3]], words: ['VISITOR', '', ''] }).cells, [], 'one header over all three columns');
  // One header across the second and third columns: only the first column, with walls on both sides, has its own.
  const across = headed({ walls: [COLUMNS[0], COLUMNS[1], COLUMNS[3]], words: ['VISITOR', 'BADGE ROOM', ''], at: [217, 960, 0] });
  assert.deepEqual(across.cells.map(({ cell }) => columnOf(cell)), [0], JSON.stringify(across.cells));
  assert.deepEqual(headed({ openTop: true }).cells, [], 'no rule over the header row');
  assert.deepEqual(headed({ words: ['', '', ''] }).cells, [], 'an empty header row');
  // The same with the empty header cells left out of the blanks (as if not offered): no ink in them, so no header.
  const empty = headed({ words: ['', '', ''] });
  assert.deepEqual(lib.headerCells(empty.gray, empty.width, empty.height, empty.blanks.filter(blank => blank.y0 > ROWS[1])), [], 'no ink in the header cells');
  // An empty header cell is itself a place to write, as the finder offers it; its column has no header to read.
  const gap = headed({ words: ['VISITOR', '', 'BADGE'] });
  assert.deepEqual(gap.cells.map(({ cell }) => columnOf(cell)), [0, 2], 'the empty header\'s column has none');
  assert.ok(gap.cells.every(({ blanks: under }) => under.length === 2 && under.every(index => gap.blanks[index].y0 > ROWS[1])), 'each holds its two rows: ' + JSON.stringify(gap.cells));
});

test('a form\'s boxed fields, each under its own caption cell, are no table: no header cell, so nothing changes', () => {
  // Two columns of three fields: a caption row (28 px inside) over an entry row (60 px), as many printed forms are.
  const p = drawn.page(), xs = [200, 850, 1500], ys = [300];
  for (let row = 0; row < 3; row++) ys.push(ys.at(-1) + 31, ys.at(-1) + 31 + 63);
  drawn.table(p, xs, ys);
  [['NAME', 'DATE'], ['EMAIL', 'PHONE'], ['ROOM', 'BADGE']].forEach((pair, row) => pair.forEach((text, index) => drawn.word(p, text, xs[index] + 10, ys[row * 2] + 8, 2)));
  const blanks = lib.findBlanks(p.gray, p.width, p.height).map(blank => ({ ...blank, label: '' }));
  assert.equal(blanks.filter(blank => blank.y1 - blank.y0 > 30).length, 6, 'the six entry boxes: ' + JSON.stringify(blanks));
  assert.deepEqual(lib.headerCells(p.gray, p.width, p.height, blanks), [], 'one field under each caption, not a column of three');
});

test('a second table right under the first, its header taken for an empty cell: A\'s header stays over A\'s rows, and B is left unlabelled', () => {
  // Table B shares table A's bottom rule; B's first header ("ID") has too little ink for the finder, which offers it.
  const p = drawn.page(), lower = [483, 544, 605, 666];
  drawn.table(p, COLUMNS, ROWS); drawn.table(p, COLUMNS, lower);
  ['VISITOR', 'ROOM', 'BADGE'].forEach((text, index) => drawn.inCell(p, text, COLUMNS[index], ROWS[0], ROWS[1]));
  ['ID', 'ROOM', 'BADGE'].forEach((text, index) => drawn.inCell(p, text, COLUMNS[index], lower[0], lower[1]));
  const blanks = lib.findBlanks(p.gray, p.width, p.height).map(blank => ({ ...blank, label: '' })), cells = lib.headerCells(p.gray, p.width, p.height, blanks);
  assert.ok(blanks.some(blank => blank.y0 > lower[0] && blank.y1 < lower[1] && blank.x1 < COLUMNS[1]), 'the "ID" header is offered as a cell: ' + JSON.stringify(blanks));
  const first = cells.filter(({ cell }) => columnOf(cell) === 0).map(({ cell, blanks: under }) => [cell.y0 > lower[0], under.map(index => blanks[index].y0 > lower[1])]);
  // B's header row has A's walls going on up above it, as a filled-in row of one table would: it is not read, and B's
  // cells stay unlabelled (a known limit). What matters is that A's header does not run on into B.
  assert.deepEqual(first, [[false, [false, false]]], 'A\'s header over A\'s two rows only: ' + JSON.stringify(cells));
  assert.equal(cells.length, 3, 'one for each of A\'s columns');
});

test('a row already filled in, over empty rows, is not taken for their header', () => {
  const p = drawn.page(), ys = [300, 361, 422, 483, 544];
  drawn.table(p, COLUMNS, ys);
  ['VISITOR', 'ROOM', 'BADGE'].forEach((text, index) => drawn.inCell(p, text, COLUMNS[index], ys[0], ys[1]));
  ['MAT', 'TWO', 'SEVEN'].forEach((text, index) => drawn.inCell(p, text, COLUMNS[index], ys[1], ys[2]));
  const blanks = lib.findBlanks(p.gray, p.width, p.height).map(blank => ({ ...blank, label: '' }));
  assert.deepEqual(lib.headerCells(p.gray, p.width, p.height, blanks), [], 'the filled row has the table\'s walls going on above it');
});

test('a cramped header, its first letter close to the wall, is read whole: the cell runs out to the wall', () => {
  const { cells } = headed({ at: [206, 650, 1083] });
  assert.equal(cells.length, 3, JSON.stringify(cells));
  assert.ok(cells[0].cell.x0 <= 206, 'the crop starts by the wall, before the word: ' + JSON.stringify(cells[0].cell));
});

test('what the two reads make of a header labels its column, or leaves it unlabelled; a cell\'s own words are kept', async () => {
  const { gray, width, height, blanks } = headed(), script = texts => { let next = 0; return async () => read(...texts[next++]); };
  // Visitor reads the same twice; Room does not; Badge is sure only the second time.
  const named = await lib.headerLabels(gray, width, height, blanks, 22, script([['Visitor'], ['Visitor'], ['Room'], ['Rcom'], ['Badge', 40], ['Badge']]));
  assert.deepEqual(named.map(blank => blank.label), ['Visitor', '', '', 'Visitor', '', '']);
  assert.deepEqual(named.map(blank => Boolean(blank.column)), [true, false, false, true, false, false]);
  // A first-row label that is the header's words (the page's read reached it) goes when the header does not read
  // the same twice; a row's own label stays.
  const labelled = blanks.map((blank, index) => index === 1 ? { ...blank, label: 'Room' } : index === 4 ? { ...blank, label: 'Spare' } : blank);
  const kept = await lib.headerLabels(gray, width, height, labelled, 22, script([['Visitor'], ['Visitor'], ['Room'], ['Rcom'], ['Badge'], ['Badge']]));
  assert.deepEqual(kept.map(blank => blank.label), ['Visitor', '', 'Badge', 'Visitor', 'Spare', 'Badge']);
  const reads = []; await lib.headerLabels(gray, width, height, blanks, 22, script([['Visitor'], ['Visitor'], ['Room'], ['Rcom'], ['Badge'], ['Badge']]), { onRead: info => reads.push(info) });
  assert.deepEqual(reads.map(info => [info.first.text, info.second.text, info.label]), [['Visitor', 'Visitor', 'Visitor'], ['Room', 'Rcom', ''], ['Badge', 'Badge', 'Badge']]);
});

test('a top cell named by part of its header (the page\'s read reached only "price" of "Unit price") takes the whole header, or none', async () => {
  const { gray, width, height, blanks } = headed(), script = texts => { let next = 0; return async () => read(...texts[next++]); };
  const part = blanks.map((blank, index) => index === 0 ? { ...blank, label: 'price' } : index === 3 ? { ...blank, label: 'price' } : blank);
  const whole = await lib.headerLabels(gray, width, height, part, 22, script([['Unit price'], ['Unit price'], ['Room'], ['Room'], ['Badge'], ['Badge']]));
  assert.deepEqual([whole[0].label, whole[0].column], ['Unit price', true], 'the top cell: the whole header');
  assert.equal(whole[3].label, 'price', 'a cell further down: its own words, kept');
  const none = await lib.headerLabels(gray, width, height, part, 22, script([['Unit price'], ['Unlt prlce', 30], ['Room'], ['Room'], ['Badge'], ['Badge']]));
  assert.deepEqual([none[0].label, Boolean(none[0].column)], ['', false], 'a header that does not read the same twice: nothing');
  // Letters inside a header word are not its words: a row's label "AM" under "Name" is its own, read or not.
  const am = blanks.map((blank, index) => index === 0 ? { ...blank, label: 'AM' } : index === 3 ? { ...blank, label: 'Name' } : blank);
  const kept = await lib.headerLabels(gray, width, height, am, 22, script([['Name'], ['Name'], ['Room'], ['Room'], ['Badge'], ['Badge']]));
  assert.deepEqual([kept[0].label, kept[3].label], ['AM', 'Name'], 'kept, and a lower row\'s own label too');
  const still = await lib.headerLabels(gray, width, height, am, 22, script([['Name'], ['Nane'], ['Room'], ['Room'], ['Badge'], ['Badge']]));
  assert.deepEqual([still[0].label, still[3].label], ['AM', 'Name'], 'not erased when the header does not read the same twice');
});

test('a CSV column goes to the form\'s own blank of a name a table\'s column shares; the table\'s cells alone match none', () => {
  const blanks = [{ kind: 'line', label: 'Name' }, { kind: 'box', label: 'Name', column: true }, { kind: 'box', label: 'Name', column: true }, { kind: 'box', label: 'Qty', column: true }, { kind: 'box', label: 'Qty', column: true }];
  const { columns, unmatched, shared } = lib.matchColumns(blanks, ['Name', 'Qty']);
  assert.deepEqual(columns, [0, null], 'Name: the form\'s own line; Qty: no row to choose');
  assert.deepEqual([unmatched, shared], [['Qty'], ['Qty']]);
});

test('a template with a table\'s column says version 2, which older readers refuse rather than fill every row', () => {
  const make = column => lib.makeTemplate({ form: { sha256: 'a'.repeat(64), name: 'table.png', type: 'image' }, pages: [{ width: 1700, height: 2200 }],
    blanks: [{ page: 0, kind: 'box', x0: 10, y0: 10, x1: 90, y1: 40, label: 'Name', ...(column ? { column: true } : {}) }] });
  assert.equal(make(true).version, 2); assert.equal(make(false).version, 1, 'no column: as before');
  assert.equal(lib.readTemplate(JSON.stringify(make(true))).blanks[0].column, true);
  assert.throws(() => lib.readTemplate(JSON.stringify({ ...make(true), version: 3 })), /version 3/);
});

test('a table cell labelled by its header is never filled with your details or today\'s date, and a template keeps the mark', () => {
  const blanks = [{ kind: 'line', label: 'Name' }, { kind: 'box', label: 'Name', column: true }, { kind: 'line', label: 'Date' }, { kind: 'box', label: 'Date', column: true }];
  const filled = lib.autofill(blanks, { firstName: 'Jane', lastName: 'Roe' }, { today: new Date(2026, 10, 19) });
  assert.deepEqual([...filled.keys()], [0, 2], 'only the form\'s own Name and Date lines');
  const template = lib.makeTemplate({ form: { sha256: 'a'.repeat(64), name: 'table.png', type: 'image' }, pages: [{ width: 1700, height: 2200 }],
    blanks: [{ page: 0, kind: 'box', x0: 10, y0: 10, x1: 90, y1: 40, label: 'Name', column: true }, { page: 0, kind: 'box', x0: 10, y0: 50, x1: 90, y1: 80, label: '', column: true }] });
  const back = lib.readTemplate(JSON.stringify(template));
  assert.equal(back.blanks[0].column, true);
  assert.equal(back.blanks[1].column, undefined, 'no mark without a label');
});

test('the crop the reader is given: the cell\'s own pixels with a margin of paper, each made twice as big in the copy', () => {
  const gray = new Uint8Array(10 * 6).fill(255); gray[2 * 10 + 3] = 0;
  const one = lib.cropOf(gray, 10, 6, { x0: 2, y0: 1, x1: 6, y1: 4 }, 1, 2), two = lib.cropOf(gray, 10, 6, { x0: 2, y0: 1, x1: 6, y1: 4 }, 2, 2);
  assert.deepEqual([one.width, one.height, two.width, two.height], [8, 7, 12, 10]);
  assert.equal(one.gray[(2 + 1) * 8 + 2 + 1], 0, 'the ink at (3, 2) is at (1, 1) inside the margin');
  assert.deepEqual([two.gray[(2 + 2) * 12 + 2 + 2], two.gray[(2 + 3) * 12 + 2 + 3]], [0, 0], 'and twice as big in the copy');
  assert.equal(one.gray.filter(value => value === 0).length, 1); assert.equal(two.gray.filter(value => value === 0).length, 4);
});
