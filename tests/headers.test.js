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
// The stored reads, handed back in the order they are asked for; each picture must be the size it was when stored.
const stored = name => { const { reads } = JSON.parse(readFileSync(fixture(name + '-headers.json'), 'utf8')); let next = 0;
  return async (pixels, width, height) => { const read = reads[next++]; assert.ok(read, name + ': a read more than was stored'); assert.deepEqual([width, height], [read.width, read.height], name + ': the picture read ' + next); return read; }; };
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

test('two reads: the same text, sure, is the header; a misread letter is taken from the read that has it right', () => {
  assert.equal(lib.headerLabel(read('Serial number', 95), read('Serial number', 96)).label, 'Serial number');
  // The invented form's own case: "Item" 62% sure, then "[tem" from the copy enlarged twofold.
  assert.equal(lib.headerLabel(read('Item', 62), read('[tem', 47)).label, 'Item');
  assert.equal(lib.headerLabel(read('ltem', 70), read('Item', 80)).label, 'Item');
  assert.equal(lib.headerLabel(read('N0.', 75), read('No.', 70)).label, 'No.');
  assert.equal(lib.headerLabel(read('#', 88), read('#', 90)).label, '#');
  assert.equal(lib.headerLabel(read('Time in:', 90), read('Time in', 92)).label, 'Time in', 'a trailing colon dropped');
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
});

// A table drawn in code: a header row (heading words in block capitals) over two empty rows, 61 px each.
const COLUMNS = [200, 633, 1066, 1497], ROWS = [300, 361, 422, 483];
function headed({ spanning = false, openTop = false, words = ['VISITOR', 'ROOM', 'BADGE'] } = {}) {
  const p = drawn.page();
  drawn.table(p, COLUMNS, ROWS.slice(1));
  if (!openTop) drawn.fill(p, COLUMNS[0], ROWS[0], COLUMNS[3] + 3, ROWS[0] + 3);
  for (const x of spanning ? [COLUMNS[0], COLUMNS[3]] : COLUMNS) drawn.fill(p, x, ROWS[0] + 3, x + 3, ROWS[1]);
  words.forEach((text, index) => text && drawn.inCell(p, text, COLUMNS[index], ROWS[0], ROWS[1]));
  const blanks = lib.findBlanks(p.gray, p.width, p.height).map(blank => ({ ...blank, label: '' }));
  return { ...p, blanks, cells: lib.headerCells(p.gray, p.width, p.height, blanks) };
}

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
  assert.deepEqual(headed({ spanning: true, words: ['VISITOR', '', ''] }).cells, [], 'one header over all three columns');
  assert.deepEqual(headed({ openTop: true }).cells, [], 'no rule over the header row');
  assert.deepEqual(headed({ words: ['', '', ''] }).cells, [], 'an empty header row');
  // An empty header cell is itself a place to write, as the finder offers it; its column has no header to read.
  const gap = headed({ words: ['VISITOR', '', 'BADGE'] });
  assert.deepEqual(gap.cells.map(({ cell }) => COLUMNS.findIndex((x, index) => cell.x0 > x && cell.x1 < COLUMNS[index + 1])), [0, 2], 'the empty header\'s column has none');
  assert.ok(gap.cells.every(({ blanks: under }) => under.length === 2 && under.every(index => gap.blanks[index].y0 > ROWS[1])), 'each holds its two rows: ' + JSON.stringify(gap.cells));
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
